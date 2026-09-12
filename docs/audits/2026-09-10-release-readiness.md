# 2026-09-10 发布就绪审查

## 结论与审查边界

**当前不建议发布。** 单测、类型、lint、构建通过不等于发布验收通过；本次已发现账单提交兼容缺陷、依赖安全风险、失效的浏览器测试及部署 smoke 契约缺口。修复任务见 [发布整改任务](../release-remediation-2026-09-10.md)，逐功能证据见 [功能测试矩阵](2026-09-10-release-functional-matrix.md)。

- 起始分支：`codex/fabuceshi`；起始 HEAD：`32a094d9f5c9e74e0fa925610b12464159922d78`。
- 审查包含开始时未提交的打印/PDF/打印权限及对应测试修改。它们不属于本次报告提交。
- 浏览器与构建使用开始审查后复制的源码快照；过程中原工作区仍有其他任务修改，因此结果不代表后续工作区或一个已经冻结的 release SHA。
- 环境：macOS、Node 24.15.0、pnpm 10.33.1、PostgreSQL 16.13、Next.js 16.2.4。真实 PostgreSQL 单测使用测试自建 schema；完整迁移和 E2E 使用本次创建的独立空库。
- E2E 对 `next build` 后的 `next start` 执行，通知/CDR 使用 mock、后台模式为 inline；不能据此证明生产 durable worker、真实企业微信、OSS、反向代理或备份恢复正常。
- 本次仅新增审查资料和开发任务，不修复业务代码，不部署、不 push、不发送真实通知。

## 已执行的门禁

| 检查 | 结果 | 证据与限制 |
|---|---|---|
| `pnpm typecheck` | 通过 | 当前安装版 Next 的 typegen 与 TypeScript |
| `pnpm lint` | 通过 | 文案 0 未豁免命中；令牌 0 新增违例 |
| `pnpm check:architecture` | 通过 | 824 模块、3188 内部依赖；仍有 26 项超长函数债务 |
| 首轮 `pnpm test --run --coverage` | 失败，已复测 | 5946 通过、10 失败、55 跳过；与其他检查并行时主要出现超时 |
| `pnpm test --run --coverage --maxWorkers=2` | 通过 | 571 文件通过、3 文件跳过；5956 用例通过、55 跳过。首轮失败在低并发下全部消失，不能据此认定业务回归 |
| 覆盖率 | 通过现有阈值 | statements 85.23%、branches 79.16%、functions 91.63%、lines 87.06%；没有降低门禁 |
| `pnpm test:migrations:fresh` | 通过 | 独立空库完整 140 条迁移、checksum、最终触发器、加工费真值和空档后置条件 |
| `pnpm db:seed` | 隔离库通过 | 仅初始化本次可丢弃测试库 |
| `pnpm build` | 通过 | 快照依赖目录的跨目录软链接修正后通过；先前软链接错误属于审查环境，不是业务构建回归 |
| `pnpm audit --prod --json` | 失败 | npm 原始 metadata：5 critical、48 high、54 moderate、6 low；这些是依赖告警统计，不是已证明可利用的业务漏洞数量 |
| 基础 HTTP smoke | 通过 | `/login`、live/ready/jobs 200；匿名 `/owner/pigsty` 307；错误 cron 凭据 401 |
| `deploy:smoke --skip-build --require-base-url` | 失败 | Prisma 校验/迁移状态、Puppeteer 启动通过；jobs 的 `smartBot.status=null` 被部署门禁拒绝 |
| 65 个角色/页面组合巡检 | 完成，有异常 | 管理员、销售、师傅；包括销售/师傅访问账号与薪资管理页的拒绝跳转。两个薪资页 `networkidle` 超时后用页面就绪检查复测正常；缺 `orderId` 的外协创建入口按代码预期显示 not-found |
| 客户计价旧入口复测 | 出现运行时错误 | 无参数入口重定向出现 React #310；有一次落入错误页，复测亦记录 pageerror，但后续可恢复；带 section 的正式入口正常 |
| 独立代理层反例测试 | 稳定失败 | `auth={message:配置错误}` 时 `x-middleware-next=1`；仅证明代理层错误放行，不证明领域层数据泄露 |

第一批生产构建 E2E/打印：72 项，46 通过、24 失败、2 跳过。其中打印 27 项，14 通过、13 像素对比失败；业务 E2E 45 项，32 通过、11 失败、2 跳过。浏览器组件按文件独立执行：31 份，24 通过、6 失败、1 超时；超时的通知配置测试另取单例重跑，确认旧字段标签断言失败。批处理误匹配到的 2 个截图目录已排除，不算测试文件。

补充生产构建测试：106 项，41 通过、55 失败、10 跳过。其中师傅六视口明暗测试 12/12 通过；管理端 90 项为 27 通过、53 失败、10 跳过（几何专项按配置只在一个视口执行）；报工/跨岗追加 2 项通过，旧版二维码提示定位器与账单复测各失败 1 项。补测只在隔离库发布了明确标注“非生产”的测试工价，未改变仓库工价模板。

管理端失败包含 13 项生产模式故意禁用的 `/owner/prices/external-sales/visual-fixture` 页面（环境不兼容，不能算真实价格页故障），过期标题/工单号定位器，以及下述图表对比度和抽屉交互观察。六个正式客户计价编辑器在所有六视口通过。多路由用例遇到前置失败即停止，不能将其后续路由记作通过。补测配置把点击超时限制为 10 秒以便定位；账单临时用例同步了现行按钮名，保留业务断言。没有修改产品源码或视觉基线。

所有失败都应区分实现缺陷、过期断言、fixture 前置条件和环境异常；不得通过改回旧文案、放宽权限/金额约束或更新基线掩盖失败。

## 缺陷、门禁缺口与待定位问题

### R07 — P1：月账单表单把 React 内部字段当非法业务字段

生产构建中登录管理员，进入 `/owner/agent-bills`，点击现行“生成或更新草稿”，独立浏览器重复两次返回 HTTP 200，但页面显示英文 `Unrecognized keys: "$ACTION_REF_2", "$ACTION_2:0", "$ACTION_2:1", "$ACTION_KEY"`，账单生成操作被输入校验拒绝。第二次在页面加载后等待 1.5 秒仍复现。

[`actions/agent-monthly-bill.ts`](../../actions/agent-monthly-bill.ts) 的 `formObject` 将所有 string entry 直接交给 `.strict()` schema，没有排除 React 表单协议字段。当前安装的 Next 16.2.4 文档 `node_modules/next/dist/docs/01-app/02-guides/forms.md` 第 70 行明确说明表单转换会包含 `$ACTION_` 额外属性。同一解析器还用于确认、收款与抵扣，需一并验证。

修复时只处理框架协议元数据，保留真实业务输入、幂等键、金额和权限校验。不能简单去掉严格校验。另一次账单 E2E 与 CDR E2E 出现长时间 pending；这与明确的元数据拒绝是不同观察，尚未证明同一根因，需保留重现与网络证据继续排查。

### R01 — P1：当前 Next.js 版本命中适用的安全公告

`package.json` 锁定 Next.js 16.2.4，本项目大量使用 App Router 和 Server Actions。官方公告说明受影响版本的 Server Function 请求反序列化可造成 CPU 耗尽；16.2.4 位于受影响范围。该风险在业务 action 的权限校验之前也需要处理，不能以现有 action 单测通过放行。[Next.js 官方公告](https://github.com/vercel/next.js/security/advisories/GHSA-8h8q-6873-q5fj)

其他告警须逐条做适用性分析：Windows RCE 不适用于当前 Linux 部署；Email magic-link 漏洞不适用于当前 Credentials 登录；AVIF 图片优化公告需核对图片输入可达性。升级目标应覆盖审计时仍适用的全部公告，不应只升级到最早修补某一条漏洞的版本。保留 Prisma adapter 补丁并同步验证 `next`、`@next/env`、`eslint-config-next` 兼容性。

### R02 — P2：认证配置错误对象会被代理层当作登录态

[`proxy.ts`](../../proxy.ts) 的 `if (req.auth)` 只判断对象存在。当前 next-auth 5.0.0-beta.31 处于官方公告影响范围；当认证库返回配置错误对象时，代理会放行匿名请求。临时反例测试已确认该分支行为。[Auth.js 官方公告](https://github.com/nextauthjs/next-auth/security/advisories/GHSA-8fpg-xm3f-6cx3)

[`lib/auth/session.ts`](../../lib/auth/session.ts) 会进一步验证 user.id 和数据库账号，故不将它夸大为“全站可越权”。修复代理判断、升级认证依赖，并补配置错误对象/空 user/账号停用测试。npm 审计与上游页面的严重性标签并不完全一致，本报告按项目实际边界定级。

### R03 — P1：浏览器测试没有进入 CI，已有测试无法加载

[`quality.yml`](../../.github/workflows/quality.yml) 只执行 `playwright test --list`，未运行 E2E、浏览器组件或视觉测试；也没有生产依赖安全门禁。

[`OrderEditorAuxiliary.browser.spec.tsx`](../../components/business/order/__tests__/OrderEditorAuxiliary.browser.spec.tsx) 第 12 行整体 mock `ui-business`，仅返回旧版 `ConfirmActionDialog`，实际组件已经导入 `ConfirmActionController`，因此测试在 import 阶段失败。`OrderChangeForms.browser.spec.tsx` 存在同类旧 mock。这不代表组件本身缺少导出，而是测试替换模块不完整。

### R04 — P1：关键 E2E 与现行文案/规则不一致

- [`bill-flow.spec.ts`](../../tests/e2e/bill-flow.spec.ts) 等待“生成 / 同步 DRAFT”；实际按钮为“生成或更新草稿”，90 秒后超时，尚未验证冻结与收款。
- [`cs-accumulate.spec.ts`](../../tests/e2e/cs-accumulate.spec.ts) 第 128 行要求 `PENDING_ADMIN_CONFIRMATION`，实际 `AUTO_CONFIRMED`。这与 [DECISIONS.md](../../DECISIONS.md)“独立版费默认 0 元”的现行决策一致，属于用例未同步，不应改坏业务实现来迁就测试。
- 报工、价格、通知的测试前置条件必须显式创建或声明，不能用静默 skip 代替发布验收。

### R05 — P2：本地部署 smoke 无法接受未配置机器人的 inline 健康响应

实际 `/api/health/jobs` 返回 `status=ok`，且 `smartBot={status:null,required:false,configurationValid:true,identityMatch:null,operational:true}`；[`deploy-jobs-gate.mjs`](../../scripts/deploy-jobs-gate.mjs) 只接受枚举字符串，导致文档中的本地 smoke 流程失败。

应明确 inline/未要求机器人时的兼容语义并添加路由到 gate 的集成契约测试；生产 durable 模式仍须验证 worker 心跳、机器人要求和连接故障。不能简单允许任意缺字段响应通过。

### R06 — P2：客户计价无参数入口重定向出现 React #310

管理员打开 `/owner/rules/customer-pricing`，服务端在 [`CustomerPricingWorkspacePage.tsx`](../../components/business/rules/pricing/CustomerPricingWorkspacePage.tsx) 将其重定向到 `?section=blank`。生产构建浏览器巡检捕获 React #310，一次显示全页错误兜底；复测记录同类 pageerror，但页面后来恢复。`?section=blank` 和 `?section=machine` 正常。

栈顶位于 Next AppRouter 的 `useMemo`；目前未证明应用组件违反 Hooks 规则。修复任务应先随框架升级复测，再处理该重定向链，并覆盖直接访问、软导航、返回、刷新。不应将其描述为整个价格配置模块持续不可用。

### R08 — P2 待定位：移动视口销售抽屉关闭点击被遮挡

销售列表聚焦测试在 375、393、768 宽度失败，日志显示 `sheet-header` 内 flex 容器拦截“关闭”按钮指针；1024、1280、1920 宽度通过。涉及 [`SalesOrdersList.tsx`](../../components/business/order/SalesOrdersList.tsx) 与 [`sheet.tsx`](../../components/ui/sheet.tsx)。

独立浏览器以相同销售账号，在 375 宽度（含 touch/mobile/reduced-motion）打开当前首张工单，按钮中心命中自身且成功关闭。因此目前只确认测试场景中的交互失败，尚未证明所有抽屉都存在实现缺陷。应固定失败时的工单长标题、数据、动画和 hash 导航状态，再测正常点击与返回/前进，不得用 force click 绕过。

### R09 — P2：深色业绩图表 tooltip 文字对比度不足

1920×1080 管理概览明暗检查中，axe 捕获 `.recharts-tooltip-item-name` 的“业绩”和 `.recharts-tooltip-item-value`：黑色 `#000000` 文字位于 `#171717` 背景，对比度 1.17，低于门禁 4.5。涉及 [`SalesRankingChart.tsx`](../../components/business/dashboard/SalesRankingChart.tsx) 的 Tooltip 样式。其他五视口通过不代表 tooltip 的 hover 状态已经覆盖；应显式触发浮层复测。

## 发布环境仍需验收

- 冻结明确 release SHA，所有本批修改完成提交并在同一候选上重跑失败门禁。
- durable LIGHT/HEAVY worker、版本一致心跳、任务排队/重试/死信/PDF 产物链路。
- 实际工价首版发布与生效时间；仓库 [`v1.json`](../../config/piecework-price-books/v1.json) 仍为待填写模板，不能用于生产报工验收。
- 真实 OSS 上传、下载、中文 PDF 与图片；真实企业微信发送和绑定需另行明确授权，不在本次测试中发送。
- 生产库迁移状态、无效索引、历史外协证据、备份恢复演练和回退约束，按 [上线前置操作清单](../上线前置操作清单.md) 与 [SLO/恢复文档](../production-slo-and-recovery.md) 留证。
- 隔离新库的数据审计是零业务数据结果，不能作为生产历史数据已正确的证明。

## 证据位置

本机原始日志位于 `/tmp/erp-release-*.log`；审计 JSON 为 `/tmp/erp-release-dependency-audit.json`；65 组页面巡检为 `/tmp/erp-release-route-scan.json`；源码快照、截图与独立复现位于 `/tmp/erp-release-review-20260910/`。临时目录不保证长期保存，后续提交以本报告归档摘要为准。测试数据库连接凭据未写入仓库。
