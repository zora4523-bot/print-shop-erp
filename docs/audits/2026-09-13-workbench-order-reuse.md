# 工作台报价复用建单验收（2026-09-13）

## 范围与事实源

候选为 `cebc63f1` 加本次工作区增量；该提交是任务开始时 HEAD，分支 `codex/gongdanceshi`。开始时无跟踪文件改动，已有五组未跟踪测试截图目录保持原状，不纳入提交。

用户批准将工作台报价复用建单自动计价，仅叠加参考加价。权威输入来自 `createOrderQuoteItemsSchema`、有效建单目录与工艺；金额来自 `calculateCreateOrderQuoteFromCatalogInTx` 和已发布规则。此任务未改价格、历史快照、数据库 schema、迁移、生产账本或普通开发库配置。

## 实现

1. 将建单目录推导、初始化/归一化、字段切换和字段组件提取为共享模块。`OrderForm` 保留多款、设计图、收货、包装、报价签名和提交编排；工作台使用单款输入及加工费结果。
2. 修正动态纸张目录下覆膜被固定 `COATED` 标识判断清除的问题；统一使用纸张外观类型。迷你封可用性由当前有效产品/纸张/规格组合决定，移除失效的 `PEARL_FLASH` 固定白名单及其提示。此处只控制选择候选，正式目录与价格校验仍在服务端。
3. `quoteWorkbenchItemAction` 先授权再校验共享 schema，委托单款服务投影。加价用原 Decimal helper 在本地计算，未知金额不转零；旧请求无法覆盖新条件。
4. 临时带入只保存款式事实，账号隔离、随机标识、30 分钟有效。建单重新核对目录并重新报价；已有草稿可以继续，也可把本次报价另存，互不覆盖。此入口不创建/提交数据库工单，不携带加价或金额。
5. 两栏报价页使用共享 UI 原子件与语义 token；明细折叠，窄屏纵向排列，交互控件满足 44px 门禁。保留纸张资料和 17 个话术场景。

## 删除与兼容依据

- `WorkbenchCalculator` 原先直接消费 `WorkbenchProductFields`、`WorkbenchChoice`、`workbench/defaults`；新组件已消费共享建单字段和初始化函数。检查了它们的实际静态调用链、测试、构建配置、脚本、Prisma 与迁移，未发现动态注册或外部入口，因此连同仅验证旧默认实现的测试删除。
- `QUOTE_GUIDE` 唯一消费方是工作台的长期解释卡片；删除卡片与常量，销售话术/纸张资料保留。
- 原 `external-order-b-catalog.ts` 保留转导出，现存订单调用方/测试继续可用。旧 `quoteWorkbenchAction` 是已记录的契约，保留原签名与目录解析，仅计算体委托同一服务；它仍消费 `workbench/catalog.ts`，所以保留该文件。
- 正式计价引擎、规则配置、SQL、Prisma schema 和已应用迁移没有删除或修改。

## 验证环境与命令

Node 24、Next 16.3.4；核对本地安装包的 Server Action 与路由文档。未降低测试、覆盖率或 UI 门禁。

本机 Vitest 默认 config bundle loader 曾在启动阶段无输出。为完成原范围检查，用仓库配置生成临时等价 ESM 配置，仅显式设定 repo root、绝对 alias/import 和 `__dirname`，通过 `--configLoader native` 加载；保留原测试范围、浏览器 provider、axe 与覆盖率阈值。临时配置未纳入产品提交。

- 全量：`pnpm exec vitest run --config /tmp/workbench-vitest.config.ts.mjs --configLoader native --maxWorkers=2 --coverage --coverage.reportOnFailure`。
- 浏览器：`pnpm exec vitest run --config /tmp/workbench-vitest.browser.config.ts.mjs --configLoader native components/business/workbench/__tests__/SalesWorkbench.browser.spec.tsx components/business/order/__tests__/OrderFormBNavigation.browser.spec.tsx`：35 项通过，含六视口明暗、overflow、44px、axe、报价失效、失败重试、本地加价、组合选择和话术操作。
- E2E：`pnpm exec playwright test tests/e2e/workbench.spec.ts tests/e2e/workbench-paper-boundaries.spec.ts --project=chromium`：7 项通过。临时启动包装显式设置隔离 URL 与 `E2E_DATABASE_CONFIRM_DATABASE=erp_e2e_custom_tiers_final_20260913`、端口 3100；模式为 `next dev`、通知 mock、inline jobs。`E2E_DURABLE_MODE=1` 在此只用于独立输出目录，不作为真实 worker 验收。
- E2E 验证销售真实报价和建单明细一致、加价无新 POST、原草稿保留/刷新、彩印覆膜和局部/专版叠加、数量错误恢复、销售/客服/管理员权限、师傅拒绝、缺货/缺克重/32 字纸名、多产品匹配显式选择。
- E2E 首轮发现隔离库缺少单色烫金工艺；测试现会显式准备，仅针对隔离库，结束恢复原启用状态，新建的临时工艺停用保留；本轮纸张/产品 fixture 结束也停用。没有把缺前置、停用工艺或目录重名当作应用的完整报价成功。
- `pnpm typecheck`、`pnpm lint`、`pnpm check:architecture`。lint 保留两处既存的 Next 内部导航 warning，零 error；UI 文案与 token 零新增违例。

## 结果与限制

全量 Vitest：608 个文件通过、3 个条件跳过、1 个既存失败；6,581 项通过、55 项条件跳过、1 项既存失败。覆盖率 statements 85.58%、branches 79.60%、functions 91.85%、lines 87.41%，原阈值保持，未出现覆盖率门禁失败。已在 `git archive cebc63f1` 的独立目录重复执行 PostgreSQL 当前价格黄金测试，修改前也失败：普通开发库当前已发布规则与旧黄金 fixture 不一致。两次均为同一组 11 个专版黄金算例（S8-FULL-005 至 015），不是本次回归。本次不改正式价格或放宽断言来通过。基线日志 `/tmp/workbench-baseline-golden.log`。

最终 action/建单编排目标复测 62 项通过（`/tmp/workbench-last-targets.log`）。

日志：`/tmp/workbench-full-final.log`、`/tmp/workbench-browser5.log`、`/tmp/workbench-e2e4.log`、`/tmp/workbench-type-final.log`、`/tmp/workbench-lint-final.log`、`/tmp/workbench-arch-final.log`。实际页面截图 `/tmp/workbench-transfer-order.png`、`/tmp/workbench-printed.png`，已检查。

该批验证覆盖工作台和建单输入/报价边界，不代表生产构建、完整订单提交、真实通知、PDF 或 durable worker 已重新验收。彩印配置缺完整价格时仍按发布规则转管理员核价。历史验证数字见销售工作台文档的历史记录，不作为本次结果。
