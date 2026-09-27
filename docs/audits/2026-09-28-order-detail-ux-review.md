# 工单详情信息层级与功能保留审查

日期：2026-09-28。初审基线：`81a682dc`；Claude 对抗审查基线：`56463d50`，分支 `codex/design-removal`。本轮是审查与优化方案，不实施页面改版。已跟踪文件开始时干净；两份 09-21 first-use 未跟踪文档不属于本轮。

依据：[UI 规范](../ui-规范.md) §1.1、§1.2、§2.2、§3、§4.3、§7，以及“管理员工单详情布局”“工单详情操作集中”“工单动态”；补充核对 [UI-SYSTEM](../../UI-SYSTEM.md) 的“工单页面导航与标题去重”“工单详情的信息层级”“地址级物流登记”“管理与业务记录默认展开”。真值顺序遵循 UI §1.1：业务不变量优先，其次 UI 规范，再其次 UI-SYSTEM；结合 [09-12 布局](2026-09-12-order-detail-layout.md)、[操作集中](2026-09-12-order-detail-actions.md)、[背景修复](2026-09-12-order-detail-background.md) 和 [DECISIONS](../../DECISIONS.md)。

## 结论与证据范围

页面主要问题是折叠入口不明显、查看与修改职责混杂、操作优先级不清、同一资料重复铺陈；工单号按需展开符合已确认规范，不能列为缺陷。另确认一处状态分支下的错误定位，以及价格来源/事件文案映射遗漏。建议保留现有权限、组件行为与业务契约，先修明确缺陷，再按职责重组展示。

- 对用户标记的“已下发、单款、单地址”工单只读检查；独立临时页实测“查看设计文件”“更正物流费用”“生产记录”定位，均正确打开/聚焦对应目标。后两者滚动完成后距视口顶部 160px，没有被后台标题遮挡。
- 独立页 1280×720，默认文档高度约 6840px；费用标题约 y=838、配送约 y=3079、生产约 y=3562、成本补录约 y=5091。即使只有一款，也要跨多屏才能浏览生产与记录。数值仅是本样本测量，不代表所有工单。
- 对本单最新价格修订做限定字段的本地只读查询：`revision=2 / source=ORDER_READY_FOR_PRODUCTION / status=AUTO_CONFIRMED`，用于确认“未识别来源”不是数据源为空。未读取或记录连接凭据，未修改工单。
- 不同状态、销售隔离与已移除入口以代码、项目决策和目标测试核对；未拿用户工单实际下发、改价、发货、结算或取消。

## 审查发现

| ID / 优先级 | 问题、影响及证据 | 建议 |
|---|---|---|
| OD-01 / P2 | **历史 SHIPPED 分支的结算定位错误，已结算分支仍可能出现发货阻塞。** “前往结算”指向配送记录，且显示条件比真实结算按钮宽；缺确认金额或存在待审申请时，改一个 href 也不能解决。发货禁用按钮只排除 SHIPPED/FINISHED/CANCELLED，漏掉 SETTLED。现行最后一地址发货在事务中自动结算，SHIPPED 手动结算主要用于兼容路径。 | 删除重复的“前往结算”链接，保留按 `capabilities.settle` 控制的真实按钮与阻塞恢复入口；已结束工单不再显示发货待办，其他状态按现有能力显示相应动作。最后一票确认层说明自动结算、编辑限制及账单后果，并说明尚未收款。 |
| OD-02 / P2 | **折叠操作不可发现。** 共享 summary 隐藏原生 marker，本页多数栏目既无箭头也无“展开/收起”文字，看起来像普通标题。工单号和版本放在“工单信息”里是既定设计，并非本项缺陷。 | 保留编号/复制/版本按需展开；详情页局部补方向图标与状态文案，保留原生键盘语义；不修改全站共享组件默认行为。 |
| OD-03 / P2 | **已知价格来源和现行事件被展示为未知。** 样本价格来源 `ORDER_READY_FOR_PRODUCTION` 显示“未识别来源”。现行下发写入 `OPERATIONS_RELEASED`，两套标签表都缺失；旧模型里的 `ORDER_RELEASED/FACTORY_CONFIRMED` 不能替代实际写入方核查。 | 按实际写入调用链补共享来源/事件映射，详见下方实施决定；未知历史值仍安全兜底，不回填历史数据；共享 `actionLabel` 的 XLSX 导出纳入回归。 |
| OD-04 / P2 | **当前金额与估价状态有两套投影。** 主合计实际来自 `workspace.fee`，基本信息来自 `orderDetailAmounts`，二者缺价判定不同；“确认金额·当前”又直接格式化金额。部分 ESTIMATED 收费虽已人工核对，仍不等于最终收费，称“实际收费”会误导。 | 管理员详情当前金额统一到现有只读 `orderDetailAmounts` 投影；阶段历史保持存储快照。ESTIMATED 在最终确认前继续标“估”，人工核对与最终结算分别表达；不更改金额三态共享 formatter、价格与流水。详见下方金额决定与边界用例。 |
| OD-05 / P2（事实）+ P3（布局） | **发货原因有两套判定，且重复显示。** 页面 `orderShippingAvailability` 和 workspace 的判定顺序不同，多重阻塞时可能给出不同原因；恢复链接可能找不到条件渲染的目标。右侧主次不清属于布局优化。 | 先统一可发货、阻塞原因、恢复目标的事实，再去重文案。主动作前置，打印/下载/预览同组，暂停等异常操作次要；保留每项独立行为。 |
| OD-06 / P3 | **同一款式在摘要和完整资料区重复展示。** 用户在同名条目中来回找数量、工艺、文件与费用。 | 每个 `OrderItem.id` 一个摘要及资料展开区，不按同名设计款吞并多规格行；完整字段、历史快照、文件权限逐项迁移。保留两类旧锚点，服务端资料通过内容槽组合，不扩大客户端 DTO。 |
| OD-07 / P3 | **费用维护、生产、成本和售后职责混杂，导航覆盖不全。** 长页使查记录与找操作反复切换。 | 管理栏目仍默认展开，保留现有按需打开的内联核价/发货编辑器及去重；本轮不把所有表单改成懒挂载。成本归费用独立子区，售后独立可定位；搬移保持未提交输入和深链。 |
| OD-08 / P3 | **标题语义与重复摘要削弱层级。** 页面存在 div 标题后直接 h3/h4、多层同名标题和重复费用/收货信息；无记录时多个提示相邻。 | 整理 h1 → 业务区 h2 → 子块 h3，删除经核对的重复呈现。按规范保留工资、师傅异议等各自简短空态，不把“无记录”模块一律删掉；缺 BOM 等可操作阻塞继续可见。 |

补充：页内导航是锚点导航，**本来就不应伪装成只渲染一个面板的 Tab**。目前定位工作正常；长页可增加当前位置标识，但它属于优化建议，并非“导航失效”。

### 代码定位

- OD-01：[page.tsx:556](../../app/(admin)/orders/[id]/page.tsx#L556)、[AdminOrderDecisionPanel.tsx:196](../../components/business/order/AdminOrderDecisionPanel.tsx#L196)，详情区组合在 `page.tsx:1446`。
- OD-02：[AdminOrderDetailView.tsx:139](../../components/business/order/AdminOrderDetailView.tsx#L139)、[disclosure.tsx:31](../../components/ui/disclosure.tsx#L31)。
- OD-03：[pricing-source.ts](../../lib/order/pricing-source.ts)、[activity.ts:29](../../lib/order/activity.ts#L29)、[log-format.ts](../../lib/order/log-format.ts)；追溯 `operation-materialization-service.ts`、`admin-workflow.ts`、`print-jobs.ts` 等写入方，旧 `WORKFLOW_LOG_LABELS` 仅用于兼容核对。
- OD-04：[AdminOrderDetailView.tsx:215](../../components/business/order/AdminOrderDetailView.tsx#L215)、`page.tsx:685` 附近收费行；当前主合计见 `components/business/order/admin-order-detail-model.ts:265` 的 `workspace.fee`，基础区才使用 `orderDetailAmounts`；本方案拟统一，不能写成现状已统一。
- OD-05：[AdminOrderDetailView.tsx:157](../../components/business/order/AdminOrderDetailView.tsx#L157)、`page.tsx:581` 发货 DisabledReason。
- OD-06：[AdminOrderDetailView.tsx:182](../../components/business/order/AdminOrderDetailView.tsx#L182)、`page.tsx` 的 `detailSections.designFiles`。
- OD-07/08：[page.tsx:1443](../../app/(admin)/orders/[id]/page.tsx#L1443)、[AdminOrderDetailView.tsx:231](../../components/business/order/AdminOrderDetailView.tsx#L231)、[样式](../../components/business/order/AdminOrderDetailView.module.css)。

## 建议布局

沿用后台壳、最大 1760px、桌面主栏加 320px 操作栏、960px 以下待办前置；不新增第三套卡片或色彩规范。

```text
工单名称  状态  急单（有才显示）
外部销售 · 交期 · 款数/数量
工单信息（编号 / 复制 / 版本，按需展开，补可见折叠提示）
页内定位：款式资料 / 费用 / 配送 / 生产 / 售后（有内容或可操作时）/ 操作记录

主栏                                  右侧操作区
款式资料：每规格摘要 + 本规格资料展开       当前需处理事项与主动作
费用：合计/状态 → 明细 → 历史           打印与版本 / 编辑 / 外协
      工厂成本独立子区                 次要与异常操作
配送：地址、分货、运单、面单、发货     禁用原因与明确恢复入口
生产：实际工序与报工 → 工资/问题
售后：重做关系与发起入口
操作记录：事件时间线 + 修改申请历史
```

这是一份待实施结构，不是已完成的页面。款式加工费、包装费、对客附加费和工厂成本保持各自口径；费用摘要增加“款式加工费合计”时只取 `orderDetailAmounts.itemProcessingAmount`，不能累加 `item.fees`（其中包含版费），避免制版费重复计算。同一包装金额统一称“包装费”，包装方式仍按事实单独显示。管理一级栏目沿用默认展开；包装明细不在七个一级栏目之内，保留其既有默认收起行为并补可定位入口。

## 功能保留与移除审查

| 功能 | 当前事实 | 改版边界 |
|---|---|---|
| 草稿提交、编辑、急单、取消 | 按状态及待审申请控制，真实 action 再授权 | 保留原组件/参数与服务端闸口，不因按钮挪动扩大适用状态 |
| 下发、暂停、恢复、审批变更/取消 | 右侧决策组件；单张下发与打印已分离 | 保留确认内容、旧版本阻断、并发/未知结果反馈及纸单回收要求 |
| 打印、PDF、网页预览、打印任务/确认打印 | 行为并不相同 | 可以分组，不可当作重复功能删掉；批量下发+打印不受影响 |
| 工单号复制、版本、旧纸单失效提示 | 编号和版本按规范收于工单信息 | 保留位置及能力，补折叠提示；失效提示仍按当前条件展示 |
| 设计图大图、文件列表、草稿上传/删除 | 完整资料里的 DesignUploadPanel；只有草稿可编辑 | 每款只挂一次；CDR 受控下载继续走权限入口，不将私有 URL 暴露给销售 |
| 全部收费编辑、历史材料核价、物流确认、附加费用/制版明细增改移除 | 相关组件仍挂载，并非已删除 | 按职责调整入口，保留原复核、原因、金额精度、价格修订和审计；历史已移除制版行仍能查看 |
| 到付调整、分货与包装、逐地址运单/面单、发货、结算 | 现行页面有对应表单/动作；前往结算链接存在 OD-01 | 修定位，不删写入动作；已发货地址、最后一票自动结算及财务状态均复测 |
| 生产进度、计薪次数、用料估算、工资与两类异议 | 生产区及概要；待报工时部分进度摘要不显示 | 保留空态、异常定位、核定写入与权限；有记录与无记录分别覆盖，下表列出易遗漏入口 |
| 工厂成本新增/调整、重做关联/发起 | 下方业务区；重做仅原单非重做且 SHIPPED/SETTLED/FINISHED | 给明确区名和定位，不认为当前已下发样本没有重做按钮就是缺功能 |
| 事件时间线、修改申请、分页 | 新 OrderActivity 默认展示；旧修改日志不再重复挂载 | 保留原日志与详细审批、加载更早/失败重试/分页权限；只删除重复视图不删数据 |
| 销售详情 | 路由先分流到 SalesOrderDetailView，独立安全 DTO | 管理员改版不能将成本、工资、内部审计和权限带到销售端；共享组件变更要跑销售回归 |

### 易遗漏入口的迁移要求

| 现有组件/入口 | 目标位置、原渲染条件 | 调用与验收 |
|---|---|---|
| `ProductionReadinessWarning`、`LegacyProductionFactsRepairForm` | 生产就绪/修复区；保留 `canRepairProductionFacts` 与 `repairFacts`，提示本身仍依 readiness；不能嵌入 `isChargeableOrder` 条件 | 补录调用 `repairLegacyProductionFactsAction`；收费、免费、重做均测试，不以价格区隐藏为由丢失修复能力 |
| “暂不能完工”与创建外协 | 生产区；保留 SCHEDULING/IN_PRODUCTION 且 `uncoveredOutsourceItems` 非空，按钮仍受 `canCreateOutsource` 控制 | `/foreman/outsource/new?orderId=…`；保留缺履约款式列表和正确工单参数，不新增越权入口 |
| “暂不能发货”与恢复链接 | 配送区；保留管理权限及适用发货状态，改由统一发货事实驱动 | 保留 `#ship-order`；对应核价、待审申请、外协、报工、地址的目标必须实际可达，终态不出现虚假待办 |
| “暂不能结算”与真实结算按钮 | 当前处理区/费用恢复入口；SHIPPED 兼容路径同时核对金额、待审申请、价格状态 | 保留 `settleFactoryOrderAction` 与服务端前置校验，不能只换链接；原阻塞块可合并展示但不得丢原因 |
| `OrderWagePanel` / `OrderWageReviewForm` | 生产区；沿用原工资查询、记录存在条件及 actor 授权，不改成纯展示组件 | `reviewOrderWagesAction` 为实际提成核定写入；核定入口、失败保留、越权拒绝均验收；其他工资空态遵从规范 |
| `OrderMaterialUsageEstimate` | 生产区；缺 BOM 且 `canManageBom` 时保留维护入口 | `/owner/boms`；只读用料估算、权限和缺项提示一起保留 |
| 包装明细 | 款式之后或配送之前的独立明细；保持原有数据条件及默认收起 | 分货、规格、袋数/每袋数和包装方式不丢，新增稳定定位点，不新增写入动作 |

逐款资料字段核对清单：稿件版本、图片与 CDR、计价路线、产品结构/组合、规格/实尺/纸张、彩印颜色、正反面烫金、特殊工艺、人工报价原因、系统建议小计、人工改价说明、单价/一次性费用、数量、收费明细及已移除制版行、生产工序（含非计件）与进度、历史计价快照。按 `OrderItem.id` 保留关联，不能因设计款共名合并金额或进度。

**已按项目决策移除、不得借本轮恢复的功能：**

- 客户名称/简称录入、展示、筛选与相应详情字段：2026-09-27 决策要求统一按归属外部销售识别；底层历史兼容和审计不跟随展示删除。
- 独立工序流转单打印及逐工序二维码：2026-09-08 决策已移除；普通工单 PDF、主码及工序表保留。
- 详情版组/模具组 ID、专版计价组及废弃制版占位：09-12 UI 规范明确移除展示，底层仍有计价/历史消费，不能删 schema 或迁移。
- 客服角色、清废/厨师工种及相关新业务入口：按 09-24 决策移除；不把退休功能当详情遗漏补回。
- 任一地址已发货后的取消：现行规则明确禁止。已下发后没有“直接取消”同样由取消申请/裁决流程约束，不是随意隐藏。

**本次拟去掉的仅是重复呈现和多余容器。** 每处删/合并必须记录旧位置、唯一新入口、渲染条件、调用 action 和回归项。搬移表单不得重复挂载或因切换而重置未保存内容。当前没有依据删除任何领域服务、公开 API、schema、已应用迁移或历史记录。

## 实施前已明确的决定

### 发货与结算事实

- 发货展示统一使用 `orderShippingAvailability` 作为适配入口，底层抽取共同的只读原因判定供页面和 workspace 消费，不保留两套条件链。采用明确顺序：状态不适用 → 待审申请 → 价格待核对 → 外协未收回 → 工序未完成 → 缺地址；返回原因码，再附工序数量等详情文案。权限仍单独检查，服务端实际发货/结算授权与事务不变。
- 非适用状态不展示“发货”待办；终态保持结果记录。待审等阻塞只显示一条首要原因及可达恢复入口，处理后再呈现下一个原因；链接不得指向未挂载节点。workspace 的列表消费方也需回归，不能只改详情测试。
- 保留现有 `capabilities.settle` 和服务端约束，不自行放宽结算条件；删除较宽条件的重复跳转入口。最后一票 `registerShipment` 的发货加结算事务、幂等与版本校验保持原样，只完善当前确认层的后果文案，不增加第二次确认。

### 金额和历史快照

- 管理员详情当前合计、当前阶段标识、缺价状态统一消费 `orderDetailAmounts`，不再在同页混用 `workspace.fee`。它只读取持久化金额与可信快照，通过 `selectOrderCustomerFee` 选择阶段，不调用报价引擎。保留 `orderAmountPresentation` 的三态契约及销售/列表现有消费，不全局改 formatter。实现前用差异夹具锁住两投影目前不一致的场景，再切换详情消费者。
- `ESTIMATED` 收费继续显示“估”；可信管理员确认记录只说明“已人工核对”，不等于 FINAL，不通过 UI 更改状态或抹掉估价标记。物流字段采用“估算收费 / 已确认收费”等符合状态的名称，待结算与已收款分别表达。
- 当前阶段消费同一当前金额事实；非当前阶段明确标为提交时/确认时/结算金额，保持已有快照，不套用今天的估价标记。若历史未记录估价事实，不推测补写。结算总额始终取不可变 `settledFee`，历史行仍有 ESTIMATED 也不能把已结算合计改回估价。
- 覆盖未报价草稿、人工核价未绑定/可信绑定/过期绑定、缺加工费、空金额收费行、待定包装、存在确认金额、混合 ESTIMATED/FINAL/WAIVED、免费单、打样、已结算历史行。缺价不补零；款式加工费只取 `itemProcessingAmount`，包装费与制版费不重复累计。

### 标签注册与影响面

按实际写入方建立测试表：`OPERATIONS_RELEASED`、`FACTORY_REJECTED/HELD/RESUMED`、现行三种 `ORDER_PRINT_*`、`ORDER_SETTLED_V2`、现行 `CHANGE_REQUEST_*`、`CREATE_REWORK`、`REPORT_DISPUTE_*`、`BLANK_MATERIAL_PRICE_CONFIRMED` 等，补到实际 `actionLabel` 消费链。保留旧键兼容与未知兜底，不因静态无写入就删历史标签。价格来源至少覆盖 `ORDER_READY_FOR_PRODUCTION`、`SF_COLLECT_MANUAL_FREIGHT_WAIVED`、`CHANGE_REQUEST_APPLIED_ADMIN_CONFIRMED`。核对活动流和 XLSX 导出，避免只修旧模型未修当前页面。

### 深链、折叠与表单状态

| 保留的定位目标 | 消费方/验收重点 |
|---|---|
| `#admin-fee-editor`、`#commercial-fees` | 建单成功后的跨页编辑收费链接、费用编辑器内部定位；冷打开带 hash 也能展开并聚焦 |
| `#pricing-review`、`#fulfillment-pricing`、`#pricing-review-{item,packaging,charge,shipment}-*` | 核价入口及错误摘要；需唤起正确内联模式，不能定位隐藏或不存在的节点 |
| `#shipment-registration`、`#ship-order`、`#order-detail-actions` | 列表跳转、发货阻塞和待办；有权限但被前置条件阻塞时应定位真实恢复说明 |
| `#order-detail-item-*`、`#detail-design-item-*` | 变更差异和查看设计文件；同一 OrderItem 保留两个语义目标，不能生成重复 ID |
| `#order-detail-overview`、`#order-detail-fees`、`#report-dispute-*` | 概览差异、费用差异、异议定位 |
| `#detail-design-files`、`#detail-pricing-tools`、`#detail-delivery-records`、`#detail-production-records`、`#detail-business-records`、`#detail-audit-records`、`#detail-other-actions` | 原一级栏目/操作区定位；职责归并后保留唯一兼容落点 |
| `#order-production-records`、`#order-history-records`、`#order-delivery-summary`（原条件分支） | 现有正文定位与回退布局；不能清理当前样本未渲染的分支就认定无消费者 |

- 管理一级栏目默认展开，手动折叠后链接可重新打开。普通折叠/布局切换不卸载表单；已有内联编辑器继续按需首次挂载，打开后保留状态。定位器须能调用对应模式的展开动作，等待目标挂载后打开祖先并聚焦，单纯设置 `hidden` 或只打开 `<details>` 不足以保证可达。无权限/状态不再适用时提供真实说明与可用去处，不静默失败或绕过权限挂载。
- 保留 `inlineOperations` 对主栏与侧栏核价表单的去重规则；同一编辑器只挂一次，不用两份 DOM 分别适配桌面和移动。既有价格/工单 revision key 的刷新保护不删除；“不丢输入”指普通折叠与无关地址操作，不承诺沿用已经过期的核价草稿。
- `ShipmentRegistrationForm` 保留 `${shipment.id}:${registrationVersion}`，地址编辑状态互相独立；保留上传/粘贴、预览、撤销本次图片、替换历史，以及草稿/提交中/失败反馈。实测 A 地址编辑未提交时操作 B 地址，不重置 A。

## 实施顺序与验收

1. **缺陷批次**：OD-01 发货/结算展示、统一发货原因；OD-03 现行事件与来源映射；OD-04 当前金额投影和状态。先添加能击中旧错误的边界断言，替换 `OrderDetailShipping.contract.test.ts` 中固化错误 href 的断言；不能以现有用例通过替代缺陷验证。
2. **可发现性批次**：保留编号按需展开，补详情页折叠提示、待办主次和打印分组；不改共享 Disclosure 默认行为。六标准视口及 2205px、明暗、长名称和长文案验证。
3. **内容归位批次**：按 OrderItem 合并资料展示，费用/成本分层，配送、生产、售后和审计归位。上表逐项记录旧位置→新位置、条件、action、回归用例；沿用管理栏目默认展开，包装明细及内联表单沿用各自例外。发生规范结构变化时同步 UI 规范与 UI-SYSTEM，不以改测试来掩盖未经确认的规则变化。
4. **状态/角色矩阵**：草稿、待核价、待下发、已下发、暂停、待审批、PACKING/COMPLETED、多地址部分发货、SHIPPED 兼容路径、SETTLED、FINISHED、已取消、寄样/打样/免费重做；叠加多重发货阻塞、有无文件、多规格/多设计款、金额边界、旧打印版本、有无报工/提成/异议、历史已移除收费明细。每项操作断言权限、可见性、可执行条件和失败恢复，销售端确认内部数据仍不可见。
5. **交互门禁**：逐个深链冷打开/手动收起后定位/错误摘要定位，键盘/触控/axe、44px、overflow、滚动遮挡、唯一 ID/挂载、未提交输入、地址独立、上传预览与历史。完整字段保留清单与旧页面逐项核对；服务端资料槽不可泄漏私有数据到客户端模型。
6. **业务回归**：只在独立可丢弃库验证写入与销售越权失败，尤其最后一地址发货→自动 SETTLED→账单→仍未收款、旧 SHIPPED 手动结算、提成核定、历史资料修复、待审/过期版本阻断。按 CONTRIBUTING 风险门禁执行；涉及金额展示投影和状态判定，除目标测试、lint/typecheck、视觉门禁外，执行全量 Vitest 与相关 E2E。共享来源/事件标签覆盖导出，发货规则覆盖列表；不使用用户真实工单做写入验收。

## Claude Code 对抗审查及处置

2026-09-28，对方案提交 `56463d50` 完成 **一轮**只读审查。Claude Code **2.1.283**，请求及实际返回模型均为 **`claude-opus-5-5`**（Opus 5.5），high effort；仅开放 Read/Glob/Grep，关闭 MCP 与 slash commands。运行结果 success、`is_error=false`、权限拒绝 0；耗时约 7 分 34 秒，81 turns。原始报告和结果保留在本机 `/tmp/order-detail-ux-plan-review/round1.md`、`round1.json`，原方案副本为同目录 `plan-v1.md`。

结论：**修订后实施；无 P1，7 组 P2 修订要求。** 不是七个新增产品 bug，也不代表当前页面修复完成。

| Claude 项目 | 本次核实与修订 |
|---|---|
| P2-1 规范冲突 | 采纳工单号按需展开、七个管理栏目默认展开；修正 OD-02/07/08，补 UI-SYSTEM 和真值顺序。无需另改已确认编号策略。 |
| P2-2 结算/发货状态 | 采纳，扩充 OD-01，删除重复结算链接并保留真实能力控制；纳入 SETTLED 虚假待办与最后一票确认文案。 |
| P2-3 双重发货原因 | 采纳，先统一原因判定，再做布局去重；补多重阻塞优先级与恢复目标测试。 |
| P2-4 事件/来源清单 | 采纳，纠正“另一模型已有下发标签”的错误描述，按当前写入方列清单并纳入 XLSX 回归。 |
| P2-5 金额事实 | 采纳，纠正当前投影来源；明确详情统一投影、ESTIMATED 语义、历史阶段和不可变结算值，并防制版费重复累计。 |
| P2-6 深链与挂载 | 采纳保留目标/状态的要求；修订其“一律常驻或 hidden 即可”的过度简化，按现有内联模式提供显式唤起并等待挂载，补完整定位矩阵。 |
| P2-7 功能保留遗漏 | 采纳恢复/提成/BOM/包装清单；修正“包装默认收起违反七栏目默认展开”的推断，包装明细不属于该七栏目，保留原约定。 |

另纠正审查报告中的一处事实：`BreadcrumbEntity` 虽传编号，`AdminBreadcrumb.tsx:179` 对工单详情硬编码为“工单详情”，所以“面包屑已显示工单号”不成立；保留编号折叠的依据是已确认规范，而不是面包屑兜底。工资/师傅异议空态按 UI 规范保留，按钮分组及售后独立定位属于设计选择，不夸大为阻断缺陷。

本文件已按上述核实结果修订，**修订版没有再次交给 Claude 审查**；本轮交付是完成一轮对抗并落实方案修订，业务实现与验收留待后续执行。

## 初审验证及本轮限制

```sh
pnpm test:browser components/business/order/__tests__/AdminOrderDetailView.browser.spec.tsx \
  components/business/order/__tests__/AdminOrderDetailDecision.browser.spec.tsx
pnpm test --run components/business/order/__tests__/admin-order-detail-model.test.ts \
  components/business/order/__tests__/order-detail-hash.test.ts \
  components/business/order/__tests__/OrderDetailShipping.contract.test.ts \
  'app/(admin)/__tests__/order-detail-commercial-visibility.test.tsx'
```

初审结果（本次方案对抗未重跑）：浏览器组件 **35 通过**（含现有多视口/明暗、触控、axe、预览及焦点等用例）；目标单测/契约 **114 通过**。日志 `/tmp/order-detail-ux-{browser,unit}.log`。既有用例通过不等于 OD-01～08 已修复，它们没有覆盖这些信息设计/特定分支缺口。

初审只读实页检查完成，临时页已关闭，用户原页和表单未重载/修改。未跑全站 E2E，未进行真实工单写入；初审仅新增审查文档和交接记录，未实施 UI、未推送或部署。

本次对抗审查只修改本方案与 HANDOFF；20 处本地链接存在检查与 `git diff --check` 通过，不运行与文档无关的应用测试，不操作数据库、浏览器或开发服务。应用代码与上述未修复缺陷均未改变。

## 实施完成（2026-09-28）

用户授权执行后，OD-01～08 已落地，并完成一轮 Claude Code 代码对抗及修复后的定点复核。功能迁移、审查处置、验证命令、结果与限制见[实施与验收记录](./2026-09-28-order-detail-ux-implementation.md)。前文“尚未实施”等为方案审查阶段的历史记录，当前状态以实施记录为准。
