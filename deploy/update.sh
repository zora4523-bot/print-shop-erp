#!/usr/bin/env bash
#
# 一键更新部署（红包印刷 ERP）—— 拉新代码上线时运行这一条。
#
#   cd /var/www/print-shop-erp && ./deploy/update.sh
#
# 流程（构建完成后进入短停机窗口；数据库迁移只允许向前修复）：
#   1. 记录当前 commit
#   2. git pull
#   3. pnpm install（完整依赖，构建 + seed 都需要）
#   4. check:env 预检环境变量（抓 mock-mode 等陷阱）
#   5. prisma generate + build（旧进程仍在线）
#   6. 停止 Web + 轻/重 worker，阻断新旧代码并发写库
#   7. prisma migrate deploy（有新迁移才实际改库）
#   8. PM2 startOrReload（同时启动 Web + 轻/重 worker）
#   9. 健康检查探活
#
# 首次部署不要用本脚本（需先配 .env / seed / OSS CORS 等，见 docs/部署指南.md）。
# 本脚本用于「已上线后拉新版本」的日常更新。

set -euo pipefail

HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/api/health/ready}"
WEB_APP_NAME="print-shop-erp"
LIGHT_WORKER_NAME="print-shop-erp-worker-light"
HEAVY_WORKER_NAME="print-shop-erp-worker-heavy"
DEPLOYMENT_QUIESCED=0

on_exit() {
  local exit_code=$?
  trap - EXIT HUP INT TERM

  if [ "$exit_code" -ne 0 ] && [ "$DEPLOYMENT_QUIESCED" = "1" ]; then
    set +e
    pm2 stop "$WEB_APP_NAME" >/dev/null 2>&1
    pm2 stop "$LIGHT_WORKER_NAME" >/dev/null 2>&1
    pm2 stop "$HEAVY_WORKER_NAME" >/dev/null 2>&1
    set -e

    echo >&2 "❌ 发布在停机窗口内失败；Web 与两个 worker 已保持停止。"
    echo >&2 "   数据库迁移可能已经提交，禁止 checkout/启动旧 commit。"
    echo >&2 "   请前向修复当前版本后重新运行 ./deploy/update.sh。"
  fi

  exit "$exit_code"
}

stop_process_if_registered() {
  local process_name="$1"
  if pm2 describe "$process_name" >/dev/null 2>&1; then
    pm2 stop "$process_name"
  else
    echo "==> PM2 进程 $process_name 未注册，按已停止处理"
  fi
}

assert_process_stopped() {
  local process_name="$1"
  local process_pids
  process_pids="$(pm2 pid "$process_name")"
  if [[ "$process_pids" =~ [1-9][0-9]* ]]; then
    echo >&2 "PM2 进程 $process_name 仍有活动 PID：$process_pids"
    return 1
  fi
}

assert_web_loopback_binding() {
  if ! command -v ss >/dev/null 2>&1; then
    echo >&2 "未找到 ss，无法验收 Web 是否仅监听回环地址"
    return 1
  fi

  local listeners
  listeners="$(ss -H -ltn 'sport = :3000' | awk '{print $4}')"
  if [ "$listeners" != "127.0.0.1:3000" ]; then
    echo >&2 "Web :3000 必须且只能监听 127.0.0.1，实际监听：${listeners:-(无)}"
    echo >&2 "拒绝发布：非回环监听会让客户端绕过 Nginx 登录/PDF 限流。"
    return 1
  fi
}

trap on_exit EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

cd "$(dirname "$0")/.."   # 切到项目根
echo "==> 部署目录：$(pwd)"

PREV_COMMIT="$(git rev-parse --short HEAD)"
echo "==> 当前版本：$PREV_COMMIT"

echo "==> [1/9] 拉取新代码"
git pull --ff-only

NEW_COMMIT="$(git rev-parse --short HEAD)"
if [ "$PREV_COMMIT" = "$NEW_COMMIT" ]; then
  echo "==> 代码无更新（仍是 $PREV_COMMIT）。如只想重启：pm2 startOrReload deploy/ecosystem.config.cjs --update-env"
fi

echo "==> [2/9] 安装依赖"
CI=true pnpm install --frozen-lockfile

echo "==> [3/9] 环境变量预检"
NODE_ENV=production node scripts/check-env.mjs
if ! command -v pm2 >/dev/null 2>&1; then
  echo >&2 "未找到 pm2，停止发布（尚未进入停机窗口）"
  exit 1
fi
node --check deploy/ecosystem.config.cjs

echo "==> [4/9] 生成 Prisma Client"
pnpm exec prisma generate

echo "==> [5/9] 构建生产包"
pnpm build

echo "==> [6/9] 停止 Web 与 worker，进入数据库迁移窗口"
DEPLOYMENT_QUIESCED=1
stop_process_if_registered "$WEB_APP_NAME"
stop_process_if_registered "$LIGHT_WORKER_NAME"
stop_process_if_registered "$HEAVY_WORKER_NAME"
assert_process_stopped "$WEB_APP_NAME"
assert_process_stopped "$LIGHT_WORKER_NAME"
assert_process_stopped "$HEAVY_WORKER_NAME"

echo "==> [7/9] 数据库迁移（migrate deploy，无新迁移则 no-op）"
pnpm exec prisma migrate deploy

echo "==> [8/9] 启动新版本 Web 与 worker"
pm2 startOrReload deploy/ecosystem.config.cjs --update-env

echo "==> [9/9] 等待应用就绪并探活…"
ok=0
for i in $(seq 1 15); do
  if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then ok=1; break; fi
  sleep 2
done

if [ "$ok" = "1" ]; then
  assert_web_loopback_binding
  DEPLOYMENT_QUIESCED=0
  echo "✅ 部署成功：$PREV_COMMIT → $NEW_COMMIT，健康检查通过。"
else
  echo >&2 "❌ 健康检查未通过。查日志：pm2 logs print-shop-erp --lines 50"
  false
fi
