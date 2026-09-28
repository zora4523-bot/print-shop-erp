# 工单详情 UI/UX 修复与验收

范围：[已对抗修订的方案](./2026-09-28-order-detail-ux-review.md) OD-01～08。基线 `9ddb44e9`，分支 `codex/design-removal`；本记录与实现同批提交。任务开始无已跟踪文件改动；两份 09-21 first-use 未跟踪文档不属于本次提交。

## 实现与功能保留

| 项目 | 实现 | 原入口、条件与验证 |
|---|---|---|
| OD-01 发货/结算 | 删除错误的“前往结算”跳转和终态的重复禁用发货按钮。详情与 workspace 共用只读原因判定，按状态、待审、价格、外协、工序、地址依次给出首要原因和恢复链接 | 真正结算仍由 `AdminOrderDetailDecision` → `AdminOrderDecisionPanel` 按 `capabilities.settle` 调用原 action。逐地址发货保留版本、幂等、面单与地址独立草稿；最后一票只完善原确认文案，免费单不声称生成应收。服务端事务未改 |
| OD-02 可发现性 | 工单信息与各折叠摘要增加箭头、展开/收起；编号复制仍按需展开 | 一级管理栏目默认展开，包装和逐款完整资料默认收起；触控、键盘及手动收起后重新定位都有浏览器覆盖 |
| OD-03 事件与来源 | 现行 `FACTORY_*`、`ORDER_PRINT_*`、`CHANGE_REQUEST_*`、结算/重做/异议事件进入公共 `actionLabel`；补三种实际价格来源 | 实页额外查到 `OPERATIONS_MATERIALIZED/REMATERIALIZED` 写入于 `operation-materialization-service.ts`，也补中文名；`OPERATIONS_RELEASED` 及历史键保留。动态和 XLSX 消费公共函数，未改历史数据 |
| OD-04 金额 | 当前合计、当前阶段均读 `orderDetailAmounts`，保留估价与缺价；加工费合计不包含制版费，包装费独立 | 已结算仍取不可变 `settledFee`，历史阶段仍取原快照。物流估算不称实际收费，人工核对不抹掉“估”；差异投影、零金额、缺价、混合费用与已结算都有断言 |
| OD-05 操作优先级 | 确认打印突出，暂停降为次要；打印/PDF/网页预览移至版本区 | 三个打印相关入口均保留原 URL 和行为，编辑、急单、取消、外协、下发/暂停/恢复/审批仍使用原组件、能力和版本参数；旧纸单回收确认保留 |
| OD-06 逐款资料 | 完整资料、设计图/CDR 和原上传表单作为服务端内容槽移至对应 OrderItem 卡片 | 移除外层重复列表容器，不删字段；每款只挂一次。稿件/结构/规格/颜色/工艺/报价依据/费用/已移除制版行/工序/历史计价快照保留，文件仍按原权限和签名路径访问 |
| OD-07 内容归位 | 工厂成本在费用之后独立，生产资料、用料、提成与异议归入生产；售后重做独立定位 | `OrderMaterialUsageEstimate`、`OrderWagePanel`/核定表单、两类异议组件原条件保留。补录生产资料从价格区域迁到生产区，继续独立于收费条件，免费单仍可展示；成本录入/调整、重做发起和关联的原 action 与权限不变 |
| OD-08 层级与重复 | 子模块使用三级标题；基本信息去除重复名称、交期、金额和已在配送区展示的收件信息 | 名称交期在页头，金额在费用区，收件信息在逐地址记录；无 Shipment 的历史收件字段保留回退。提交人、生产概况、配送方式与快递代码保留。共享模块可选标题级别，其他消费者默认不变 |

原 `#detail-design-files` 落在款式区，`#detail-design-item-*`、`#order-detail-item-*` 保持每款唯一；其他旧分区锚点保留。核价、物流编辑器经事件显式唤起，MutationObserver 等待挂载后展开祖先并聚焦，不能唤起时显示反馈；普通折叠不卸载已打开表单。审批/价格版本变化仍按原 key 刷新，不复用过期草稿。

本批未移除领域服务、公开 API、SQL、Prisma schema、迁移或历史记录。没有恢复已退休的客户字段、独立工序打印/二维码、版组占位、客服/清废岗位及发货后取消。销售详情仍使用独立安全 DTO，不把管理员成本、工资或审计内容传入销售端。

## 验证证据

运行日志与 Claude 原始输出目录：本机 `/tmp/order-detail-ux-plan-review/`。以 `9ddb44e9` 加本批工作区增量运行。写入测试使用本任务创建的独立 PostgreSQL 数据库，完成全量迁移与测试数据准备；生产构建监听 3200，开发服务 3000 未替换，用户真实工单只做只读检查。通知/CDR 为 mock，后台作业为 inline；不据此声称生产通知或 durable worker 已验收。

- 缺陷测试先红后绿：早期 `red.log` 13 条失败覆盖真实缺陷；后续新增实际工序日志两条断言也先失败，映射补齐后重跑。
- 生产构建 `release3.log`：10 项通过，包括逐地址发货/面单历史/最后一票结算、收费编辑与销售无入口、六视口明暗主题/overflow/44px/axe。
- 实页人工检查：原样本当前金额及阶段均保留“估”；“生成生产工序”“自动校验通过”准确显示；设计文件跳转打开本款资料，物流深链打开并聚焦真实表单。只操作临时标签页，未提交真实业务修改。

最终 `full-unit-final.log`：713 文件通过、3 文件跳过；7,737 项通过、46 项按既有条件跳过。未把跳过项计为通过。最终 `release-recheck.log`：同一生产构建 16 项通过、0 失败、0 跳过，覆盖上述业务及六视口明暗视觉；新增核价冷 hash 自动展开经过真实 App Router 验证。未运行全站全部 E2E、完整覆盖率和真实外部通知/后台 worker，本任务不是生产发布验收。

浏览器组件最终批次 `browser-recheck.log` 5 文件 103 项通过，覆盖六标准视口加 2205px、明暗主题、键盘与触控、axe、冷 hash/重复定位、唯一挂载及输入保留。`AdminOrderDecisionPanel` 的 17 项包括旧 SHIPPED 手动结算的确认、取消、调用及失败保护。三种结算/重做组合的生产资料修复可见性和原修订参数由页面测试覆盖。类型检查与 lint 日志为 `typecheck-recheck.log`、`lint-recheck.log`；lint 保留两个既有 Next 导航警告，无错误。

## 失败分类

- 收费编辑的早期 axe 失败来自测试未同步浏览器配色/主题过渡与提交中禁用状态；改为项目现有主题门禁方式，等待实际可编辑状态与过渡结束，保留完整 axe 检查后通过。
- 逐款资料移入卡片后，旧金额选择器同时匹配摘要与收起资料；限定可见摘要并断言唯一，展开后完整明细仍独立验收。
- 原基本信息金额断言迁移至当前合计、加工费合计与当前阶段，与批准的去重复方案一致，缺价和估价断言不降低。

实际命令（由本机隔离环境包装器注入测试数据库，未记录连接凭证）：

```sh
pnpm test --run --maxWorkers=4 --no-file-parallelism
pnpm test:browser components/business/order/__tests__/AdminOrderDetailView.browser.spec.tsx components/business/order/__tests__/AdminOrderDetailDecision.browser.spec.tsx components/business/order/__tests__/AdminOrderInlineOperations.browser.spec.tsx components/business/order/__tests__/ShipmentRegistrationForm.browser.spec.tsx components/business/order/__tests__/AdminOrderDecisionPanel.browser.spec.tsx
pnpm test:release tests/e2e/shipment-registration.spec.ts tests/e2e/admin-fees.spec.ts tests/visual/admin-responsive.spec.ts tests/e2e/admin-workspace-filter.spec.ts tests/e2e/order-production-readiness.spec.ts tests/e2e/foil-wage.spec.ts tests/e2e/sales-functional-review.spec.ts --grep '逐地址登记|管理员新建|order detail expanded records|待核价详情|自动准备与显式生产下发|分档工资|销售全部状态|销售客户响应按身份隔离'
pnpm typecheck
pnpm lint
git diff --check
```

UI 规则同步至 [UI-SYSTEM](../../UI-SYSTEM.md) 与 [UI 规范](../ui-规范.md)。本任务不推送或部署。

## Claude Code 对抗审查处置

首轮实际模型 `claude-opus-5-5`，high effort，仅 Read/Glob/Grep，关闭 MCP 和 slash commands；80 turns、约 9 分 42 秒，success、无权限拒绝。原始输出 `code-review.json`、`code-review.md`。结论无 P1、2 个 P2，另有 P3 建议。逐项以当前代码核实：

- **P2 核价恢复入口**：采纳。通用 `#pricing-review` 即使已存在状态节点，仍先请求有权限的内联模式；返回真实编辑器目标，待挂载后聚焦。工厂/物流模式均覆盖，SHIPPED 阻塞也补恢复链接。`pricing-hash-red.log` 保留修复前失败证据；保留原链接供静态表单与无编辑权限时回退，不分散修改每个消费方。
- **P2 到付金额口径**：采纳。只读模型带出 `isSfCollect`，在总额旁恢复“不含快递费，含耗材费”。
- **P3 生产事实输入**：采纳。无计件工序时也纳入进度步骤，与 workspace 相同；测试仅有未完成无计件步骤的工单不会提前展示发货。
- **P3 费用与空态**：采纳。制版费说明指向每款，避免加工费合计被误读为完整总额；打样当前报价不再同时提示尚未形成报价；无收费内容的免费单不渲染空维护栏目。
- **P3 可访问名称与标题**：采纳。逐款展开摘要补序号与名称的读屏文本，移除已由款式卡承担的隐藏重复标题，包装组子标题为 h4。
- **P3 overview 死属性**：首轮读取期间已删除，非遗留事项。生产数量在生产概况保留，首要阻塞文案统一采用业务原因，不再在不同消费方重复展示不同粒度数量。
- **事实校正**：旧生产资料修复本来就在 `isChargeableOrder` 条件外，本轮是迁移位置并锁住免费单可见性，不声称新增免费修复权限。历史收件信息即使未回填 Shipment 也保留只读回退，不依赖迁移完成猜测可删。

完成修复后交 Claude 定点复核：同一 `claude-opus-5-5` 模型，21 turns、约 1 分 58 秒，success、权限拒绝 0。结论“没有发现仍未修的问题，本轮修复也没有引入新的 P1/P2/P3”，逐项通过；原始输出 `code-recheck.json`、`code-recheck.md`。它额外提示的可选 `totalEstimated` 回退差异经核实不影响真实模型：`buildAdminOrderDetailModel` 始终输出 `monetaryFacts.estimated`，两处实际使用同一布尔值，组件测试和真实金额 E2E 均已覆盖。两轮均为只读代码审查，测试由 Codex 执行，不称 Claude 跑过测试。

收尾：本任务独立测试库运行完成后删除；开发服务继续运行，用户原标签页保留。实际业务数据、未归属本任务的两份文档未修改。只创建本地提交，不推送或部署。

## 提交后对抗审查 P3 修复（2026-09-28）

本轮基线 `bc72f10860b54c3428733c98fb6676a25fda9bf5`，沿用 `codex/design-removal`。开始时已跟踪文件与暂存区均无改动，前述两份 09-21 未跟踪文档继续排除。范围是该提交独立 Claude 审查发现的两组 P3，及复核发现的同一恢复路径边界。

- 保留状态、待审、价格、外协、生产、地址的首要阻塞顺序；按阶段说明下一步，暂停时先恢复再核对，不猜测暂停前是否已完工，终态不提示可恢复发货。
- 生产入口明确为“查看生产进度”，定位到生产概况。无计件步骤独立于计件工序展示，逐款保留已完成数量；仅有历史派工时，概况与逐款资料也显示任务状态，复用现行状态注册表。
- 缺地址且不可编辑的历史完工单只解释限制，不渲染“处理”链接；PACKING 的真实补地址入口保留。旧收货资料仍在基本资料可查，不开放历史状态编辑。
- 实页门禁发现详情侧栏私有裁切隐藏标题，改为共享面板可选 `hideHeading` → `sr-only`；只有详情传 true，默认标题与 `aria-labelledby` 保留。删除 CSS 的依据是该唯一详情消费方已使用等价标准隐藏类，没有删除任何业务动作。
- 没有修改 Action、状态机、金额算法、授权、历史快照、SQL、schema 或迁移；无计件概况为空时不再输出无意义的“无”占位。UI 规范及 UI-SYSTEM 同步。

验证证据目录：本机 `/tmp/order-shipping-recovery-fix/`，截图在 `test-results/admin-ui-baseline-candidates/`。运行模式为生产构建 `.next-release` / 3200；全部写入型 fixture 限于本任务新建的 `erp_e2e_shipping_recovery_20260928`，完成迁移、seed 和项目规定的价格准备；通知/CDR mock、后台 inline，不代表真实外部系统或生产发布验收。

失败与处置：最初定向测试 11 条失败，修复后 107 条通过；扩展 workspace 消费方后 178 条通过。首次全量未注入数据库环境，3 个 PostgreSQL 测试文件导入失败后中止，改用隔离库。随后全量发现 workspace 仍断言旧文案，按现行 UI 规范更新；复核修改暂停文案期间的一轮测试读到了修改前后混合内容，该轮不计最终验收，最终冻结代码重跑。浏览器 fixture 起初缺少免费计费模式与核价时间，被数据库约束拒绝，已补齐，未改约束。手机导航期定位曾命中 React 流式渲染临时隐藏的 `div[hidden]#S:1`，trace 证实其在主内容区外；断言限定 `#admin-main` 的实际页面，保留完整 axe、裁切、overflow 与触控检查。

Claude Code 定点复核使用实际 `claude-opus-5-5`、high effort、Read/Glob/Grep，只读且无权限拒绝。第一轮 33 turns、约 142 秒，确认原两组 P3 关闭，又提出历史任务状态和暂停文案两点，均已采纳。原始输出 `claude-review.json` / `.md`；其称 workspace 的新断言已存在于 HEAD 的说法有误，那是本轮工作区更改，本记录以 Git 基线为准。

修正后第二轮 Claude 定点复核 19 turns、约 64 秒，success、权限拒绝 0，结论未发现剩余有证据的 P1/P2/P3；同时核对 `hideHeading` 的默认兼容和可访问名称。原始输出 `claude-recheck.json` / `.md`。两轮都是静态审查，没有由 Claude 执行测试。

最终浏览器与静态检查：生产构建的新增专项 6 项全部通过、0 跳过（`e2e-complete.log`），每项覆盖四种工单情形和明暗主题，六个宽度为 375、393、768、1024、1280、1920；真实点击/触控与键盘 Enter 均可打开已收起的目标栏目，逐款进度保留承接完成数。浏览器组件 3 文件、54 项通过（`browser.log`），保留审批、结算和打印确认的原行为。`typecheck-complete.log` 通过，`lint-complete.log` 0 错误、2 个既有 Next 导航警告，文案及令牌门禁均通过。未运行全站 E2E、完整覆盖率、打印像素基线或真实通知；本批不修改打印布局、状态机及写入链路。

冻结代码后的最终全量 Vitest（`unit-complete.log`）：713 文件通过、3 文件跳过；7,748 项通过、46 项按既有条件跳过、0 失败。该批包含本轮新增的历史任务状态断言；不将跳过项计为通过。测试完成后已删除本任务专用数据库，未触碰真实工单或现有开发服务。本轮只创建本地修复提交，不推送、不部署。

实际验收命令（隔离包装器仅注入本任务测试库及固定测试账号，不保存连接凭证）：

```sh
pnpm test --run --maxWorkers=4 --no-file-parallelism
pnpm test:browser components/business/order/__tests__/AdminOrderDecisionPanel.browser.spec.tsx components/business/order/__tests__/AdminOrderDetailDecision.browser.spec.tsx components/business/order/__tests__/AdminOrderDetailView.browser.spec.tsx
pnpm test:release tests/visual/admin-responsive.spec.ts --grep 'shipping recovery exposes'
pnpm typecheck
pnpm lint
git diff --check
```
