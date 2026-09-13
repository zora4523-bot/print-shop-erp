# 工作台转单对抗审查复核与修复

## 范围与依据

复核对象：`223c9772b92cbd0f2a6b62c13802149ae13bce9b`（复用建单款式配置与自动报价）。候选为该提交加本记录所在修复提交的增量。任务开始时没有已修改的跟踪文件，已有五组浏览器截图目录保持原样，不纳入提交。

原 Grok 审查报告及调用记录在 `/tmp/erp-grok-223c9772/review.md`、`grok-public-evidence.json`；模型为 `grok-4.6-build`。本次先按调用链和真实页面证据复核，再实施修复，未把模型建议直接当成已证实缺陷。

| 确认问题 | 触发条件与影响 | 修复 |
|---|---|---|
| P1：草稿遗漏覆膜 | 触感膜报价转单后刷新，草稿白名单丢失 `lamination`；默认值可能把待核价变成亚膜价格 | 白名单保留全部覆膜枚举；旧彩印铜版纸草稿缺失覆膜时保留其他字段、明确重选，并暂停内外部自动报价及提交 |
| P2：独立草稿无入口 | 离开转单 URL 后，普通新建页只读取原工单键；独立草稿仍在但无法发现 | 按当前账号与计价身份扫描有效转单草稿，展示名称、保存时间及恢复链接；切换前保存当前已修改表单，保存失败时阻止切换 |
| P2：损坏草稿阻挡恢复 | 仅以 localStorage 原文非空判断可恢复，跳过有效 sessionStorage 条件 | 解析版本、身份和表单结构后才继续草稿；无效时尝试原报价条件；两者均无效时保持表单禁用并提供返回操作 |
| P2：烫金色被强制改名 | 管理员配置“哑金”等名称，归一化改成“亚金”等别名，选中态错位、重复选择导致校验失败 | 使用配置原名作为选择值，仅对完全相同的值去重，不合并不同目录名称 |
| P2：纸张判断不一致 | `COATED` / `TBZ` 纸张可展示覆膜，但基于视觉纹理的归一化把所选覆膜重置 | 共享铜版纸业务判断，选择联动、归一化、覆膜显示及旧草稿检查使用相同规则；不再依赖视觉纹理 |

旧草稿中已经丢失的覆膜无法可靠还原，必须由用户重新选择。报价事实仍不含价格、加价比例、服务端签名、设计图文件或人工价格授权。没有修改计价公式、发布价格、权限、历史快照或数据库迁移。

未采纳的报告推测包括：改尺寸勾选值丢失、`safeExtend` 丢失 schema 约束、默认款式报价覆盖恢复结果、空产品 ID 绕过以及单款投影改变费用。已用实际控件、schema 和服务端调用链核对，不为无法复现的推测扩大修改范围。

## 验证方式

- 修复前证据：`/tmp/erp-grok-223c9772/browser-reproduction.json`、`corruption-browser-reproduction.json`、`configuration-reproduction.json`、`pricing-reproduction.json`。包含真实 `next dev` 页面及共享报价服务，触感膜条件丢失后基础加工费从待核价变成 310.00 的前后对照。
- 单元覆盖：全部覆膜枚举、内外部草稿反复保存、v4/v5 缺失字段恢复、损坏结构、账号/身份隔离、恢复排序、配置颜色原名，以及中文/英文铜版纸标签边界。
- 浏览器组件：真实共享控件的颜色选中/取消/转单、`COATED` 覆膜报价/转单、有效草稿优先、损坏数据回退、存储错误、恢复入口及六视口明暗、44px、键盘、overflow、axe。服务端动作在此层使用 mock，真实框架行为由 E2E 覆盖。
- E2E：`tests/e2e/workbench.spec.ts`、`workbench-paper-boundaries.spec.ts`。检验真实销售页面刷新与离开恢复、原工单不覆盖、临时条件过期、损坏数据回退、内外部计价草稿缺覆膜时不发报价请求、重选后恢复报价，以及模拟浏览器存储已满时保持表单禁用，连同原报价、目录、角色验证。
- E2E 使用独立数据库 `erp_e2e_custom_tiers_final_20260913`，显式校验数据库名，端口 3100，`next dev`、通知 mock、inline jobs。`E2E_DURABLE_MODE=1` 只用于隔离输出目录；不代表真实 worker 验收。纸张测试只创建隔离库临时目录数据，结束停用并恢复工艺启用状态。

沿用仓库配置生成的等价临时 ESM 配置，通过 native loader 运行，未减少用例范围、改阈值、禁用 axe 或更新像素基线：

```sh
pnpm exec vitest run --config /tmp/workbench-vitest.config.ts.mjs --configLoader native --maxWorkers=2 --coverage --coverage.reportOnFailure
pnpm exec vitest run --config /tmp/workbench-vitest.browser.config.ts.mjs --configLoader native --maxWorkers=1 components/business/order/__tests__/WorkbenchOrderTransfer.browser.spec.tsx components/business/workbench/__tests__/SalesWorkbench.browser.spec.tsx components/business/order/__tests__/OrderFormBNavigation.browser.spec.tsx
pnpm exec playwright test tests/e2e/workbench.spec.ts tests/e2e/workbench-paper-boundaries.spec.ts --project=chromium
pnpm typecheck
pnpm lint
pnpm check:architecture
```

日志集中在 `/tmp/erp-workbench-review-fix/`。首次默认并发全量测试与其他检查争用资源，出现多项超时，已中断并改用两 worker 复验。E2E 首轮还定位并修正了恢复按钮焦点选择器；另一断言需限定业务提示区域，避免命中 Next 路由播报器。运行中热更新及测试库事务超时的失败不作为功能通过证据。

## 最终结果

- 全量 Vitest：609 文件通过、3 文件条件跳过、1 文件既存失败；6,612 项通过、55 项条件跳过、1 项既存失败。覆盖率 statements 85.58%、branches 79.60%、functions 91.85%、lines 87.41%，全部原覆盖率门禁保持。日志 `full-verified.log`。
- 唯一剩余失败为 `lib/order/__tests__/current-create-order-golden-gate.postgres.test.ts`，普通开发库已发布价格与旧黄金 fixture 不一致。将失败算例 ID 与修改前基线 `/tmp/workbench-baseline-golden.log` 自动比较，完全相同：S8-FULL-005 至 015，共 11 个；对照结果 `golden-baseline-comparison.json`。本任务没有修改发布价格，也未放宽断言。
- 浏览器组件：58 项全部通过，含六种宽度明暗主题的恢复入口、键盘、44px、overflow、axe；日志 `browser-verified.log`。
- E2E：最终共 12 项不同用例通过。完整原范围复跑 9 项通过，客服报价一项因开发编译耗时超过 5 秒等待而超时；保持原断言，随后单独复跑客服并补跑内部草稿、存储已满两项，3 项全部通过。日志 `e2e-verified.log`、`e2e-boundaries.log`。失败的中途步骤没有计为通过，未增加 sleep 或放宽测试等待。
- 共享真实报价服务：1000 个、200g 铜版纸、触感膜，草稿保存恢复前后均为 `SOFT_TOUCH`、`baseAmount=null`、`needsPricing=true`，全部报价字段深比较一致，未再变成 310.00。证据 `pricing-verified.json`。
- `pnpm typecheck`、完整 lint、最终受影响文件 lint、UI 文案/token、架构检查通过。完整 lint 仍有两处既存内部导航 warning、零 error；最终目标文件 lint 只包含其中的 OrderForm warning。日志 `typecheck-verified.log`、`lint.log`、`lint-target-final.log`、`lint-e2e-final.log`、`ui-final.log`、`architecture.log`。
- 本次失败截图移到 `/tmp/erp-workbench-review-fix/failure-screenshots/`；已有截图、环境文件、生成物均未纳入提交。文档链接与 `git diff --check` 已检查。

本批验证覆盖工作台报价、转单和工单草稿恢复，不声称生产构建、完整订单提交、真实通知、打印或 durable worker 已重新验收。
