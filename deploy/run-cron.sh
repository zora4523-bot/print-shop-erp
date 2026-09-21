#!/bin/sh

set -eu

endpoint=${1:-}
case "$endpoint" in
  daily-salary|cs-settle|cs-period-ending|outsource-overdue|order-overdue|pending-factory-backlog|production-alerts|order-export-cleanup|hourly-payroll|generate-bills)
    ;;
  *)
    echo "unsupported cron endpoint: $endpoint" >&2
    exit 64
    ;;
esac

: "${APP_PUBLIC_URL:?APP_PUBLIC_URL is required}"

# Bearer secret 只能发往 TLS 端点；唯一例外是本机回环地址（流量不离开
# 主机）。不能只靠部署文档约定 https：一处误配就会把 CRON_SECRET 明文送上
# 网络。这里在读取 secret 之前 fail closed，错误日志也永远不包含 secret。
case "$APP_PUBLIC_URL" in
  *://*@*)
    echo "APP_PUBLIC_URL must not contain URL credentials" >&2
    exit 65
    ;;
esac
if ! cron_origin=$(APP_PUBLIC_URL="$APP_PUBLIC_URL" node -e '
  try {
    const value = process.env.APP_PUBLIC_URL;
    if (!value || value !== value.trim()) process.exit(1);
    const url = new URL(value);
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    const safeTransport =
      url.protocol === "https:" || (url.protocol === "http:" && loopback);
    const originOnly =
      url.pathname === "/" && url.search === "" && url.hash === "";
    if (url.username || url.password || !safeTransport || !originOnly) {
      process.exit(1);
    }
    process.stdout.write(url.origin);
  } catch {
    process.exit(1);
  }
' 2>/dev/null); then
  echo "APP_PUBLIC_URL must be an origin-only https URL (plain HTTP is allowed only for loopback)" >&2
  exit 65
fi
APP_PUBLIC_URL=$cron_origin

secret_file=${CRON_SECRET_FILE:-/root/.print-shop-erp-cron-secret}
# Open, fstat, and read the same descriptor in one process. A pathname-level
# `test -f` followed by `cat` would leave a swap window in which an attacker
# could replace the checked file with a symlink, FIFO, or weaker-permission
# file. O_NOFOLLOW + O_NONBLOCK also makes those substitutions fail closed.
if ! secret=$(CRON_SECRET_FILE="$secret_file" node -e '
  const fs = require("node:fs");
  const { O_NOFOLLOW, O_NONBLOCK, O_RDONLY } = fs.constants;
  let fd;
  try {
    fd = fs.openSync(
      process.env.CRON_SECRET_FILE,
      O_RDONLY | O_NOFOLLOW | O_NONBLOCK,
    );
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.uid !== 0 || (stat.mode & 0o777) !== 0o600) {
      process.exit(1);
    }
    process.stdout.write(fs.readFileSync(fd, "utf8").replace(/[\r\n]/g, ""));
  } catch {
    process.exit(1);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
' 2>/dev/null); then
  echo "cron secret file must be a readable, root-owned regular file with mode 0600: $secret_file" >&2
  exit 66
fi

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
    "$APP_PUBLIC_URL/api/cron/$endpoint" \
    2>"$error_file"
); then
  logger -t print-shop-erp-cron -- "$endpoint request failed: $(tr '\n' ' ' < "$error_file")"
  exit 1
fi

if [ "$status" != "202" ]; then
  logger -t print-shop-erp-cron -- "$endpoint failed with HTTP $status: $(tr '\n' ' ' < "$body_file")"
  exit 1
fi

if ! enqueue_result=$(node -e '
  try {
    const body = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
    if (typeof body.created !== "boolean" || typeof body.requeued !== "boolean") process.exit(1);
    process.stdout.write(body.created || body.requeued ? "queued successfully" : "skipped (duplicate scope)");
  } catch { process.exit(1); }
' "$body_file"); then
  logger -t print-shop-erp-cron -- "$endpoint invalid enqueue response"
  exit 1
fi
logger -t print-shop-erp-cron -- "$endpoint $enqueue_result"
