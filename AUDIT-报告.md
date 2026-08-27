# print-shop-erp 全面审查报告

- 审查日期：2026-08-28
- 审查基线：`fcbf001866586be630eab2a798a7609d14fc51e4`
- 基线归档：[`docs/audits/2026-08-28-print-shop-erp-baseline.md`](docs/audits/2026-08-28-print-shop-erp-baseline.md)

## 结论

本次审查在不修改既有测试、不接管用户同期未提交改动的前提下，完成 UI 结构、一致性、文档、功能重复、多余代码与重复嵌套审查。

自主修改形成 4 个代码提交和 1 个规范文档提交：

1. `8d6eb35` — 删除确定无引用的 UI 代码。
2. `4ddd68d` — 修复 UI 模块边界与确定的未用参数。
3. `6ea0274` — 合并日期、上海日历与 XLSX 列名重复实现。
4. `a42d9ca` — 扁平化报价缺口标签嵌套。
5. `5b8fb8c` — 新增 UI 规范与编码规范。

最高优先级人工阻断项是：任务指定的《工单变更与版本规则.md》在当前工作树及可达 Git 历史中均不存在。仓库当前 schema、状态机和旧冻结 SPEC 均为 8 态，不能据此自行推导任务要求的 11 态、8 个对外词及 §5 驳回原因。

金额三态并非全仓缺失：销售专用列表和详情已有待确认、估价“估”和确认金额的结构，但待价文案与 tone 仍不符合统一规范；通用工单列表、创建侧栏、提交审查和底层字段契约也尚未统一。

## 基线与复测

| 批次 | lint | typecheck | Vitest | Playwright |
|---|---:|---:|---:|---:|
| 基线 `fcbf001` | 通过 | 通过 | 393 文件 / 4,202 通过 | 67 通过 / 37 失败 / 5 跳过 |
| `8d6eb35` 后 | 通过 | 通过 | 393 文件 / 4,202 通过 | 68 通过 / 36 失败 / 5 跳过 |
| `4ddd68d` 后 | 通过 | 通过 | 393 文件 / 4,202 通过 | 68 通过 / 36 失败 / 5 跳过 |
| `6ea0274` 后 | 通过 | 通过 | 393 文件 / 4,202 通过 | 68 通过 / 36 失败 / 5 跳过 |
| `a42d9ca` 后 | 通过 | 通过 | 393 文件 / 4,202 通过 | 68 通过 / 36 失败 / 5 跳过 |
| 规范文档批次 `5b8fb8c` | 通过 | 通过 | 393 文件 / 4,202 通过 | 68 通过 / 36 失败 / 5 跳过 |

后续 Playwright 比基线少 1 个失败，是 `[worker-1024x768]` dark-token 可访问性门禁偶发转绿。本次修改没有触及 worker 主题或对应页面，不把该变化归因于自主修改。后续失败集合始终是基线失败的严格子集，没有新增失败。

基线 Playwright 耗时约 26.7 分钟。首次尝试隔离端口时被既有 Next.js 开发服务器锁阻止；正式基线复用仓库已有 `localhost:3000` 开发服务器。该基础设施事件不计入红测。

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
- [UI 结构][P2·留人工] components/business/order/SalesOrdersList.tsx:406 — 销售列表自建 `SalesStatusBadge`，未统一公共状态药丸 — 标签和 tone 仍受缺失的状态真值约束 — 动作：留人工；恢复状态真值后统一（UI-COMP-001）。
- [UI 结构][P2·留人工] components/business/order/SalesOrdersList.tsx:657 — 同一次复制反馈在页面根部和 Sheet 内均有 live region — 可能重复读屏播报 — 动作：留人工；保留单一反馈出口（UI-A11Y-001）。
- [UI 结构][P2·留人工] app/(auth)/login/layout.tsx:10 — 登录和改密页面只使用 `min-h-screen` — 移动浏览器动态视口下可能裁切 — 动作：留人工；补移动端门禁后统一 `dvh/svh` token（UI-RESP-001）。
- [UI 结构][P2·留人工] components/business/order/order-form-b/OrderFoilSwatchPicker.tsx:42 — 烫金与纸张材质色板包含内联 HEX/渐变 — 可能是材质仿真资产，也可能是游离 token — 动作：留人工；确认后收口为命名材质 token 或登记例外（UI-TOK-001）。
- [UI 结构][P2·留人工] components/business/order/OrderChangeReviewForm.tsx:276 — 仓库已有 `Textarea`，部分业务表单仍直接使用原生 `textarea`；`select` 也没有统一原子 — 机械替换可能改变提交、焦点和无障碍语义 — 动作：留人工；先建立引用清单与迁移测试（UI-COMP-002）。
- [UI 结构][仅建议] app/(admin)/orders/[id]/page.tsx:1 — 管理员工单详情页超过 1,800 行，页面层承担权限分支与大量业务展示 — 超出页面、布局、业务组件、通用组件的合理边界 — 动作：仅建议；按只读区块逐步拆分，不在本审查做架构重构（UI-ARCH-001）。
- [UI 结构][仅建议] components/business/admin/AdminDataTable.tsx:20 — 列表工具栏、表格卡片等跨域原语位于 `business/admin` — 职责更接近 `ui-business` — 动作：仅建议；设计稳定的 ListSurface API 后迁移（UI-ARCH-002）。
- [UI 结构][仅建议] components/ui/card.tsx:1 — 公共 `Card` 几乎无生产消费者，业务代码大量手写 card shell — 直接机械替换会丢失语义和响应式细节 — 动作：仅建议；先定义 Surface 语义（UI-ARCH-003）。

已核验未发现 Dialog 套 Dialog。现有销售明细 Sheet 保持只读，编辑动作跳转独立页面；[`docs/ui-规范.md`](docs/ui-规范.md) 已把“明细抽屉只读、编辑另页”登记为强制规则。

## 2. 一致性与真值文档

- [一致性][P0·留人工] docs/工单变更与版本规则.md:1 — 任务指定的状态机与驳回原因真值文档不存在 — 当前工作树及可达 Git 历史均无该文件，无法逐项裁决 11 态、8 个对外词和 §5 原因枚举 — 动作：留人工；先恢复经确认原文（STATE-001）。
- [一致性][P1·留人工] prisma/schema.prisma:218 — 当前 `OrderStatus` 只有 8 态，与任务指定 11 态不一致 — schema、`SPEC-v1.2.md:424` 与状态机均支持当前 8 态，缺少依据推断另 3 态 — 动作：留人工；恢复真值后设计迁移、兼容映射和 fixture（STATE-002）。
- [一致性][P1·留人工] lib/order/status-machine.ts:17 — 状态流转表以 8 态链路为唯一实现 — 类型与既有测试共同锁定 — 动作：留人工；与 schema 迁移同批处理（STATE-003）。
- [一致性][P1·留人工] lib/order/sales-list-presentation.ts:9 — 8 个内部状态只产生 6 个唯一标签 — `SCHEDULING`、`IN_PRODUCTION`、`COMPLETED` 均显示“生产中” — 动作：留人工；恢复 §6 后建立穷举 registry（STATE-004）。
- [一致性][P1·留人工] prisma/schema.prisma:541 — 驳回只保存可选自由文本 `reviewRemark`，没有 §5 原因枚举 — 改变涉及 schema、API 和历史数据 — 动作：留人工；恢复 §5 后新增枚举及兼容迁移（REJECT-001）。
- [一致性][已符合] prisma/schema.prisma:551 — 全仓未发现“分辨率不足”或伪造的结构化驳回原因类型 — 检索只命中自由文本 `reviewRemark` — 动作：无需修改（REJECT-002）。
- [一致性][P1·留人工] prisma/schema.prisma:926 — 当前工艺是动态 `Craft` 表及 ID 数组，不是固定 enum — 《加工费计费规则》未列出 craft code，无法按该文档逐项比对 — 动作：留人工；先补齐或确认 craft 真值（CRAFT-001）。
- [一致性][P1·留人工] prisma/seed.ts:160 — 工艺种子与冻结 SPEC 清单漂移 — `SPEC-v1.2.md:610` 含 `STOCK_FOIL` 且不含 `FLAT_FOIL_TRIPLE`；当前种子新增/停用了不同项 — 动作：留人工；确认后续决策的取代关系，不自行回退 seed（CRAFT-002）。
- [一致性][P1·留人工] prisma/schema.prisma:435 — 缺少真值要求的 `frontColors[]/backColors[]`；当前使用扁平 `printColors[]` 与烫金专用 `frontFoilColors[]/backFoilColors[]`，并保留 `foilColors/isDoubleSided/isDoubleColor` — 《加工费计费规则》:63 要求以正反面数组表达过版且禁止面数字段 — 动作：留人工；设计 schema、API 与历史数据迁移（COLOR-001）。
- [一致性][P1·留人工] components/business/order/OrderForm.tsx:458 — 被标为历史兼容的聚合颜色/单双面字段仍由新表单写入并被规则条件读取 — 与 schema 注释不一致 — 动作：留人工；先停止新写入并设计历史回填（COLOR-002）。
- [一致性][P1·留人工] SPEC-v1.2.md:390 — 冻结 SPEC 与专用计费真值在颜色结构上直接冲突 — 前者要求聚合字段，后者声明自己为计费唯一真值并禁止该结构 — 动作：留人工；按任务规则由专用计费文档裁决，并显式记录冲突（COLOR-003）。
- [一致性][P1·留人工] docs/加工费计费规则.md:108 — “专版没有反面”与实施契约及迁移冲突 — `ORDER-PRICING-AND-DISPATCH-V2.md:14,168` 将专版双面定义为合法待确认事实，迁移还创建 `CUSTOM_DOUBLE_SIDED_MANUAL` — 动作：留人工；业务确认哪份文档有误（CUSTOM-SIDE-001）。
- [一致性][P1·留人工] prisma/schema.prisma:333 — 金额底层没有 `confirmedFee/quotedFee`，使用 `totalAmount`、`pricingStatus` 与收费行 `ESTIMATED/FINAL` 的替代模型 — 与任务指定字段契约不一致，但不能断言三态完全缺失 — 动作：留人工；确认最终数据契约和历史兼容（AMOUNT-001）。
- [一致性][P2·留人工] components/business/order/SalesOrdersList.tsx:333 — 销售专用列表与详情只部分表达金额三态 — 估价有可见“估”，但 pending 使用“待管理员确认价格”及 `text-destructive`，未统一为“待核价”与品牌朱红语义 — 动作：留人工；统一金额 DTO、文案与共享展示组件后迁移（AMOUNT-002）。
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
- [文档][P0·留人工] docs/编码规范.md:39 — 状态与驳回真值只能登记为“应存在但当前缺失” — 审查不得依据同期计划稿重建业务真值 — 动作：留人工；取得原始《工单变更与版本规则.md》后补齐（DOC-TRUTH-001）。

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
| P0 | STATE-001 / DOC-TRUTH-001 | 11 态、8 对外词和驳回原因真值缺失 | 恢复经确认原文；恢复前冻结状态及驳回修改 |
| P1 | STATE-002～004 | 当前实现和旧 SPEC 均为 8 态 | 联合设计 schema 迁移、流转、兼容映射与 fixture |
| P1 | CUSTOM-SIDE-001 | “专版无反面”与“双面合法待核价”冲突 | 业务负责人书面裁决，不由代码反推真值 |
| P1 | COLOR-001～003 | 禁用的聚合颜色/单双面字段仍在新写入与规则匹配 | 制定停止新写、历史回填和迁移删除顺序 |
| P1 | AMOUNT-001 / 003 / 004 | 金额字段契约、通用列表和创建链路未统一 | 定义 quote/confirmed/pending DTO 后统一全部出口 |
| P1 | PACK-001 | 清空包装组成可能保留旧袋数及报价 | 先加清空与竞态 fixture，再修报价失效 |
| P1 | REJECT-001 | 驳回原因无枚举 | 恢复 §5 后设计枚举、历史兼容及审计必填 |
| P1 | CRAFT-001 / 002 | craft 真值缺口及种子漂移 | 明确后续决策取代关系再调整 |
| P1 | FALLBACK-001 | 旧 SPEC 与外部销售专用真值作用域不清 | 明确旧 fallback 仅供内部/直单兼容路径 |
| P1 | UI-INT-001～003 | 高风险动作缺持久理由契约 | 先补后端审计字段/API，再升级确认层 |
| P1 | UI-IA-001 | 导航信息架构与原型不一致 | 产品确认分组和角色入口后统一改 |
| P2 | AMOUNT-002 / 005、FMT-001 / 003、PACK-002 | 金额三态、尺寸、包装及待价术语未全仓统一 | 冻结 DTO、格式和词表后分批迁移 |
| P2 | UI-INT-004 / UI-A11Y-001 | 复制交互重复且有双 live region | 抽共享交互，保留单一播报出口并补无障碍测试 |
| P2 | UI-COMP-001 / 002 | 私有状态药丸及原生表单控件未收口 | 状态真值恢复后迁移药丸；控件先补焦点与提交契约测试 |
| P2 | UI-RESP-001 / UI-TOK-001 | 动态视口与材质颜色 token 边界未统一 | 补移动视觉门禁；确认材料色是否登记为例外 |
| P2 | DUP-DATETIME-001 / DUP-ADDRESS-001 / DUP-CRON-001 / DUP-PAPER-001 / DUP-BILL-001 | 行为敏感的重复实现 | 先补契约测试，再合并 |
| P2 | NEST-002 | 工单表单仍含行为敏感的深层条件 | 按功能区补 fixture 后逐段早返回 |
| P2 | DEAD-EXPORT-001 | 疑似无引用公共导出 | 确认外部脚本及动态消费者后删除 |
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

6 个 admin 视口为：`375×667`、`393×852`、`768×1024`、`1024×768`、`1280×800`、`1920×1080`。后续每批均为 68 通过、36 失败、5 跳过；减少的 1 项仅为 worker dark-token 门禁波动，不计入已修清单。
