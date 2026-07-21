#!/bin/sh

set -eu

endpoint=${1:-}
case "$endpoint" in
  daily-salary|cs-settle|cs-period-ending|outsource-overdue|order-overdue|hourly-payroll|generate-bills)
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

if ! status=$(
  curl --silent --show-error \
    --retry 3 \
    --retry-all-errors \
    --retry-connrefused \
    --connect-timeout 10 \
    --max-time 60 \
    --output "$body_file" \
    --write-out '%{http_code}' \
    --request POST \
    --header "Authorization: Bearer $secret" \
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
