# print-shop-erp 全面审查报告

- 审查日期：2026-08-28
- 审查基线：`fcbf001866586be630eab2a798a7609d14fc51e4`
- 基线归档：[`docs/audits/2026-08-28-print-shop-erp-baseline.md`](docs/audits/2026-08-28-print-shop-erp-baseline.md)
- 续审真值：`/Users/zhixing/Downloads/工单变更与版本规则 (1).md`（145 行，SHA-256 `10711faaaab5936720e312184a3f3065474958d2d50cac8de792f4addfa92dd9`）
- 续审代码快照：2026-08-28 10:22 CST（dirty worktree；并行建单改动非本轮产出）
- 修复路线：[`AUDIT-修复计划.md`](AUDIT-修复计划.md)

## 结论

本次审查在不修改既有测试、不接管用户同期未提交改动的前提下，完成 UI 结构、一致性、文档、功能重复、多余代码与重复嵌套审查。

自主修改形成 4 个代码提交和 1 个规范文档提交：

1. `8d6eb35` — 删除确定无引用的 UI 代码。
2. `4ddd68d` — 修复 UI 模块边界与确定的未用参数。
3. `6ea0274` — 合并日期、上海日历与 XLSX 列名重复实现。
4. `a42d9ca` — 扁平化报价缺口标签嵌套。
5. `5b8fb8c` — 新增 UI 规范与编码规范。

续审与修复规划已形成 `cb71507`；该提交及后续验证补记只修改报告、计划和规范文档，不含业务运行时代码。

原报告的“真值内容缺失”阻断已因用户提供原文而解除；治理阻断仍在：仓库 canonical 路径尚未纳入该文件，且原文自身存在“8 个销售词/表格实际 9 个”、`ADDRESS` 直改/申请双重归属、`settleFee/settledFee` 三处待裁决冲突。不能自行勘误后实施。

续审后的最高风险变为：旧纸二维码无法识别版本、已发货仍可取消、生产中取消没有已产结算和对账闭环、改单契约与真值不一致，以及 11 态旧数据迁移无法机械推断。

金额三态并非全仓缺失：销售专用列表和详情已有待确认、估价“估”和确认金额的结构，但待价文案与 tone 仍不符合统一规范；通用工单列表、创建侧栏、提交审查和底层字段契约也尚未统一。

本轮只继续审查并产出修复计划，没有修改状态机、计费、schema、迁移、API 或测试。审查期间另一条工作流在 dirty worktree 中加入了 `PENDING_FACTORY`、三段金额字段及未提交 migration；到 10:22 快照，`PENDING_FACTORY` 已同步到 migration、generated Prisma、状态机和部分消费者，但仍是保留旧态且缺 7 个真值态的 9 态兼容草案，不计入“已修”。

## 基线与复测

| 批次 | lint | typecheck | Vitest | Playwright |
|---|---:|---:|---:|---:|
| 基线 `fcbf001` | 通过 | 通过 | 393 文件 / 4,202 通过 | 67 通过 / 37 失败 / 5 跳过 |
| `8d6eb35` 后 | 通过 | 通过 | 393 文件 / 4,202 通过 | 68 通过 / 36 失败 / 5 跳过 |
| `4ddd68d` 后 | 通过 | 通过 | 393 文件 / 4,202 通过 | 68 通过 / 36 失败 / 5 跳过 |
| `6ea0274` 后 | 通过 | 通过 | 393 文件 / 4,202 通过 | 68 通过 / 36 失败 / 5 跳过 |
| `a42d9ca` 后 | 通过 | 通过 | 393 文件 / 4,202 通过 | 68 通过 / 36 失败 / 5 跳过 |
| 规范文档批次 `5b8fb8c` | 通过 | 通过 | 393 文件 / 4,202 通过 | 68 通过 / 36 失败 / 5 跳过 |
| 续审规划 `cb71507` 干净提交树诊断 | 通过 | 通过（先生成 Prisma 与 Next 路由类型） | 381 文件 / 4,092 通过 | 10 通过 / 82 失败 / 5 跳过；不可与工作树基线直接比较 |

四个自主代码批次及首轮规范文档批次的 Playwright 比基线少 1 个失败，是 `[worker-1024x768]` dark-token 可访问性门禁偶发转绿。本次修改没有触及 worker 主题或对应页面，不把该变化归因于自主修改；这些可比批次的失败集合始终是基线失败的严格子集，没有新增失败。续审的干净提交树诊断环境不同，单独说明如下，不并入该比较。

基线 Playwright 耗时约 26.7 分钟。首次尝试隔离端口时被既有 Next.js 开发服务器锁阻止；正式基线复用仓库已有 `localhost:3000` 开发服务器。该基础设施事件不计入红测。

续审诊断使用 `cb71507` 的临时 detached worktree、独立 3100 端口和 Node 24.15.0。干净树缺少被忽略的 Prisma 生成物与 Next 路由类型，分别生成后 lint、typecheck 与 Vitest 全绿。`pnpm install --frozen-lockfile` 因 TOOL-001 失败；仅为完成诊断，临时 worktree 使用 `--no-frozen-lockfile` 安装，主工作区的 manifest 与锁文件均未修改。

该 Playwright 运行仍连接 `.env` 指向的当前共享开发数据库，且提交树测试清单是 97 项，而归档基线来自含并行未提交代码/测试的 109 项工作树。82 个失败同时覆盖旧打印截图、全部 worker 视口、多组管理/销售视口、4 个批量排产场景及部分原基线红项，属于代码清单与数据库指纹不同的诊断结果，不能归因为纯文档提交，也不能加入“基线即红”清单。修复可复现基线本身已登记为 TOOL-002；在 B0a 完成前，不用这两组数字做失败集合差分。

## 审查范围与工具限制

- 人工检索及 TypeScript/ESLint 可解析引用核验覆盖 `app/`、`components/`、`hooks/`、`lib/`、`actions/` 共 1,024 个源文件，其中 591 个 `.ts`、433 个 `.tsx`。
- 全仓引用核验包含 barrel export、测试引用、动态导入和字符串路由。
- 仓库未安装 `jscpd`、`depcheck`、`knip`、`ts-prune` 或 `madge`；本报告不把人工相似度与引用扫描描述为这些工具的结果。
- 疑似无引用的公共导出和依赖均保守判定；只有全仓无引用且可确认无外部消费者的私有 UI 代码被自主删除。
- 审查开始时工作区已有大量修改、删除和未跟踪文件。本次提交只暂存自身目标文件，没有覆盖或提交用户同期改动。
- 全部自主修改均未修改任何既有测试。

## 1. UI 结构

- [UI 结构][P2·已修] components/business/rules/pricing/PriceDataBoundary.tsx:4 — 业务组件绕过 `ui-business` 公共入口 deep import `ErrorState` — 四层边界要求通过 barrel 消费，类型系统及全量测试背书 — 动作：已修 `4ddd68d`（UI-LINT-001）。
- [UI 结构][P1·留人工] lib/navigation/admin-menu.ts:33 — “运维”等导航分组与现有设计原型的信息架构不完全一致 — 调整会改变角色入口、面包屑与测试契约 — 动作：留人工；产品确认最终分组后统一处理（UI-IA-001）。
- [UI 结构][P1·留人工] components/business/master-data/ActiveStateConfirmButton.tsx:19 — 主数据启停仍使用 L2 确认，未达到部分原型要求的 L3 理由留痕 — 当前 mutation 不接收审计原因，UI 不能伪造数据契约 — 动作：留人工；先设计 reason、审计存储与 API（UI-INT-001）。
- [UI 结构][P1·留人工] components/business/salary/MarkPaidForm.tsx:74 — 标记已发、重算与结算等薪资高风险动作仍使用 L2 — 服务端只持久化支付事实，没有理由字段 — 动作：留人工；先统一高风险动作审计契约（UI-INT-002）。
- [UI 结构][P1·留人工] components/business/order/OrderChangeReviewForm.tsx:299 — 工单变更批准与驳回均使用 L2 — 操作可能重报价或拒绝申请，且 reviewRemark 当前可选 — 动作：留人工；与驳回原因真值一并设计（UI-INT-003）。
- [UI 结构][P2·留人工] components/business/order/OrderListBatchSelection.tsx:192 — 批量复制与销售列表复制各自实现 Clipboard、反馈状态及 live region — `SalesOrdersList` 还有重复播报出口 — 动作：留人工；抽共享交互并保留单一 `aria-live`，补可访问性测试（UI-INT-004）。
- [UI 结构][P2·留人工] components/business/order/SalesOrdersList.tsx:406 — 销售列表自建 `SalesStatusBadge`，未统一公共状态药丸 — 标签和 tone 受 §6 的 8/9 词勘误与 11 态迁移约束 — 动作：留人工；勘误与状态 API 投影确认后统一（UI-COMP-001）。
- [UI 结构][P2·留人工] components/business/order/SalesOrdersList.tsx:657 — 同一次复制反馈在页面根部和 Sheet 内均有 live region — 可能重复读屏播报 — 动作：留人工；保留单一反馈出口（UI-A11Y-001）。
- [UI 结构][P2·留人工] app/(auth)/login/layout.tsx:10 — 登录和改密页面只使用 `min-h-screen` — 移动浏览器动态视口下可能裁切 — 动作：留人工；补移动端门禁后统一 `dvh/svh` token（UI-RESP-001）。
- [UI 结构][P2·留人工] components/business/order/order-form-b/OrderFoilSwatchPicker.tsx:42 — 烫金与纸张材质色板包含内联 HEX/渐变 — 可能是材质仿真资产，也可能是游离 token — 动作：留人工；确认后收口为命名材质 token 或登记例外（UI-TOK-001）。
- [UI 结构][P2·留人工] components/business/order/OrderChangeReviewForm.tsx:276 — 仓库已有 `Textarea`，部分业务表单仍直接使用原生 `textarea`；`select` 也没有统一原子 — 机械替换可能改变提交、焦点和无障碍语义 — 动作：留人工；先建立引用清单与迁移测试（UI-COMP-002）。
- [UI 结构][仅建议] app/(admin)/orders/[id]/page.tsx:1 — 管理员工单详情页超过 1,800 行，页面层承担权限分支与大量业务展示 — 超出页面、布局、业务组件、通用组件的合理边界 — 动作：仅建议；按只读区块逐步拆分，不在本审查做架构重构（UI-ARCH-001）。
- [UI 结构][仅建议] components/business/admin/AdminDataTable.tsx:20 — 列表工具栏、表格卡片等跨域原语位于 `business/admin` — 职责更接近 `ui-business` — 动作：仅建议；设计稳定的 ListSurface API 后迁移（UI-ARCH-002）。
- [UI 结构][仅建议] components/ui/card.tsx:1 — 公共 `Card` 几乎无生产消费者，业务代码大量手写 card shell — 直接机械替换会丢失语义和响应式细节 — 动作：仅建议；先定义 Surface 语义（UI-ARCH-003）。

已核验未发现 Dialog 套 Dialog。现有销售明细 Sheet 保持只读，编辑动作跳转独立页面；[`docs/ui-规范.md`](docs/ui-规范.md) 已把“明细抽屉只读、编辑另页”登记为强制规则。

## 2. 一致性与真值文档

- [一致性][P0·留人工] docs/工单变更与版本规则.md:1 — 真值原文已从下载路径收到，但仓库 canonical 路径仍缺失 — 外部原文 145 行，SHA-256 为 `10711faaaab5936720e312184a3f3065474958d2d50cac8de792f4addfa92dd9` — 动作：留人工；确认后按字节不变入库，不在入库提交中静默勘误（STATE-001）。
- [一致性][P0·留人工] prisma/schema.prisma:218 — 真值要求 11 态，基线是旧 8 态，10:22 dirty schema 与生成物则是只添加 `PENDING_FACTORY` 的 9 态混合集 — `generated/prisma/enums.ts:59` 已含新态，但仍保留 `SUBMITTED / SCHEDULING / IN_PRODUCTION / COMPLETED / FINISHED` 且缺 7 个真值态 — 动作：留人工；先审批旧数据映射，再做 expand/contract 迁移（STATE-002）。
- [一致性][P0·留人工] lib/order/status-machine.ts:17 — 运行时已把 `PENDING_FACTORY` 接入旧链，但仍是 9 态兼容流转表 — 真值只列状态和部分能力，未定义 `ON_HOLD` 恢复、`REJECTED` 重提、无烫金跳转等完整边 — 动作：留人工；先批准完整转换矩阵，再与 schema 迁移同批实施（STATE-003）。
- [一致性][P0·留人工] lib/order/sales-list-presentation.ts:9 — 当前 9 态兼容集仅产生 6 个唯一销售词 — 外部真值 §6 表格给出 9 个唯一词，但正文又称 8 个 — 动作：留人工；勘误裁决后建立服务端穷举投影（STATE-004）。
- [一致性][P0·留人工] prisma/schema.prisma:579 — 仓库没有工单 `REJECTED / ON_HOLD` 的结构化原因记录 — 现有 `OrderChangeRequest.reviewRemark` 属于另一概念，不能替代 §5 的 `PAPER_OUT / DESIGN_ERROR / PRICE_PENDING + reasonNote + fig[]` — 动作：留人工；单独设计原因模型、关联款校验和兼容迁移（REJECT-001）。
- [一致性][已符合] /Users/zhixing/Downloads/工单变更与版本规则 (1).md:110 — 全仓未发现被明确禁止的“分辨率不足”类型或界面文案 — 应用、schema、生成物及测试全仓检索无命中 — 动作：无需修改（REJECT-002）。

### 2.1 续审：真值内部冲突与状态漂移

- [一致性][P0·留人工] /Users/zhixing/Downloads/工单变更与版本规则 (1).md:114 — §6 声称销售端映射为 8 个词，但 118–128 行表格实际产生 9 个唯一词 — 11 态只合并 `RELEASED / FOILING / PACKING` 三态，数学上也是 9 组 — 动作：留人工；文档负责人确认“8”是笔误还是漏了一组合并（TRUTH-ERRATA-001）。
- [一致性][P0·留人工] /Users/zhixing/Downloads/工单变更与版本规则 (1).md:25 — `ADDRESS` 在能力矩阵中是直接轻变更，却又在 40 行被定义为 `modifyKind` — 未说明状态、贴唛节点或其他分界 — 动作：留人工；确认直改/申请的精确边界（TRUTH-AMB-001）。
- [一致性][P1·留人工] /Users/zhixing/Downloads/工单变更与版本规则 (1).md:45 — ChangeRequest 使用 `settleFee`，而 91、94、128 行的最终工单/对账字段使用 `settledFee` — 对象边界可能是有意区分，也可能是命名漂移 — 动作：留人工；确认申请参考/裁决值与工单最终值的唯一字段契约（TRUTH-AMB-002）。
- [一致性][P0·留人工] lib/order/status-machine.ts:44 — 9 态兼容状态机仍允许 `SHIPPED → CANCELLED` — 真值 §1 明确已发货不可取消、应转售后 — 动作：留人工；与 11 态迁移、服务端守卫和旧测试契约同批修正（STATE-005）。
- [一致性][P0·留人工] prisma/migrations/20260828100000_create_order_c_expand/migration.sql:3 — 并行草案已将 `PENDING_FACTORY` 同步到 schema、migration、generated 和部分 runtime，但其自述为保留旧值的兼容扩展，不是 11 态迁移 — `lib/order/sales-list-query.ts:109` 的活动/需处理集合仍漏新态，展示层却已接入 — 动作：留人工；将此视为建单兼容草案而非真值完成，后续 11 态批次再统一查询、迁移和流转（STATE-006）。

### 2.2 续审：ChangeRequest 与轻变更

- [一致性][P0·留人工] lib/order/change-request.ts:48 — 当前 `DRAFT / SUBMITTED / SCHEDULING / IN_PRODUCTION` 都能提交修改申请 — 真值总原则是 `CONFIRMED` 之后才将修改建模为 ChangeRequest，草稿应直改 — 动作：留人工；依批准的 11 态能力矩阵重建入口守卫（CHANGE-001）。
- [一致性][P0·留人工] prisma/schema.prisma:313 — ChangeRequest 只有 `PENDING / APPROVED / REJECTED / CANCELLED / STALE`，且模型缺 `type / modifyKind / denyReason / producedQty / settleFee / woVersionAfter` — 与 §2 对象及终态契约不一致 — 动作：留人工；先决定历史 `CANCELLED / STALE` 映射，再做 additive schema 和前向迁移（CHANGE-002）。
- [一致性][P0·留人工] lib/order/change-request.ts:2124 — 当前拒绝备注可空并写为 `REJECTED`，也没有销售写入 `WITHDRAWN` 的服务 — 真值要求 `DENIED` 必填 `denyReason`、`PENDING` 可由销售撤回 — 动作：留人工；增加服务端必填、权限、并发和撤回测试（CHANGE-003）。
- [一致性][P1·留人工] lib/notification/events.ts:17 — 通知事件集没有生产影响申请或轻变更事件，批准流程也不生成“重新打印”任务 — §1–3 要求通知工厂、影响生产申请置顶和换纸闭环 — 动作：留人工；先确认收件人、幂等键与重打任务完成条件（CHANGE-004）。
- [一致性][P1·留人工] lib/order/editable-fields.ts:45 — 当前 `PENDING_FACTORY` 和兼容 `SUBMITTED` 都可原地全量编辑，没有“撤回 → 改 → 重新提交”显式闭环 — 与 §1 的 `PENDING_FACTORY` 能力不符 — 动作：留人工；与状态迁移、操作审计和重提并发一起实施（CHANGE-005）。
- [一致性][P1·留人工] lib/order/editable-fields.ts:33 — 生产态轻变更只按状态开放收货与备注字段，没有“贴唛前”持久事实和工厂通知 — §1 明确要求两个闸口 — 动作：留人工；人工确认何种打包事实证明未贴唛，再在服务端强制（CHANGE-006）。
- [一致性][P1·留人工] lib/order/editable-fields.ts:78 — 顺丰到付专用入口在 `SHIPPED` 仍可修改 — 真值对已发货工单的直改和申请列均为禁止 — 动作：留人工；确认该特例是售后流程还是违规旧口，不机械删除（CHANGE-007）。
- [一致性][P1·留人工] app/(admin)/orders/[id]/edit/page.tsx:47 — `DRAFT` 编辑页明确不支持款式增删改 — 真值对草稿定义为全部字段可直改 — 动作：留人工；评估复用建单表单或新建款级编辑 DTO（CHANGE-008）。
- [一致性][P1·留人工] lib/order/change-request.ts:1537 — 当前服务按已开工/完工任务事实直接阻断数量、规格或烫金修改 — 真值要求影响生产的申请可提交，是否停线由工厂裁决 — 动作：留人工；区分“允许提交”和“允许批准/应如何调整”两层规则（CHANGE-009）。

### 2.3 续审：版本、取消与对账闭环

- [一致性][P0·留人工] lib/order/print-view.ts:99 — 工单二维码仍是 `/wo/{woNo}`，扫码路由忽略 `v` 且不显示旧版红色作废页 — 与 §3 的纸质工单作废闭环直接冲突 — 动作：留人工；实现带版本短链、服务端比对和不泄露旧内容的作废页（VERSION-001）。
- [一致性][P0·留人工] components/business/order/OrderPrintLayout.types.ts:101 — 打印 DTO 不含工单版本，PDF/页眉也没有 `vN` 契约 — 肉眼无法在二维码不可用时识别旧纸 — 动作：留人工；让 DTO、页眉、文件名与二维码共用同一版本（VERSION-002）。
- [一致性][P0·留人工] lib/background-jobs/pdf.ts:21 — PDF durable job 的 payload、result 和领取校验只绑定工单/操作人，未绑定版本 — 排队期间升版后仍可领到旧产物 — 动作：留人工；在生成、存储和领取三处校验当前版本，补旧 `jobId` 竞态测试（VERSION-003）。
- [一致性][P1·留人工] prisma/schema.prisma:426 — 不可变价格修订以独立 `priceRevision` 为键，不是完整的 WorkOrder 版本快照 — 尚不能证明每一版工单与锁定金额及全部打印事实一对一 — 动作：留人工；定义不可变工单版本快照边界（VERSION-004）。
- [一致性][P0·留人工] lib/order/change-request.ts:2401 — 当前 `Order.revision` 不是纯纸质工单版本，核价、发货物流终审和顺丰到付变更也会递增 — `lib/order/pricing-review.ts:1154` 与 `lib/order.ts:2060,2816` 证明非纸质变更也占用版本号 — 动作：留人工；确认新增独立 `workOrderVersion` 或重定义全部递增语义（VERSION-005）。
- [一致性][P0·留人工] lib/order/print-view.ts:145 — 纸上的任务二维码仍是 `/worker/tasks/{id}` 且不带工单版本 — 即使工单 QR 作废，师傅仍可从旧纸任务 QR 进入报工 — 动作：留人工；确认任务 QR 契约并在报工写服务做版本校验（VERSION-006）。
- [一致性][P0·留人工] lib/order.ts:1582 — 当前确认后/生产中取消是管理员直接切 `CANCELLED`，遇已开工任务反而整体阻断 — 真值要求 `type=CANCEL` 申请及工厂核已产数量 — 动作：留人工；拆分未确认直接零费用取消与确认后申请取消（CANCEL-001）。
- [一致性][P0·留人工] prisma/schema.prisma:357 — dirty schema 虽出现 `settledFee`，但没有 `producedQty`、参考计价、调整理由或裁决原子事务 — 多款工单只有单一总量也无法证明款级费用 — 动作：留人工；先裁决逐款数量结构和 `settleFee/settledFee`，再实现 fail-closed 取消计价（CANCEL-002）。
- [一致性][P0·留人工] lib/bill.ts:161 — 月账单只扫描 `FINISHED` 并使用 `totalAmount` — 有 `settledFee` 的 `CANCELLED` 工单会从对账流程消失 — 动作：留人工；在取消裁决闭环完成后再扩展账期、冻结金额和幂等重跑（BILL-001）。

### 2.4 续审：销售端 §7

- [一致性][P0·留人工] lib/order/sales-list-query.ts:49 — 销售 DTO 直接暴露内部 `OrderStatus`，再由客户端解释为销售词 — §6 明确这张映射是销售 API 契约 — 动作：留人工；勘误后由服务端输出穷举销售状态投影（SALES-001）。
- [一致性][P1·留人工] lib/order/sales-list-query.ts:120 — “需处理”只覆盖旧活动态内的待管理员核价和最新改单被拒，甚至没有纳入 dirty 契约已接入的 `PENDING_FACTORY` — 同时缺 `REJECTED / ON_HOLD`，不等于 §7 的四类并集 — 动作：留人工；把谓词收口为服务端唯一实现并覆盖排序×分页边界（SALES-002）。
- [一致性][P1·留人工] lib/order/sales-list-presentation.ts:60 — 每行默认动作是“查看详情”而非“再来一单”，也没有“清 IMAGE、保留 CDR”的领域复制服务 — 直接复制数据还会涉及价格、任务、审计和幂等取舍 — 动作：留人工；先定义复制白名单和重置策略（SALES-003）。
- [一致性][P1·留人工] components/business/order/SalesOrdersList.tsx:623 — 抽屉 footer 只提供泛化“处理此工单”并跳 `#change-request` — 缺按 `PAPER_OUT / DESIGN_ERROR + fig` 定位纸张/文件区、申请撤回和无动作 `PRICE_PENDING` 规则 — 动作：留人工；保持抽屉只读，在独立编辑页实现可寻址定位（SALES-004）。
- [一致性][P2·留人工] lib/order/sales-list-query.ts:541 — 缩略图选“第一个有图的款”而非严格首款；`components/business/order/SalesOrdersList.tsx:392` 的超期样式也是淡红底朱红字而非白字红底 — 与 §7 的逐字视觉契约不符 — 动作：留人工；在状态/原因 DTO 稳定后做独立 UI 修正与视觉回归（SALES-005）。

续审同时确认了可保留的基础：一单一个 `PENDING` 已有事务检查和数据库部分唯一索引；销售明细 Sheet 为右侧、`#wo=` 可寻址且正文只读；销售查询使用白名单，未下发任务、师傅、audit、成本和外协细节。这些项在后续修复中必须保持。
- [一致性][P1·留人工] prisma/schema.prisma:260 — dirty schema 新增 `OrderCraft.PARTIAL / FULL / PRINT`，同时款式仍保留 `crafts: String[]` 和动态 `Craft` 表 — 《加工费计费规则》未列出 canonical craft code，无法证明新 enum、生产工艺 ID 和计费语义的对应 — 动作：留人工；先确认 craft 真值和双模型过渡边界（CRAFT-001）。
- [一致性][P1·留人工] prisma/seed.ts:160 — 工艺种子与冻结 SPEC 清单漂移 — `SPEC-v1.2.md:610` 含 `STOCK_FOIL` 且不含 `FLAT_FOIL_TRIPLE`；当前种子新增/停用了不同项 — 动作：留人工；确认后续决策的取代关系，不自行回退 seed（CRAFT-002）。
- [一致性][P1·留人工] prisma/schema.prisma:435 — 缺少真值要求的 `frontColors[]/backColors[]`；当前使用扁平 `printColors[]` 与烫金专用 `frontFoilColors[]/backFoilColors[]`，并保留 `foilColors/isDoubleSided/isDoubleColor` — 《加工费计费规则》:63 要求以正反面数组表达过版且禁止面数字段 — 动作：留人工；设计 schema、API 与历史数据迁移（COLOR-001）。
- [一致性][P1·留人工] components/business/order/OrderForm.tsx:458 — 被标为历史兼容的聚合颜色/单双面字段仍由新表单写入并被规则条件读取 — 与 schema 注释不一致 — 动作：留人工；先停止新写入并设计历史回填（COLOR-002）。
- [一致性][P1·留人工] SPEC-v1.2.md:390 — 冻结 SPEC 与专用计费真值在颜色结构上直接冲突 — 前者要求聚合字段，后者声明自己为计费唯一真值并禁止该结构 — 动作：留人工；按任务规则由专用计费文档裁决，并显式记录冲突（COLOR-003）。
- [一致性][P1·留人工] docs/加工费计费规则.md:108 — “专版没有反面”与实施契约及迁移冲突 — `ORDER-PRICING-AND-DISPATCH-V2.md:14,168` 将专版双面定义为合法待确认事实，迁移还创建 `CUSTOM_DOUBLE_SIDED_MANUAL` — 动作：留人工；业务确认哪份文档有误（CUSTOM-SIDE-001）。
- [一致性][P1·留人工] prisma/schema.prisma:357 — 10:08 dirty schema 已加 `quotedFee/confirmedFee/settledFee`，但基线无该字段，当前销售查询仍读 `totalAmount/pricingStatus` 并从费用行猜三态 — 并行 schema 草案尚未贯通 DTO、回填和显示 — 动作：留人工；先确认历史回填矩阵和 tagged-union DTO，再切换全部出口（AMOUNT-001）。
- [一致性][P2·留人工] components/business/order/SalesOrdersList.tsx:333 — 销售专用列表与详情只部分表达金额三态 — 估价有可见“估”，但 pending 使用“待管理员确认价格”及 `text-destructive`，未统一为“待工厂核价”与品牌朱红语义 — 动作：留人工；统一金额 DTO、文案与共享展示组件后迁移（AMOUNT-002）。
- [一致性][P1·留人工] lib/order/list-query.ts:129 — 通用工单列表 DTO 与查询没有 `pricingStatus` — `OrdersTable` 只能直接输出 `totalAmount`，无法表达金额三态 — 动作：留人工；调整查询契约及多角色消费面（AMOUNT-003）。
- [一致性][P1·留人工] components/business/order/ExternalSalesOrderFormRail.tsx:281 — 创建侧栏和提交审查把 complete quote 当普通金额显示，没有“估” — `OrderForm` 与 review dialog 同样直接显示 amountLabel — 动作：留人工；先确认 quote 与 confirmed 的业务边界（AMOUNT-004）。
- [一致性][P2·留人工] components/business/order/ExternalSalesOrderFormRail.tsx:37 — 同一待价概念存在“待核价”“待重新核价”“待管理员终价”“待管理员确认价格”等文案 — 含义并不完全相同，机械替换会吞掉差异 — 动作：留人工；建立唯一金额状态词表（AMOUNT-005）。
- [一致性][P1·留人工] components/business/order/OrderForm.tsx:2196 — 清空每袋组成后可能保留旧 `actualBagCount` 与旧报价 — helper 返回 incomplete/null，但 effect 只在 complete 时写值，报价 key 又不含 `itemUnitsPerBag` — 动作：留人工；先补清空与竞态 fixture（PACK-001）。
- [一致性][P2·留人工] components/business/order/OrderForm.tsx:2522 — 包装界面同时使用“入袋”“混装”“袋”“包”“每袋数量” — 全仓未发现禁词“放数”，但允许术语未收口 — 动作：留人工；确认 `pack/包装数量` 词表后统一（PACK-002）。
- [一致性][P2·留人工] components/business/order/OrdersTable.tsx:143 — 金额存在带/不带币符号及多种 formatter — 千分位、空格和小数位并非同一函数产出 — 动作：留人工；确定 UI 契约后迁移到唯一 formatter（FMT-001）。
- [一致性][P2·已修] lib/format/dates.ts:39 — 价目、cron、看板与薪资页面重复创建上海日期 formatter — 公共函数可等价覆盖，不改变时区/输出 — 动作：已修 `6ea0274`（FMT-002）。
- [一致性][P2·留人工] components/business/order/OrderForm.tsx:2558 — 尺寸展示存在紧凑与带空格两种写法 — 未由同一函数产出 — 动作：留人工；建立尺寸 fixture 后统一（FMT-003）。
- [一致性][P1·留人工] SPEC-v1.2.md:36 — 旧 SPEC 的广义“对客加工费”允许无阶梯时回退基础单价，专用外部销售真值禁止兜底 — 内部 `calculateQuote` 与旧 SPEC 一致；外部销售服务明确 fail closed，未发现外部链路串到内部引擎 — 动作：留人工；明确 `J.2` 仅适用于内部/直单，或写明已被后续外部价目决策取代（FALLBACK-001）。

## 3. 文档产出

- [文档][P2·已修] docs/ui-规范.md:1 — 仓库原先没有任务要求路径的 UI 规范 — 已补 token 表、通用组件、金额三态、确认后果、款级校验、价格熄灭、状态药丸、复制反馈和禁用模式 — 动作：已修 `5b8fb8c`（DOC-UI-001）。
- [文档][P2·已修] docs/编码规范.md:1 — 仓库原先没有统一编码规范与真值索引 — 已补目录、命名、计费纯函数边界、禁止兜底、fixture 和冲突优先级 — 动作：已修 `5b8fb8c`（DOC-CODE-001）。
- [文档][P0·留人工] docs/编码规范.md:39 — 外部原文已获取，但 canonical 仓库路径、来源记录和三个勘误裁决尚未完成 — 不得把审查报告或当前代码反向当成真值 — 动作：留人工；按 `AUDIT-修复计划.md` B0 原文入库后，以独立决策记录处理勘误（DOC-TRUTH-001）。

## 4. 功能重复

- [功能重复][P2·已修] components/business/price/ExternalSalesPriceBookCatalog.tsx:17 — 价目目录与版本面板各自实现上海日期格式化 — `lib/format/dates.ts` 可等价覆盖 — 动作：已修 `6ea0274`（DUP-DATE-001）。
- [功能重复][P2·已修] lib/dashboard/shanghai-clock.ts:20 — 页面、cron 与薪资汇总重复实现上海今天和当前月份 — 既有测试及固定 UTC+8 语义背书 — 动作：已修 `6ea0274`（DUP-CLOCK-001）。
- [功能重复][P2·已修] lib/export/xlsx-column.ts:2 — 通用 XLSX 与计件 XLSX 各自实现完全相同的列名转换 — 算法逐字符一致且无 IO — 动作：已修 `6ea0274`（DUP-XLSX-001）。
- [功能重复][P2·留人工] components/business/salary/SalaryRuleSettingsForm.tsx:244 — 多个 datetime-local 表单各自转换上海墙上时间 — 中央模块没有明确的 datetime-local 秒/空值契约 — 动作：留人工；先建时区边界 fixture（DUP-DATETIME-001）。
- [功能重复][P2·留人工] components/business/order/OrderForm.tsx:761 — 内部工单与外部销售各有收货地址自由文本解析 — 平台码、姓名、座机和省份输出契约不同 — 动作：留人工；先形成统一 DTO 与兼容样例（DUP-ADDRESS-001）。
- [功能重复][P2·留人工] app/api/cron/hourly-payroll/route.ts:67 — cron route 重复实现 `readJsonBody/extractString` — 属于外部 API 输入边界 — 动作：留人工；补 route contract tests 后再合并（DUP-CRON-001）。
- [功能重复][P2·留人工] lib/order/sales-list-query.ts:672 — 销售列表和详情各自实现 `formatPaper` — 输出进入 DTO，缺空字段/重量 fixture — 动作：留人工；补测试后抽展示 formatter（DUP-PAPER-001）。
- [功能重复][P2·留人工] app/(admin)/owner/bills/[id]/page.tsx:439 — 管理员和销售账单详情重复 Row 等展示组件 — 数据权限不同，直接合并可能暴露内部成本 — 动作：留人工；只共享无权限含义的纯展示原语（DUP-BILL-001）。

## 5. 多余代码

- [多余代码][P3·已修] components/ui/separator.tsx:1 — `Separator` 在修改前快照（`8d6eb35^`）全仓没有 import、barrel、动态或字符串引用 — 仓库 private 且无其他 workspace 消费者 — 动作：已修 `8d6eb35`（DEAD-001）。
- [多余代码][P3·已修] components/ui-business/ErrorState.tsx:74 — `BlockingPrerequisite` 在修改前快照（`8d6eb35^`）只有声明和 barrel export，无生产、测试或动态引用 — 删除同时移除专用 import/export — 动作：已修 `8d6eb35`（DEAD-002）。
- [多余代码][P3·已修] components/business/salary/SalaryRuleSettingsForm.tsx:31 — `defaultValues` 的 `key` 参数没有使用 — TypeScript 可静态确定，删除不改变调用语义 — 动作：已修 `4ddd68d`（DEAD-LINT-001）。
- [多余代码][P2·留人工] lib/attendance.ts:50 — `listActiveHourlyWorkers` 等多个公共导出仓内只命中自身声明 — 同类含 `bill/costing.ts:186`、`bom.ts:115`、`product.ts:284`、`salary/rules.ts:149,159`、`pricing-route.ts:184`、`rule-center.ts:46` 和 `order-form-gaps.ts:219,225` — 动作：留人工；可能有外部/动态消费者，不猜删（DEAD-EXPORT-001）。
- [多余代码][P3·留人工] package.json:34 — `@auth/prisma-adapter`、部分 OpenTelemetry 包和 `@vitest/browser` 未由普通源码 import 明确证明使用 — 未安装 depcheck，且可能由框架配置/启动钩子加载 — 动作：留人工；以生产构建、启动和配置核验后再删（DEAD-DEP-001）。
- [一致性][P2·留人工] package.json:79 / pnpm-lock.yaml:145 — `@vitest/coverage-v8` 的 manifest specifier 是 `^4.1.5`，锁文件 importer 却记录为 `4.1.5`，干净快照执行 `pnpm install --frozen-lockfile` 会直接失败 — 无法在 CI 式环境复现依赖安装 — 动作：留人工；先确认版本范围策略，再仅同步锁文件元数据并在干净 checkout 验证冻结安装（TOOL-001）。
- [一致性][P1·留人工] docs/audits/2026-08-28-print-shop-erp-baseline.md:14 / playwright.config.ts:69 — 正式基线是 dirty worktree 且复用既有 3000 端口服务和共享开发库，不能从 `fcbf001` 干净 checkout 重建同一测试清单与运行时 — 隔离快照实际只有 381/4,092 个 Vitest 与 97 个 Playwright，而归档工作树基线是 393/4,202 与 109 个 Playwright — 动作：留人工；后续行为批次先建立独立测试数据库、禁止复用未知服务，并归档代码/迁移/测试清单指纹（TOOL-002）。

未发现其他可安全自主删除的无引用路由、成段注释代码或已确认废弃 feature flag。

## 6. 重复嵌套

- [重复嵌套][P3·已修] components/business/order/order-form-gaps.ts:61 — 报价状态标签原由五层嵌套三元表达 — 状态联合类型与既有测试背书等价 `switch` — 动作：已修 `a42d9ca`（NEST-001）。
- [重复嵌套][P2·留人工] components/business/order/OrderForm.tsx:450 — `OrderForm` 仍有多处深层三元和模板字符串业务分支 — 部分影响报价/表单且文件含用户同期改动 — 动作：留人工；按功能区补 fixture 后逐段早返回（NEST-002）。
- [重复嵌套][仅建议] lib/bill.ts:674 — 管理员账单详情嵌套 items、order、客服周期、任务、外协、重做和成本 — 深度约 6，拆分可能改变财务一致性快照 — 动作：仅建议；先记录 SQL、行数和执行计划（PRISMA-001）。
- [重复嵌套][仅建议] lib/bill.ts:812 — 销售账单详情同时嵌套所有权过滤、收费及款式快照 — 当前结构实现最小权限 — 动作：仅建议；以权限回归与查询计划为前置（PRISMA-002）。
- [重复嵌套][仅建议] lib/order.ts:2837 — 工单详情按角色展开款式、包装、日志、外协、发货、改单、价格修订和成本 — 关系图过宽，属架构/性能重构 — 动作：仅建议；先按角色建立 projection 与性能基线（PRISMA-003）。
- [重复嵌套][仅建议] lib/order/change-request.ts:2051 — 改单审核在同一事务锁内深层读取款式、任务、发货、包装和收费 — 拆分可能破坏同锁事实快照 — 动作：仅建议；一致性优先，独立评估（PRISMA-004）。

## 已修清单

| 编号 | 修改 | 提交 | 验证 |
|---|---|---|---|
| DEAD-001 | 删除无引用 `Separator` | `8d6eb35` | lint、typecheck、4,202 Vitest；Playwright 无新增失败 |
| DEAD-002 | 删除无引用 `BlockingPrerequisite` 及 export | `8d6eb35` | 同上 |
| UI-LINT-001 | `ui-business` 改走公共 barrel | `4ddd68d` | lint、typecheck、4,202 Vitest；Playwright 无新增失败 |
| DEAD-LINT-001 | 删除确定未使用参数 | `4ddd68d` | 同上 |
| DUP-DATE-001 | 统一价目上海日期格式 | `6ea0274` | lint、typecheck、4,202 Vitest；Playwright 无新增失败 |
| DUP-CLOCK-001 | 统一上海今天与月份 helper | `6ea0274` | 同上 |
| DUP-XLSX-001 | 抽取 XLSX 列名纯函数 | `6ea0274` | 同上 |
| FMT-002 | 统一上海日期 formatter 使用 | `6ea0274` | 同上 |
| NEST-001 | 扁平化报价缺口状态标签 | `a42d9ca` | lint、typecheck、4,202 Vitest；Playwright 无新增失败 |
| DOC-UI-001 | 新增 UI 规范 | `5b8fb8c` | lint、typecheck、4,202 Vitest；Playwright 无新增失败 |
| DOC-CODE-001 | 新增编码规范及真值索引 | `5b8fb8c` | 同上 |

## 待人工清单（按风险）

| 风险 | 编号 | 待处理事项 | 建议处置 |
|---|---|---|---|
| P0 | STATE-001 / DOC-TRUTH-001 | 外部原文已收到，但 canonical 路径未入库 | 先按字节不变入库并记录 SHA；勘误用独立决策处理 |
| P0 | TRUTH-ERRATA-001 / TRUTH-AMB-001 | 销售词 8/9 冲突；`ADDRESS` 直改/申请边界不明 | 文档负责人先裁决，冻结相关 API、UI 和迁移 |
| P0 | STATE-002～006 | 11 态与旧数据无完整映射；并行草案只做了保留旧值的 9 态兼容扩展 | 批准迁移表与完整转换矩阵，再做 expand/contract；已发货禁止取消 |
| P0 | CHANGE-001～003 | ChangeRequest 入口、对象字段、终态、拒绝必填和撤回均不符真值 | 先决定历史状态映射，再以 additive schema + 服务端并发守卫实施 |
| P0 | VERSION-001～003 / 005～006 | 旧纸、任务 QR 和异步 PDF 无版本作废闭环，`Order.revision` 也非纯工单版本 | 确认独立 `workOrderVersion`，让快照、QR、报工、PDF 和重打任务共用同一版本 |
| P0 | CANCEL-001 / 002 / BILL-001 | 生产中取消没有已产数量、参考计价、调整留痕和对账 | 先裁决多款已产数据结构，再做原子裁决和冻结账单金额 |
| P0 | REJECT-001 | 工单驳回/暂停没有三值原因、备注和涉及款记录 | 与变更申请 `denyReason` 分建模型，补跨工单 fig 拒绝和行动投影 |
| P0 | SALES-001 | 销售 API 直接暴露内部状态，未固化 §6 契约 | 8/9 词裁决后建立服务端穷举投影 |
| P1 | TRUTH-AMB-002 | `settleFee/settledFee` 字段边界不明 | 确认申请裁决值与工单最终值的持久命名 |
| P1 | CHANGE-004～009 | 通知/置顶/重打、撤回重提、贴唛闸口、草稿全编辑等未闭合 | 依赖状态与版本批次分别实施，不在 UI 临时猜规则 |
| P1 | VERSION-004 | 价格修订不是完整工单版本快照 | 定义快照包含的打印事实与确认金额关联 |
| P1 | SALES-002～004 | 需处理谓词、再来一单和原因定位/撤回动作缺失 | 状态、原因、金额 DTO 稳定后保持只读抽屉并补独立领域服务 |
| P1 | CUSTOM-SIDE-001 | “专版无反面”与“双面合法待核价”冲突 | 业务负责人书面裁决，不由代码反推真值 |
| P1 | COLOR-001～003 | 禁用的聚合颜色/单双面字段仍在新写入与规则匹配 | 制定停止新写、历史回填和迁移删除顺序 |
| P1 | AMOUNT-001 / 003 / 004 | 金额字段契约、通用列表和创建链路未统一 | 定义 quote/confirmed/pending DTO 后统一全部出口 |
| P1 | PACK-001 | 清空包装组成可能保留旧袋数及报价 | 先加清空与竞态 fixture，再修报价失效 |
| P1 | CRAFT-001 / 002 | craft 真值缺口及种子漂移 | 明确后续决策取代关系再调整 |
| P1 | FALLBACK-001 | 旧 SPEC 与外部销售专用真值作用域不清 | 明确旧 fallback 仅供内部/直单兼容路径 |
| P1 | UI-INT-001～003 | 高风险动作缺持久理由契约 | 先补后端审计字段/API，再升级确认层 |
| P1 | UI-IA-001 | 导航信息架构与原型不一致 | 产品确认分组和角色入口后统一改 |
| P1 | TOOL-002 | dirty worktree、复用服务及共享数据库使基线无法由 commit 重放 | 建立隔离测试库和受控服务器，归档代码、迁移及测试清单指纹后重做可复现基线 |
| P2 | AMOUNT-002 / 005、FMT-001 / 003、PACK-002 | 金额三态、尺寸、包装及待价术语未全仓统一 | 冻结 DTO、格式和词表后分批迁移 |
| P2 | SALES-005 | 首款缩略图和超期视觉不符 §7 | 在销售 DTO 稳定后单独修 UI 并补视觉回归 |
| P2 | UI-INT-004 / UI-A11Y-001 | 复制交互重复且有双 live region | 抽共享交互，保留单一播报出口并补无障碍测试 |
| P2 | UI-COMP-001 / 002 | 私有状态药丸及原生表单控件未收口 | 状态勘误和 API 投影稳定后迁移药丸；控件先补焦点与提交契约测试 |
| P2 | UI-RESP-001 / UI-TOK-001 | 动态视口与材质颜色 token 边界未统一 | 补移动视觉门禁；确认材料色是否登记为例外 |
| P2 | DUP-DATETIME-001 / DUP-ADDRESS-001 / DUP-CRON-001 / DUP-PAPER-001 / DUP-BILL-001 | 行为敏感的重复实现 | 先补契约测试，再合并 |
| P2 | NEST-002 | 工单表单仍含行为敏感的深层条件 | 按功能区补 fixture 后逐段早返回 |
| P2 | DEAD-EXPORT-001 | 疑似无引用公共导出 | 确认外部脚本及动态消费者后删除 |
| P2 | TOOL-001 | manifest 与锁文件 specifier 漂移，冻结安装失败 | 确认 pin/range 策略，独立同步锁文件并在干净 checkout 跑 frozen install |
| P3 | DEAD-DEP-001 | 疑似未使用依赖 | 用构建、运行时钩子及配置核验 |
| 建议 | UI-ARCH-001～003 | 巨型页面及公共 Surface 分层 | 独立架构项目处理 |
| 建议 | PRISMA-001～004 | 深层、宽关系 Prisma 查询 | 先做查询计划、权限和一致性基线 |

## 基线即红测试清单

Vitest 基线全绿：393 个测试文件、4,202 个测试通过。

| 数量 | Playwright 项目 / 测试 | 基线现象 |
|---:|---|---|
| 1 | `[chromium] bill-flow.spec.ts:30` | fixture 清理触发 `OrderPricingRevision_orderId_fkey` |
| 1 | `[chromium] cdr-bundle.spec.ts:21` | fixture 清理触发同一外键 |
| 1 | `[chromium] cs-accumulate.spec.ts:31` | fixture 清理触发同一外键 |
| 1 | `[chromium] manual-production-flow.spec.ts:13` | 等待 `items.0.quantity` 输入框超时 |
| 1 | `[chromium] notification-cron.spec.ts:137` | order-overdue fixture 清理触发同一外键 |
| 1 | `[chromium] notification-urgent.spec.ts:24` | 等待 quantity 输入框超时 |
| 1 | `[chromium] order-create.spec.ts:15` | 等待 quantity 输入框超时 |
| 1 | `[chromium] owner-dashboard.spec.ts:33` | fixture 清理触发同一外键 |
| 1 | `[chromium] owner-notifications.spec.ts:29` | “新建群”定位器 strict mode 命中 2 个元素 |
| 1 | `[chromium] owner-settings.spec.ts:23` | 找不到 `.factory-name` |
| 1 | `[chromium] production-flow.spec.ts:22` | 等待设计文件输入控件超时 |
| 1 | `[chromium] smoke.spec.ts:301` | 测试插入缺少非空 `pricingRoute` |
| 1 | `[worker-1024x768] worker-responsive.spec.ts:41` | dark-token 颜色对比失败；后续偶发转绿 |
| 6 | `admin-responsive.spec.ts:47`，6 个 admin 视口 | administrator light 响应式/可访问性门禁失败 |
| 6 | `admin-responsive.spec.ts:51`，6 个 admin 视口 | administrator dark 响应式/可访问性门禁失败 |
| 6 | `admin-responsive.spec.ts:194`，6 个 admin 视口 | sales light 响应式/可访问性门禁失败 |
| 6 | `admin-responsive.spec.ts:198`，6 个 admin 视口 | sales dark 响应式/可访问性门禁失败 |
| **37** | **合计** | **均为修改前基线失败，本审查未顺手修复** |

6 个 admin 视口为：`375×667`、`393×852`、`768×1024`、`1024×768`、`1280×800`、`1920×1080`。此前可比的自主修改批次均为 68 通过、36 失败、5 跳过；减少的 1 项仅为 worker dark-token 门禁波动，不计入已修清单。续审干净提交树诊断因 TOOL-002 不可比较，未改写本表。
