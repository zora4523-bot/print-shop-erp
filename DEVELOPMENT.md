---
status: maintained
owner: project-maintainers
last_verified: 2026-08-24
applies_to: repository development workflow at last_verified
---

# 本地开发指南

## 环境要求

| 工具 | 仓库要求 | 验证命令 |
|---|---|---|
| Node.js | `package.json` 要求 `>=24` | `node -v` |
| pnpm | `packageManager` 固定为 `10.33.1` | `pnpm -v` |
| PostgreSQL | 开发使用独立本地或 Pigsty dev 数据库 | `psql --version` |
| Chromium | Playwright 和打印验证需要 | `pnpm exec playwright install chromium` |

不要从 `create-next-app` 重新生成本项目。始终从受控 Git 仓库 clone，并保留已锁定依赖、迁移和配置。

## 首次启动

```bash
git clone <repository-url> print-shop-erp
cd print-shop-erp
pnpm install --frozen-lockfile
cp .env.example .env
```

在 `.env` 中至少设置指向**专用开发数据库**的 `DATABASE_URL` 和本地 `AUTH_SECRET`。不要复制生产 `.env`。完整变量语义只看 [`.env.example`](./.env.example)。

然后执行：

```bash
pnpm exec prisma generate
pnpm exec prisma migrate deploy
pnpm db:seed
pnpm dev
```

打开 <http://localhost:3000>。同一工作区只运行一个开发服务器；Playwright 默认会复用已经监听 `E2E_BASE_URL` 的实例。

### 补齐工作台演示工单

已有 `e2e-dash-<16位runId>-sub-1/sub-2/sub-3-urgent` 空工单可使用
[`complete-dashboard-order-fixtures.ts`](./scripts/complete-dashboard-order-fixtures.ts) 原位补齐。
它只接受本机非生产数据库和停用的工作台测试销售账号，保留编号、归属、状态和已有基本资料；
有业务明细、金额、快照或账本引用的记录会跳过。默认运行完整计价事务后回滚：

```bash
node --conditions=react-server --import tsx scripts/complete-dashboard-order-fixtures.ts --all
# 核对预览后写入；备份必须为仓库外尚不存在的绝对路径（0600 权限）。
node --conditions=react-server --import tsx scripts/complete-dashboard-order-fixtures.ts --all --apply --admin=e2e-owner --backup=/tmp/dashboard-orders-before.json
```

可用 `--id=<完整测试工单ID>` 代替 `--all`。重复执行会跳过已补齐记录。
脚本创建 1/2/4 款、分袋、单票分货和标有“不可生产”的 SVG 演示图，
复用当前建单计价服务生成加工、包装、物流报价及不可变价格快照；版费默认 0。
它不会伪造 CDR、实称重量或确认/结算金额，也不会执行确认、排产、发货或发送通知。
原始工作台 E2E helper 继续保留空明细场景，不被该脚本替换。

### 管理员 seed

[`prisma/seed.ts`](./prisma/seed.ts) 不再提供固定默认密码：

- 在本地 `.env` 设置 `SEED_ADMIN_USERNAME` 和 `SEED_ADMIN_PASSWORD`，或
- 不设置密码，让 seed 在首次创建管理员时只打印一次随机密码。

不要把随机密码或 `SEED_ADMIN_PASSWORD` 写入提交、截图、共享日志或测试 fixture。首次登录后修改密码。已存在管理员、非活跃管理员和用户名角色冲突的行为见 [DATABASE.md](./DATABASE.md)。

## 日常开发循环

1. `git status --short`，确认已有改动边界。
2. 阅读与任务相关的规格、决策和领域代码。
3. 修改 Next.js API 前阅读当前安装版本 `node_modules/next/dist/docs/` 的相关指南。
4. 先运行目标测试，完成后按风险扩大到全量门禁。
5. 检查 diff、文档和数据库 migration，再交付。

## 常用命令

| 目的 | 命令 |
|---|---|
| 开发服务器 | `pnpm dev` |
| 生产构建 | `pnpm build` |
| 启动构建产物 | `pnpm start` |
| 类型检查 | `pnpm typecheck` |
| ESLint | `pnpm lint` |
| 目标 Vitest | `pnpm test --run <path>` |
| 全量 Vitest | `pnpm test --run` |
| 覆盖率 | `pnpm test --run --coverage` |
| Playwright 全套 | `pnpm test:e2e` |
| Playwright UI | `pnpm test:e2e:ui` |
| 安装 Chromium | `pnpm test:e2e:install` |
| 管理端视觉门禁 | `pnpm test:admin-ui` |
| 师傅端视觉门禁 | `pnpm test:worker-ui` |
| 更新视觉基线 | `pnpm test:visual:update`，仅在确认预期设计变化后使用 |
| 校验 Prisma schema | `pnpm exec prisma validate` |
| 查看 migration 状态 | `pnpm exec prisma migrate status` |
| 创建开发 migration | `pnpm db:migrate -- --name <name>` |
| 生成 Prisma Client | `pnpm exec prisma generate` |
| Prisma Studio | `pnpm db:studio` |
| 环境预检 | `pnpm check:env` |

## 测试环境约束

- Vitest 排除 `tests/e2e`、`tests/visual`、`.next` 和 `generated`。
- Playwright 默认 `baseURL` 是 `http://localhost:3000`，可用 `E2E_BASE_URL` 覆盖。
- 指定与日常库不同的 `E2E_DATABASE_URL` 时，默认端口改为 `3100`，测试服务和 worker 使用同一隔离库，且不复用日常开发服务器。配置会保存不含凭据的原数据库目标，确保 worker 重新加载配置时不会退回 `3000`；不要手工设置内部的 `E2E_ORIGINAL_DATABASE_TARGET` 标记。
- Playwright 当前会操作开发数据库，并依靠每次运行的唯一 fixture 降低冲突；它不是生产只读测试。禁止让 `DATABASE_URL` 指向生产。
- E2E 默认串行；不要为了加速把共享数据库流程改成并行后忽略竞态。
- 报工会产生不可删除的历史记录，必须使用隔离库及已发布的测试工价。重复运行时保留既有报工，按已有累计量断言；合格量与工单件数进度分别填写。打印基线所用提交人名称也须与固定 fixture 一致。
- 同一工作树内，先完成全量单测，再启动 E2E 开发服务器；避免路由/配置回归测试的临时文件被 Next 文件监听器读入。发生测试期间路由缓存异常时，停止该隔离服务器并重建它的 `.next`，不要清理日常工作区或重置数据库。
- `tests/e2e/owner-notifications.spec.ts` 仅在本地可丢弃库（库名 `notif_ui_e2e_*`，通过 `E2E_DATABASE_URL` 指定）且 `NOTIFICATION_MOCK_MODE=true` 时运行。先对该独立库应用完整迁移，使用占位 Bot ID/Secret；绑定回调由 fixture 模拟，不连接真实企业微信。测试命令为 `pnpm exec playwright test tests/e2e/owner-notifications.spec.ts --project=chromium`。已有开发服务器运行时，使用独立源码快照及端口，避免共用 `.next` 开发锁；不要为跑测试重置日常开发库。
- `test:admin-ui` 与 `test:worker-ui` 分别覆盖六个视口、明暗主题、overflow/touch/axe 等契约。
- 只有打印规格保存了像素截图基线。管理端和师傅端门禁不是设计稿像素 diff，不能据此声称全站逐页还原。
- 打印二维码包含 origin；隔离模式通过测试服务的 `APP_PUBLIC_URL` 保持基线 origin 为 `http://localhost:3000`，避免把测试端口变化误判为版式变化。

## 数据库开发

创建 migration、fresh database 验证和禁止事项见 [DATABASE.md](./DATABASE.md)。关键提醒：

- `db:migrate` 只对专用开发库运行；
- 生产只运行 `migrate deploy`；
- 不对生产或共享库运行 `migrate reset` / `db push`；
- 不编辑已应用 migration；
- schema 改动后重新生成 Prisma Client。

## 项目结构入口

| 目录 | 内容 |
|---|---|
| [`app/`](./app/) | App Router 页面、布局与 Route Handlers |
| [`actions/`](./actions/) | Server Actions 与客户端结果类型 |
| [`lib/`](./lib/) | 领域、基础设施和测试 |
| [`components/`](./components/) | UI 原子件、共享业务 UI 和领域组件 |
| [`prisma/`](./prisma/) | Schema、migration、seed |
| [`tests/e2e/`](./tests/e2e/) | 跨页面业务流程 |
| [`tests/visual/`](./tests/visual/) | 响应式、axe、overflow 与打印截图门禁 |
| [`deploy/`](./deploy/) | 生产配置与更新脚本；本地开发不要直接套用 |

更完整的分层说明见 [ARCHITECTURE.md](./ARCHITECTURE.md)，编码与评审标准见 [CONTRIBUTING.md](./CONTRIBUTING.md)。

## 结束开发服务器

优先在启动 `pnpm dev` 的终端按 `Ctrl-C`。如果终端丢失，先准确定位 PID：

```bash
lsof -nP -iTCP:3000 -sTCP:LISTEN
```

只终止确认属于本项目的 PID，不使用宽泛的 `pkill node`。问题诊断见 [TROUBLESHOOTING.md](./TROUBLESHOOTING.md)。
