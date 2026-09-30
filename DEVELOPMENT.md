---
status: maintained
owner: project-maintainers
last_verified: 2026-08-24
sections_verified: 2026-09-11
applies_to: repository development workflow
verification_scope: scripts, CI and test configuration sections at sections_verified
---

# 本地开发指南

计件工价发布入口 `pnpm piecework:publish` 支持版本递增及按盒费率；默认只读，旧 `piecework:publish-v1` 兼容保留。正式配置填写和发布参数见 [工价发布步骤](./docs/管理员建单定价与装盒修复-20260913.md#员工按盒工价发布)。专项数据库回归需显式设置 `ERP_PRICING_REPAIR_DB_TEST=1`，仅连接准备过包装 E2E fixture 的独立测试库。

若唯一的未来统一工价已取消，且没有现有草稿，CLI 会提示到 `/owner/rules/employee-pay` 新建草稿发布；不以取消版本充当当前发布修订，不复用旧编号。发布与取消前向迁移须在同一停写维护窗口切换所有运行进程，见 [部署指南](docs/部署指南.md#未来计件调价取消开关2026-09-28)。

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

打开 <http://localhost:3000>。同一工作区只运行一个开发服务器；Playwright 使用独立端口且不复用已有实例。

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
并设置匹配库名的 `E2E_DATABASE_CONFIRM_DATABASE`。预检拒绝缺失确认、生产式库名、
与日常 `DATABASE_URL` 相同的目标及不受控服务地址；在启动服务或首次连接前失败。完整迁移、工价和服务模式前置见 [测试环境约束](#测试环境约束)。

| 目的 | 命令 |
|---|---|
| 开发服务器（含后台依赖检查） | `pnpm dev` |
| 仅 Web（worker 由外部管理时） | `pnpm dev:web` |
| PDF 字体、渲染及产物存储检查 | `pnpm check:pdf` |
| 生产构建 | `pnpm build` |
| 启动构建产物 | `pnpm start` |
| 类型检查 | `pnpm typecheck` |
| 完整 lint（ESLint、UI 文案、语义令牌） | `pnpm lint` |
| 架构门禁 | `pnpm check:architecture` |
| 死代码候选盘点（生成 `.review/dead.json`） | `pnpm check:dead-code` |
| 死代码候选增量门禁（与 CI 一致） | `pnpm check:dead-code --check` |
| 目标 Vitest | `pnpm test --run <path>` |
| 全量 Vitest | `pnpm test --run` |
| 全量单测与覆盖率 | `pnpm exec vitest run --coverage` |
| E2E 隔离预检（只读） | `pnpm test:e2e:preflight` |
| 修复测试纸张目录并发布非生产测试工价（仅隔离库） | `pnpm test:e2e:prepare` |
| 发布构建、业务与视觉门禁 | `pnpm test:release` |
| 持久任务排队/重试/下载门禁 | `pnpm test:release:durable` |
| 开发专用价格视觉 fixture | `pnpm test:release:dev-fixtures` |
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

### 死代码候选审查

`config/dead-code-baseline.json` 登记现存待核实候选，不代表其中代码可以删除。
Knip、ts-prune 和循环依赖扫描共同生成证据；CI 对照稳定的文件/符号标识，忽略行号漂移。
ts-prune 内置 TypeScript 4.5，不支持应用的 `bundler` 模块解析；扫描单独使用 `tsconfig.dead-code.json` 的 `node` 解析，保证别名指向的目录入口可被识别。应用继续使用原 `tsconfig.json`。
新增候选会失败；已消失候选也必须从基线移除，避免留下允许旧代码重新进入的豁免。
扫描器错误、基线缺失或格式错误均失败，检查命令不会自动更新基线。

处理失败时先读 `.review/dead.json`，核对实际入口、调用链、动态加载、脚本、公开 API、
数据库外键和历史快照，再决定修复调用或删除代码。确需保留的新候选须逐项写明实际用途和证据，
在同一审查中更新对应基线条目；不能批量刷新基线来消除红灯。
测试引用不能证明生产使用，模块内使用也不代表整个函数可删；扫描绿灯不证明全仓没有遗留逻辑。
本次已清理项和保留项见 [旧产品代码审查](docs/audits/2026-09-21-legacy-code-cleanup.md)。

## 当前 CI 与发布验证缺口

[Quality 工作流](./.github/workflows/quality.yml) 自 2026-09-19 起拆成并行作业（等待时间优先，见 DECISIONS 同日条目）：`static`（冻结安装、依赖安全审计、Prisma generate/validate、架构 / 备份脚本 / 完整 lint / typecheck、死代码候选增量门禁，无数据库、无浏览器，PR 与 `main` 都跑）、`unit`（完整 fresh 迁移链、业务数据审计、全量单测与覆盖率）、`browser-components`（2 片）、`build`（用 `scripts/e2e-release-build.ts` 构建一次 `.next-release`，以 tarball 传给分片——`upload-artifact` 不保留 Turbopack 的外部包符号链接，直接传目录会让 `sharp` 找不到依赖）、`e2e` 六个分片（`chromium` 1/3–3/3 业务 E2E、`admin-375x667`、`admin-1280x800`、`worker + no-js`；即 **两视口**门禁 375×667 / 1280×800；各自 `E2E_PREBUILT=1` 复用共享构建，独占 runner / 库 / 服务，片内仍 `workers: 1`）、`durable`（真实 durable worker 排队 / 重试 / 授权下载）、`compat`（跨浏览器，唯一需要 WebKit 的作业）、`dev-fixtures`（开发专用价格 fixture，两视口）。合并进 `main` 后由 `viewports-main` 跑管理端与师傅端全部六视口及六视口 dev fixtures；`push: main` 不再重复 PR 已验证过的其余套件。纯文档改动（`**/*.md`、`docs/**`）不触发。公共步骤在 `.github/actions/setup` 与 `.github/actions/browsers`（浏览器缓存、按需安装）。

2026-09-29 补齐 `unit` 的隔离前置：fresh 链验证后的 `erp_e2e_ci` 单独 seed，并通过现有 `test:e2e:prepare` 发布仅用于测试的工价和目录 fixture；Vitest 进程显式使用 `DATABASE_URL="$E2E_DATABASE_URL"`，与确认的 E2E 库一致。仓库维护、表单创建幂等、工价取消、排单完工四组 PostgreSQL 套件必须实际执行；合并时核对 JSON 报告，不把前置不足导致的 skip 计作通过。覆盖率门槛保持不变。

现有打印像素基线仅有 Darwin 版，独立的 [Print (Darwin) 工作流](./.github/workflows/print-darwin.yml) 使用固定 `macos-26`、Node 24、PG16 的专属临时数据目录和 55432 端口，真实生产构建后运行原打印规格，明确 `--update-snapshots=none`；macOS 按 10 倍计费，因此只在打印相关路径变动或手动 `workflow_dispatch` 时运行。Linux 排除打印与开发专用 fixture 时保留两项过滤，避免 CLI 覆盖配置后误执行生产不可达页面。每个作业每次都上传 `.review/`（审计与各套件 JSON，用于分析耗时），覆盖率、报告、截图和 trace 只在失败时上传；均启用 `include-hidden-files`，使 `.review` 和 `.vitest-attachments` 不被默认忽略。CI 下 Playwright trace 为 `on-first-retry`。

2026-09-11 PR #16 前两轮远端执行分别暴露了导入文案扫描、全仓按钮 AST 扫描的 5 秒超时。这两项集成扫描使用独立的 20 秒执行上限，扫描范围及全部语义断言保持。Darwin 仍有 13 项字体截图差异：CI PDF 出现额外 Helvetica 回退，对齐系统语言偏好未消除差异，该尝试已撤回。截图基线与比较阈值未改，CI 专用基线须先取得业务确认，修正结果以最新 PR checks 为准。

下述为此前本地整改时的仓库配置与保护查询记录：当时尚未推送或运行远端 CI。2026-09-11 只读查询显示 main 的 `protected=false`；保护与规则集接口返回 403，提示当前私有仓库套餐限制，因此 required checks 尚未强制执行。工作流语法通过不能替代远端通过与分支保护验收。真实通知、生产 worker、生产存量与部署 smoke 仍须按 REL-07 独立留证。认证配置的 `skipProxyUrlNormalize` 用于保留 Next 16.3 预取标头；修改时必须重跑登出晚响应竞态与公共/受保护路径回归。当前本地实测与未通过项见 [整改执行记录](./docs/audits/2026-09-11-remediation-validation.md)。

发布验证必须记录冻结候选 SHA、命令、运行模式、数据库隔离方式、通过/失败/跳过数量、跳过原因与证据。所需验证层级及放行标准只在 [贡献指南](./CONTRIBUTING.md#测试要求) 维护；本次历史实测在 [2026-09-10 审查](./docs/audits/2026-09-10-release-readiness.md)，不能沿用为后续候选的通过记录。

## 测试环境约束

- Vitest 的 Node 配置排除 `tests/e2e`、`tests/visual`、`.next` 和 `generated`；浏览器组件由 `vitest.browser.config.ts` 单独执行。
- 开发 Playwright 固定默认 `http://127.0.0.1:3100`，发布配置默认 `http://127.0.0.1:3200`。`E2E_BASE_URL` 只接受本机独立端口，拒绝 3000、远程地址和带路径/query 的地址；所有模式 `reuseExistingServer=false`。
- `E2E_DATABASE_URL` 与匹配库名的 `E2E_DATABASE_CONFIRM_DATABASE` 必填。库名须含独立 `test` / `e2e` / `ci` 分段且不含 `prod` / `production` / `live`；数据库名称必须与日常 `DATABASE_URL` 不同，即使主机不同也拒绝同名，避免 DNS 别名绕过隔离。主机百分号解码、大小写与末尾点规范化后比较，localhost、127.0.0.1、::1 视为同一主机。原目标标记只在已激活的 Playwright 子进程重载中保留；普通启动重新读取当前 URL。不要设置内部标记或 URL query 来替换主机/库名。`--list` 只收集，不连接；实际执行在 webServer/globalSetup 双重预检。
- 全量 Vitest 的 PostgreSQL 测试也只对专用测试库运行，不能用 fixture 名称唯一代替隔离。CI unit 使用 `erp_e2e_unit`；生成 `.review/unit-tests.json` 后执行 `node scripts/check-blank-migration-tests.mjs`，强制空白封价格与 BOM 迁移套件实际通过，缺失、失败或跳过均失败。
- 先 migrate/seed 隔离库，再执行 `test:e2e:prepare`。测试进程同时提供 `SEED_ADMIN_USERNAME` / `SEED_ADMIN_PASSWORD`（或明确 E2E_ADMIN 覆盖）；只设置数据库不能完成登录前置。
- `test:e2e:prepare` 先在已确认的隔离库执行 `prepare-e2e-catalog.ts`，复用 `retire-unused-paper-imports` 的完整库存、外键、历史快照、标准纸张唯一性检查及审计，再发布测试工价。空库迁移仍会恢复旧导入记录，因此不能省略此步骤或放宽工单纸张身份校验；记录已使用或改变时直接失败。此入口拒绝日常/生产库，不代替正式环境按运维流程演练和确认修复，也不修改旧迁移。
- E2E 默认串行；不要为了加速把共享数据库流程改成并行后忽略竞态。
- 报工会产生不可删除的历史记录，必须使用隔离库及已发布、已经生效且覆盖所需操作类型的测试工价。仓库 `config/piecework-price-books/v1.json` 是待填写模板，seed 不代表已经发布工价；测试工价须明确标注非生产并通过正式发布服务建立。执行 `pnpm test:e2e:prepare` 通过正式服务发布并等待生效，工价清楚标记 E2E ONLY，重复准备幂等。发布配置缺少这些前置直接失败，不能以 skip 验收。重复运行时保留既有报工，按已有累计量断言；合格量与工单件数进度分别填写。打印基线所用提交人名称也须与固定 fixture 一致。
- 同一工作树内，先完成全量单测，再启动 E2E 开发服务器；避免路由/配置回归测试的临时文件被 Next 文件监听器读入。发生测试期间路由缓存异常时，停止该隔离服务器并重建它的 `.next`，不要清理日常工作区或重置数据库。
- `tests/e2e/owner-notifications.spec.ts` 复用上述隔离预检且要求 `NOTIFICATION_MOCK_MODE=true`；绑定回调由 fixture 模拟，不连接真实企业微信。标准开发及发布 Playwright 配置为隔离服务设置测试 AUTH/CRON secret、mock 通知/CDR、inline jobs，不代表生产基础设施通过。
- 默认 `playwright.config.ts` 仍用于 `next dev`。`playwright.release.config.ts` 明确执行 `prisma generate → next build → next start`，产物为 `.next-release`、使用 `tsconfig.release.json`，不复用开发服务。`playwright.dev-fixtures.config.ts` 仅执行开发专用价格 fixture，生产组明确排除该组。
- CI 的业务 E2E 使用 `erp_e2e_ci`，调价用例会发布不可变的后继工价。后台任务、跨浏览器及开发价格 fixture 使用另建的 `erp_e2e_artifacts_ci`，独立 migrate/seed/prepare，不重置前一套数据库、不回写已发布工价。手动串行运行这些套件时也应切换至具备初始工价的独立 E2E 库。
- `playwright.durable.config.ts` 使用 `BACKGROUND_JOBS_MODE=durable`、独立 `.next-durable` 产物和 `tsconfig.durable.json`；默认端口 3300，可用 `E2E_DURABLE_BASE_URL` 指定受同一预检约束的地址。该组由用例启动真实 HEAVY worker，验证持久队列、失败重试和下载；通知及 CDR 仍为 mock，不代表真实外部服务通过。
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

本地场景生成命令、13 类场景及跨页面核对范围见 [工单场景数据与关联审查](docs/archive/order-scenario-review-2026-09-08.md)。命令默认只预览，显式 `--apply` 才写入；重跑不覆盖已有流转记录。

### 发货登记验证

新增 `tests/e2e/shipment-registration.spec.ts` 必须配置与日常数据库不同的 `E2E_DATABASE_URL`，由现有隔离门禁控制。测试保留带随机前缀的测试记录供审查，不重置数据库。执行 `pnpm exec playwright test tests/e2e/shipment-registration.spec.ts --project=chromium --workers=1`。同一工作区运行 Next 开发服务与隔离 E2E 时需依次启动，避免 `.next/dev` 锁冲突。

Next、`@next/env`、`eslint-config-next` 锁定到本地已验证的 16.3.4，保持之前已采用的 `catchError/retry` API 可复现；新增直接依赖 sharp 0.35.4，用于服务端解码、限像素、移除图片元数据并转 JPEG。

## 旧导入纸张资料修复

`pnpm exec tsx scripts/retire-unused-paper-imports.ts` 默认演练并回滚，仅针对已确认的三条旧导入资料。适用条件、写入方式、审计与恢复步骤统一见 [部署指南](./docs/部署指南.md#旧导入纸张身份冲突的一次性修复)。它不参与开发服务器启动，也不替代数据库迁移。

### 跨设备打印测试

安装 `pnpm exec playwright install chromium webkit` 后运行 `pnpm test:compat`，使用已有隔离数据库 preflight 和真实 production build/start，覆盖桌面 Chromium/WebKit、iPhone WebKit 与 Android Chromium 模拟。此命令不代表真机验收。`pnpm test:release tests/visual/order-print.spec.ts --project=chromium --update-snapshots=none` 继续执行已有像素门禁；新字体需审查实际差异后批准基线。新增字体/存储/快照测试与标准全量 Vitest 一起运行；部署与实测范围见 [跨设备打印](./docs/跨设备打印与可用性.md)。

专版单色平烫数量档位的 2026-09-13 更新，按[专版阶梯更新说明](./docs/专版阶梯更新-20260913.md)执行版本化发布；新装数据库迁移后同样需要应用该价格配置。

### 包装类型开发验收（2026-09-13）

新增迁移及价格初始化步骤见 [包装类型实施记录](./docs/包装类型实施-20260913.md)。写入型测试必须使用独立数据库；包装 E2E 在 `tests/e2e/order-packaging-types.spec.ts`，纯计价边界在 `lib/price/__tests__/create-order-box-packaging.test.ts`，打印门禁在 `tests/visual/order-print.spec.ts`。不得用日常数据库运行写入夹具。

### 空白封单价改造工具（2026-09-20）

- `scripts/maintenance/preflight-blank-price-policy.ts --database-url <目标库>`：显式目标、只读事务，报告所有 STOCK_BASE 身份重复、存量绑定产品零价、产品与价格文本漂移、停售/缺价、历史材料价证据、BOM 映射和 Product 引用。零价清单及身份漂移会阻断自动切换；新政策无产品绑定的零价仍表示未启用。预检与调价草稿共用身份校验，不输出连接凭据，不授权删除。
- 切换使用 `scripts/maintenance/deploy-blank-price-migrations.ts` 的显式目标保护，步骤只维护在[部署指南](./docs/部署指南.md#空白封按单价管理的升级前置2026-09-20)。该工具只允许这两条待执行迁移，不代替备份、停写和 BOM 复制。
- `scripts/maintenance/migrate-blank-bom-targets.ts --database-url <目标库>`：默认只读；核对计划后 `--apply` 复制旧目标并审计，必要时明确 `--default-category-id`。多源歧义必须解决，不能猜第一条。
- `scripts/maintenance/compare-paper-specs.ts`：对同库、同时间和相同用例读取前后真实目录及报价；按新政策捕获的准入差异必须逐项精确声明，正价金额不可加入忽略名单。完整实测参数与摘要见[验收记录](./docs/audits/2026-09-20-blank-price-implementation.md)。

以上工具用 `node --conditions=react-server --import tsx <脚本>` 执行。写入型验证继续遵循独立可丢弃 E2E 库要求；日常库预检结果不代替正式库。

### 历史生产数据清理脚本（2026-09-24）

`scripts/maintenance/cleanup-stuck-production-history.ts` 处理审计 M-7（旧代次卡住的工序 / 进度步骤）与
L-14（从未下发却提前写入的 `scheduledAt`）。`--database=<库名>` 必须等于实际连接库；默认只读事务 dry-run，
`--apply --actor=<活跃管理员>` 才写入，并在锁内、写入前把逐行原状态与 `payrollReviewRequired` 记进
OrderLog 与 BusinessAuditLog 的 before。生产执行步骤（dry-run → 业主核对 → `--apply`）只维护在
[部署指南](./docs/部署指南.md#卡住--写脏的历史生产数据清理2026-09-24)。本地验证只在一次性隔离库上写入。

## 生产事实核对与恢复（2026-09-28）

重做未下发、数量申请被旧版取消、工资日期已结算或历史生产不明时，按 [生产事实恢复手册](docs/生产事实恢复手册.md) 先只读扫描，再逐单据证处理。不要通过换日期、改负责人、删除申请或解锁原账绕过守卫。

### PDF 开发与回归（2026-09-30）

`pnpm dev` 使用 `scripts/dev-stack.mjs`。未设置后台模式时默认 durable，先启动 LIGHT/HEAVY；HEAVY 必须完成真实中文 PDF 与私有产物读写检查，两类 worker 的本次启动心跳均就绪后才启动 Web。默认监听 127.0.0.1:3000，支持 `--port`、`--hostname`。端口冲突在 worker 启动前拒绝；任一子进程异常退出会停止整组，Ctrl-C 统一收尾。此开发入口固定模拟通知，不用于生产。显式 `BACKGROUND_JOBS_MODE=inline` 只启动 Web，但仍先检查 PDF 运行时。

`pnpm dev:web` 保留仅 Web 入口，适用于外部进程管理或手动控制 worker 的测试；它本身不保证 durable PDF 可用。`pnpm check:pdf` 使用当前环境、当前 Chromium 与内嵌字体，实际生成一页中文 PDF，并验证存储往返；只操作自己的随机探针产物。

PDF 恢复验收：满足本文件 E2E 隔离前置后运行 `pnpm exec playwright test --config=playwright.pdf.config.ts`。测试使用真实 Next 开发服务及独立 HEAVY worker，覆盖服务离线、六视口双主题、触控、axe、就地状态查询、生成和重复下载；不代表生产构建、真实 OSS 图稿或通知验收。

单张下载现默认 `PDF_ORDER_MODE=direct`，不依赖后台 worker；`pnpm dev` 仍管理其他业务需要的 LIGHT/HEAVY。直接路径验收使用 `E2E_PDF_ORDER_MODE=direct pnpm exec playwright test --config=playwright.pdf.config.ts`：仅启动 Web，覆盖多页下载、缓存、匿名拒绝、不入队及 HTML 打印准备。未指定该测试变量时验证 queued 恢复路径，`playwright.durable.config.ts` 也显式固定 queued 以保留原任务链验收。两种模式都保留下载协议与授权检查。
