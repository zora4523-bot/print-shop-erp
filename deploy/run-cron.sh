#!/bin/sh

set -eu

endpoint=${1:-}
case "$endpoint" in
  daily-salary|cs-settle|cs-period-ending|outsource-overdue|order-overdue|order-export-cleanup|hourly-payroll|generate-bills)
    ;;
  *)
    echo "unsupported cron endpoint: $endpoint" >&2
    exit 64
    ;;
esac

: "${APP_PUBLIC_URL:?APP_PUBLIC_URL is required}"

secret_file=${CRON_SECRET_FILE:-/root/.print-shop-erp-cron-secret}
if [ ! -r "$secret_file" ]; then
  echo "cron secret file is not readable: $secret_file" >&2
  exit 66
fi

secret=$(tr -d '\r\n' < "$secret_file")
if [ -z "$secret" ]; then
  echo "cron secret file is empty: $secret_file" >&2
  exit 65
fi

body_file=$(mktemp)
error_file=$(mktemp)
trap 'rm -f "$body_file" "$error_file"' EXIT HUP INT TERM

# Authorization 头绝不能进 curl 的命令行参数：同机任何用户一句
# `ps -efww | grep Bearer` 就能读走完整 CRON_SECRET。改用 `--header @-`
# （curl >= 7.55）从标准输入读一行头——printf 是 POSIX sh 内建命令，密钥
# 只经过管道，既不进 argv 也不落盘，因此不需要额外的临时文件和 chmod。
# 上面的 `tr -d '\r\n'` 顺带保证了这里只会喂进一行，不会被密钥里的换行
# 注入出第二个头。
if ! status=$(
  printf '%s\n' "Authorization: Bearer $secret" |
  curl --silent --show-error \
    --retry 3 \
    --retry-all-errors \
    --retry-connrefused \
    --connect-timeout 10 \
    --max-time 60 \
    --output "$body_file" \
    --write-out '%{http_code}' \
    --request POST \
    --header @- \
    "${APP_PUBLIC_URL%/}/api/cron/$endpoint" \
    2>"$error_file"
); then
  logger -t print-shop-erp-cron -- "$endpoint request failed: $(tr '\n' ' ' < "$error_file")"
  exit 1
fi

if [ "$status" != "202" ]; then
  logger -t print-shop-erp-cron -- "$endpoint failed with HTTP $status: $(tr '\n' ' ' < "$body_file")"
  exit 1
fi

logger -t print-shop-erp-cron -- "$endpoint queued successfully"
