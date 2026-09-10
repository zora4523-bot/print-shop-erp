---
status: maintained
owner: project-maintainers
last_verified: 2026-08-24
sections_verified: 2026-09-10
applies_to: repository development workflow
verification_scope: scripts, CI and test configuration sections at sections_verified
---

# 本地开发指南

本次核对范围为 `package.json`、CI、Vitest、Playwright 和 smoke 配置；不代表生产环境已验证。
改动需要哪些检查以 [CONTRIBUTING.md](./CONTRIBUTING.md#测试要求) 为准，本文维护可执行命令与环境前置。

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

运行下表中会写入数据库的 Playwright 检查前，必须设置指向独立可丢弃库的 `E2E_DATABASE_URL`，
并确认它与日常 `DATABASE_URL` 目标不同。裸命令不会自动提供隔离，可能写入日常库；
报工/发布验收不得使用这种缺省状态。完整迁移、工价和服务模式前置见 [测试环境约束](#测试环境约束)。

| 目的 | 命令 |
|---|---|
| 开发服务器 | `pnpm dev` |
| 生产构建 | `pnpm build` |
| 启动构建产物 | `pnpm start` |
| 类型检查 | `pnpm typecheck` |
| 完整 lint（ESLint、UI 文案、语义令牌） | `pnpm lint` |
| 架构门禁 | `pnpm check:architecture` |
| 目标 Vitest | `pnpm test --run <path>` |
| 全量 Vitest | `pnpm test --run` |
| 全量单测与覆盖率 | `pnpm exec vitest run --coverage` |
| 浏览器组件（独立 Vitest 配置） | `pnpm test:browser` |
| Playwright 全套（先满足隔离前置；现行配置启动 `next dev`） | `pnpm test:e2e` |
| 业务 E2E 与无 JS 路径 | `pnpm exec playwright test tests/e2e --project=chromium --project=no-js` |
| 打印像素与分页门禁 | `pnpm exec playwright test tests/visual/order-print.spec.ts --project=chromium` |
| 浏览器用例清单（只发现，不执行） | `pnpm exec playwright test --list` |
| Playwright UI | `pnpm test:e2e:ui` |
| 安装 Chromium | `pnpm test:e2e:install` |
| 管理端视觉门禁 | `pnpm test:admin-ui` |
| 师傅端视觉门禁 | `pnpm test:worker-ui` |
| 更新视觉基线 | `pnpm test:visual:update`，仅在确认预期设计变化后使用 |
| 校验 Prisma schema | `pnpm exec prisma validate` |
| 查看 migration 状态 | `pnpm exec prisma migrate status` |
| 创建开发 migration | `pnpm db:migrate -- --name <name>` |
| 生成 Prisma Client | `pnpm exec prisma generate` |
| 完整 fresh 迁移链 | `pnpm test:migrations:fresh`，先满足下文独立空库前置 |
| 业务数据完整性审计 | `pnpm audit:review-data`，记录目标环境与实际业务样本数 |
| 生产依赖安全审计 | `pnpm audit --prod --json`，逐条记录适用性与处理结论 |
| Prisma Studio | `pnpm db:studio` |
| 环境预检 | `pnpm check:env` |

完整 lint 不能用 `pnpm exec eslint .` 代替；后者不执行 UI 文案与令牌检查。单独运行 `vitest` 不会执行 `.browser.spec.tsx`。全量单测通过也不能替代浏览器或覆盖率门禁。若资源争用导致超时，可记录原因后用 `pnpm exec vitest run --coverage --maxWorkers=2` 复测；不得降低阈值或把未解释的失败记作通过。

## 当前 CI 与发布验证缺口

截至本次核对，[Quality 工作流](./.github/workflows/quality.yml) 实际执行：冻结锁文件安装、Prisma generate/validate、完整 fresh 迁移链、架构检查、完整 lint、typecheck、死代码证据、隔离库 migrate/seed、业务数据审计、全量 Vitest 覆盖率和生产构建。

CI 当前仅用 `playwright test --list` 编译用例清单，**没有执行**浏览器组件、业务 E2E、打印和六视口检查，也没有依赖安全审计或部署 smoke。当前上传的仅是死代码证据。CI 绿灯不能据此签署发布验收；补齐执行、环境与报告的任务为 [REL-04](./docs/release-remediation-2026-09-10.md#rel-04-把发布浏览器与安全门禁接入-ci)。任务已规划不等于门禁已上线。

发布验证必须记录冻结候选 SHA、命令、运行模式、数据库隔离方式、通过/失败/跳过数量、跳过原因与证据。所需验证层级及放行标准只在 [贡献指南](./CONTRIBUTING.md#测试要求) 维护；本次历史实测在 [2026-09-10 审查](./docs/audits/2026-09-10-release-readiness.md)，不能沿用为后续候选的通过记录。

## 测试环境约束

- Vitest 的 Node 配置排除 `tests/e2e`、`tests/visual`、`.next` 和 `generated`；浏览器组件由 `vitest.browser.config.ts` 单独执行。
- Playwright 默认 `baseURL` 是 `http://localhost:3000`，可用 `E2E_BASE_URL` 覆盖。
- 指定与日常库不同的 `E2E_DATABASE_URL` 时，默认端口改为 `3100`，测试服务和 worker 使用同一隔离库，且不复用日常开发服务器。配置会保存不含凭据的原数据库目标，确保 worker 重新加载配置时不会退回 `3000`；不要手工设置内部的 `E2E_ORIGINAL_DATABASE_TARGET` 标记。
- Playwright 当前会写入所配置的数据库，未显式隔离时仍可使用日常开发库。发布验证必须显式使用可丢弃隔离库；全量 Vitest 的 PostgreSQL 测试也只对专用测试库运行。禁止把这些测试指向生产，不能以 fixture 名称唯一代替数据库隔离。
- E2E 默认串行；不要为了加速把共享数据库流程改成并行后忽略竞态。
- 报工会产生不可删除的历史记录，必须使用隔离库及已发布、已经生效且覆盖所需操作类型的测试工价。仓库 `config/piecework-price-books/v1.json` 是待填写模板，seed 不代表已经发布工价；测试工价须明确标注非生产并通过正式发布服务建立。缺隔离库或有效工价导致的报工 skip 属于发布前置未满足，不能记作报工已验收。重复运行时保留既有报工，按已有累计量断言；合格量与工单件数进度分别填写。打印基线所用提交人名称也须与固定 fixture 一致。
- 同一工作树内，先完成全量单测，再启动 E2E 开发服务器；避免路由/配置回归测试的临时文件被 Next 文件监听器读入。发生测试期间路由缓存异常时，停止该隔离服务器并重建它的 `.next`，不要清理日常工作区或重置数据库。
- `tests/e2e/owner-notifications.spec.ts` 仅在本地可丢弃库（库名 `notif_ui_e2e_*`，通过 `E2E_DATABASE_URL` 指定）且 `NOTIFICATION_MOCK_MODE=true` 时运行。先对该独立库应用完整迁移，使用占位 Bot ID/Secret；绑定回调由 fixture 模拟，不连接真实企业微信。测试命令为 `pnpm exec playwright test tests/e2e/owner-notifications.spec.ts --project=chromium`。已有开发服务器运行时，使用独立源码快照及端口，避免共用 `.next` 开发锁；不要为跑测试重置日常开发库。
- 默认 `playwright.config.ts` 的 webServer 是 `pnpm run dev --port …`；执行 `pnpm build` 不会把该配置自动切换为 `next start`，非隔离模式还可能复用已有实例。生产构建 E2E 必须用明确启动同一候选构建产物的配置，固定 `next start`、端口、数据库和 mock 环境并保存配置证据。仓库尚未提供统一的发布 Playwright 配置，该配置及 CI 接入属于 REL-04，不能引用临时审查配置为仓库现成功能。
- 同一工作目录不要同时运行 `next dev` 与 `next build`，也不要让生产测试复用未知开发实例。先停止开发服务再构建、启动，或使用独立工作目录及产物目录；切换模式后重新确认进程、端口和候选 SHA。
- `test:admin-ui` 与 `test:worker-ui` 分别覆盖六个视口、明暗主题、overflow/touch/axe 等契约。
- 只有打印规格保存了像素截图基线。管理端和师傅端门禁不是设计稿像素 diff，不能据此声称全站逐页还原。
- `/owner/prices/external-sales/visual-fixture` 明确在 production 返回 not-found。依赖此页面的视觉场景在开发模式单独验收；生产构建验证正式业务入口与真实数据 fixture，并确认视觉专用路由仍不可访问。不得为了通过生产测试而开放该页面，也不得把其预期 not-found 记为真实价格页故障；两层覆盖都需留证。
- 打印二维码包含 origin；隔离模式通过测试服务的 `APP_PUBLIC_URL` 保持基线 origin 为 `http://localhost:3000`，避免把测试端口变化误判为版式变化。
- fresh 迁移验收要求预先创建的 PostgreSQL 16 空库，设置 `FRESH_DATABASE_URL` 与匹配库名的 `FRESH_DATABASE_CONFIRM_DATABASE`，且目标必须不同于常规 `DATABASE_URL`。脚本不创建或删除数据库；非空库与未确认目标会拒绝。完整步骤见 [DATABASE.md](./DATABASE.md)。迁移通过后才可把该可丢弃库用于 seed/E2E；不要对已写入 fixture 的库重新声称执行了 fresh 验收。
- 新库 `audit:review-data` 的零业务样本结果不能证明生产存量正确。生产历史检查、备份恢复与真实基础设施由授权运维依据 [部署入口](./DEPLOYMENT.md) 独立验收。

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

### 多工艺工单验收数据

本地场景生成命令、13 类场景及跨页面核对范围见 [工单场景数据与关联审查](docs/order-scenario-review-2026-09-08.md)。命令默认只预览，显式 `--apply` 才写入；重跑不覆盖已有流转记录。
