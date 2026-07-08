#!/usr/bin/env bash
#
# 一键更新部署（红包印刷 ERP）—— 拉新代码上线时运行这一条。
#
#   cd /var/www/print-shop-erp && ./deploy/update.sh
#
# 流程（任一步失败即中止，不会留下半更新状态）：
#   1. 记录当前 commit（失败可回滚）
#   2. git pull
#   3. pnpm install（完整依赖，构建 + seed 都需要）
#   4. check:env 预检环境变量（抓 mock-mode 等陷阱）
#   5. prisma migrate deploy（有新迁移才实际改库）
#   6. prisma generate + build
#   7. pm2 reload（平滑重启，不中断在线用户）
#   8. 健康检查探活
#
# 首次部署不要用本脚本（需先配 .env / seed / OSS CORS 等，见 docs/部署指南.md）。
# 本脚本用于「已上线后拉新版本」的日常更新。

set -euo pipefail

APP_NAME="${APP_NAME:-print-shop-erp}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/api/health}"

cd "$(dirname "$0")/.."   # 切到项目根
echo "==> 部署目录：$(pwd)"

PREV_COMMIT="$(git rev-parse --short HEAD)"
echo "==> 当前版本：$PREV_COMMIT（失败可 git checkout $PREV_COMMIT 回滚）"

echo "==> [1/7] 拉取新代码"
git pull --ff-only

NEW_COMMIT="$(git rev-parse --short HEAD)"
if [ "$PREV_COMMIT" = "$NEW_COMMIT" ]; then
  echo "==> 代码无更新（仍是 $PREV_COMMIT）。如只想重启：pm2 reload $APP_NAME"
fi

echo "==> [2/7] 安装依赖"
CI=true pnpm install --frozen-lockfile

echo "==> [3/7] 环境变量预检"
node scripts/check-env.mjs

echo "==> [4/7] 数据库迁移（migrate deploy，无新迁移则 no-op）"
pnpm exec prisma migrate deploy

echo "==> [5/7] 生成 Prisma Client"
pnpm exec prisma generate

echo "==> [6/7] 构建生产包"
pnpm build

echo "==> [7/7] 平滑重启 PM2"
pm2 reload "$APP_NAME" --update-env

echo "==> 等待应用就绪并探活…"
ok=0
for i in $(seq 1 15); do
  if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then ok=1; break; fi
  sleep 2
done

if [ "$ok" = "1" ]; then
  echo "✅ 部署成功：$PREV_COMMIT → $NEW_COMMIT，健康检查通过。"
else
  echo "❌ 健康检查未通过！应用可能没起来。"
  echo "   查日志：pm2 logs $APP_NAME --lines 50"
  echo "   回滚：git checkout $PREV_COMMIT && CI=true pnpm install && pnpm build && pm2 reload $APP_NAME"
  exit 1
fi
