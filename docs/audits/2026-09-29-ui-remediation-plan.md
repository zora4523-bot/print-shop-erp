# UI 审查整改计划（2026-09-29）

来源：[2026-09-29-ui-review.md](2026-09-29-ui-review.md)。每条问题有唯一编号与负责批次；完成后在「状态」列填结果与提交。

业主决定（2026-09-29）：
- 暗色 `--destructive` 改偏洋红，浅色不动。
- 页内表单/核对步骤主按钮在左；弹窗维持取消左、主按钮右。写进规范。
- 动词口径：入口「新建X」、提交「创建X」、表单内加一行「添加X」；「新增」统一替换。
- 本轮纳入 PageHeader 加 back/status 槽并迁移二级页；原生 select 全量迁移（P2-2）与探针门禁化留下轮。

## 批次与文件所有权

| 批次 | 所有权（只改这些） | 阶段 |
|---|---|---|
| A 原子件与令牌 | `components/ui/**`、`components/ui-business/**`（除 PageHeader）、`app/globals.css`、`lib/ui/**`、`scripts/ui-tokens/**`、`scripts/ui-copy/**` | 1 |
| C 业务组件 | `components/business/**`，除 D 列出的文件 | 1 |
| D 切换与导航性能 | `components/business/order/AdminOrderWorkspace*`、`OrderQueuePending.tsx`、`SalesOrderListFilters.tsx`、`OrderCreationWorkspace.tsx`、`components/business/production/WorkerTaskFilters.tsx`、`components/business/admin/AdminDataTable.tsx`、`components/business/rules/RuleCenterWorkspaceBar.tsx`、`components/business/rules/pricing/CustomerPricingWorkspacePage.tsx`、`lib/oss/read-url.ts`、`lib/order/admin-workspace.ts`、`lib/order/sales-list-query.ts` | 1 |
| B 页面外壳 | `app/**`、`components/ui-business/PageHeader.tsx`、`components/business/rules/RuleCenterPageHeader.tsx`、`components/business/admin/AdminBreadcrumb.tsx`、`AppSidebar.tsx`、`AdminRouteLoading.tsx` | 2 |
| G 门禁、规范、验证 | 规范文档、测试、全量门禁、提交 | 3 |

## 清单

| # | 严重 | 问题 | 批次 | 状态 |
|---|---|---|---|---|
| 1 | S1 | 取消类确认层「取消」与「取消X」并排（4 处调用 + 默认值） | A+C | 已修（25ed6952 默认「暂不取消」；05e97cd1 四处具体「保留X」+ danger） |
| 2 | S1 | 待工厂核价三种颜色 → primary | C | 已修 05e97cd1 |
| 3 | S1 | `--destructive-foreground` 未定义（作废页、OrderFieldPrimitives） | A | 已修 25ed6952 |
| 4 | S1 | 缩略图签名每秒变化、img 无 lazy/尺寸 | D | 已修 05e97cd1（30 分钟签名桶 + OSS 缩放 + lazy） |
| 5 | S1 | 逾期预警 4 套实现 → registry | C | 已修 05e97cd1（工单列表本就与 registry 同色，未改） |
| 6 | S2 | Dialog/AlertDialog 不在 44px 兜底内 | A | 已修 25ed6952 |
| 7 | S2 | Input/Textarea/NativeSelect 规格不一（圆角、内距、焦点、错误态、暗色底、只读态）；Button 圆角违反 §2.4 | A | 已修 25ed6952 |
| 8 | S2 | Button 无选中变体；className 覆写墨色/红色；选中标签悬停变红 | A 提供 `selected`，C/D 迁移 | 已修 25ed6952 + 05e97cd1 |
| 9 | S2 | 确认按钮红色跟随 L3 而非 danger；删除通知目标非红 | A+C | 已修 |
| 10 | S2 | 普通 Dialog 当确认层、业务直引 AlertDialog | A+C | 已修 |
| 11 | S2 | 暗色 primary/destructive 分不开；侧栏暗色选中蓝紫 | A | 已修 25ed6952（业主定：暗色洋红） |
| 12 | S2 | 红色用于非失败（进度、待办、试算、退出登录、急单、查看原因） | C | 已修 05e97cd1 |
| 13 | S2 | StatCard 同义指标色调乱 | B（页面） | 已修 8f487401 |
| 14 | S2 | `text-success` 等原色作文字对比度不足 | C | 已修 |
| 15 | S2 | 搜索图标偏上 6px | D | 已修 |
| 16 | S2 | RulePriceWorkbench「应用筛选」不对齐 | C | 已修 |
| 17 | S2 | 工单列表表头与行勾选框不同列 | D | 已修（表头保持 44px 目标，指示框同列） |
| 18 | S2 | 勾选框 12px 透明边未抵消（改单页急单等 8 处） | C | 已修 |
| 19 | S2 | 勾选框文字间距三档 → gap-1 统一；多行 items-start | C | 已修 |
| 20 | S2 | SampleOrderForm 顺丰到付勾选框居中错位 | C | 已修 |
| 21 | S2 | 通知页「测试/删除」375 错位；删除按钮对比度 | C | 已修 |
| 22 | S2 | 页头四套实现、H1 六种字号 | B | 已修 8f487401 |
| 23 | S2 | 返回入口 6 形态、新建页重复返回、4 类二级页缺返回 | B | 已修（组件内受控返回保留在 AdminOrderEditor，见备注） |
| 24 | S2 | 面包屑窄屏隐藏父级、「页面」回落、客户端 h1 闪变 | B | 已修 |
| 25 | S2 | not-found 把销售引到 /owner | B | 已修 |
| 26 | S2 | 详情/表单页路由 loading 画表格骨架（CLS 0.196） | B | 已修（含盘点页首屏服务端数据） |
| 27 | S2 | 内容宽度无规则 | B | 已修（FormPage） |
| 28 | S2 | 编辑页状态三种表达、「活跃/启用」 | B | 已修 |
| 29 | S2 | 侧栏/面包屑/H1/title 命名不一 | B | 已修 |
| 30 | S2 | 文案外显 finishedAt / v2 / legacy / worker / Bot ID | B（页面）+C（组件）+A（门禁） | 已修 + ui-copy 新规则 |
| 31 | S2 | 良品/次品 vs 合格/缺陷 → 合格/不良 | B | 已修（师傅端统一合格/不良） |
| 32 | S2 | RecordPaymentForm 收款/付款混用 | C | 已修（统一「收款」） |
| 33 | S2 | 确认文案笼统、流程动词不一 | C | 已修（「批准」保留，见备注） |
| 34 | S2 | 手写危险样式 7 种 | C | 已修 |
| 35 | S2 | 禁用无原因（5 处） | C | 已修（5 处） |
| 36 | S2 | 列表「搜索」主按钮与「新建」并存 → 搜索改 outline | D | 已修 |
| 37 | S2 | /orders 点击无即时反馈、看板卡/快捷筛选无 pending | D | 已修（LinkPendingHint） |
| 38 | S2 | /orders 队列条每次重挂载（`key` 在外层） | D | 已修 |
| 39 | S2 | 全仓无 `scroll={false}` | D（组件）+B（页面） | 已修 |
| 40 | S2 | 师傅端任务/工资页串行、无 Suspense | B | 已修 |
| 41 | S2 | 原生 GET 筛选表单整页刷新 → next/form | D（共享）+B（页面） | 已修（共享工具栏、/orders、页面筛选） |
| 42 | S2 | 规则中心分区 Suspense 无 key | D | 已修 |
| 43 | S2 | 触控被强行压小（`min-h-0!`、`!min-h-10`） | C | 已修 |
| 44 | S3 | 空表格返回 null 留空壳 | C | 已修 |
| 45 | S3 | 产品资料详情 dl 非法 | C | 已修 |
| 46 | S3 | 建单烫金色卡不暴露选中态 | C | 已修 |
| 47 | S3 | 批量建单切换重建 OrderForm | D（记录风险，不改表单内部） | 部分：仅推迟 sessionStorage 写入；<Activity> 保活需改 OrderForm effect，登记为后续 |
| 48 | S3 | 同义动词（新建/新增、删除/移除、清除筛选、X中…/正在X…、放弃并离开） | C+B | 已修 |
| 49 | S3 | 必填标记 4 种写法 | C | 已修（RequiredMark） |
| 50 | S3 | 透明度漂移；Alert 与 ActionNotice 边框不一 | A | 已修（统一 /40） |
| 51 | S3 | Skeleton 无内置减少动效 | A | 已修 |
| 52 | S3 | 字重越界、tracking 任意值 | C | 已修 |
| 53 | S3 | z-index / 浮层阴影无刻度 | A（规范）+C | 已修（规范 §8.2.1 + 头部 z-20） |
| 54 | S3 | showcase 缺 5 个组件 | B | 已修 |
| 55 | S3 | 附录 A-7 失效登记 | G | 已修（附录 A-7 更正） |
| 56 | — | components 直连 db（2 处） | G 记录，不在本轮 UI 范围 | 部分：WorkerCompletionDetail 已迁到 lib/production；orders/production/page.tsx 直连 db 仍在，登记后续 |
| 57 | — | 薪资页 400 请求 | G 排查 | 已修（<a download> + eslint 门禁） |
| 58 | — | 规范新增条款（对齐、勾选、按钮顺序、宽度、命名、选中态、刻度） | G | 已修（ui-规范 §8.1–§8.3） |


## 备注

- `AdminOrderEditor` 的返回仍是受控按钮（保存/上传中需禁用并走离开确认），PageHeader 的 `back` 是纯链接，故未替换。其他四个删除了底部「返回列表」的表单（Bom/Craft/ProductCategory/PurchaseOrder）改由页头返回；提交中的离开保护依赖 PendingButton 的导航拦截。
- 「批准变更」确认按钮保留「批准」，避免与触发按钮同名冲突。
- 留待下轮：
  - 原生 select 全量迁移（P2-2，72 处 / 41 文件）。
  - 运行时几何探针门禁化（本次探针脚本未入库）。
  - `OrderForm` 的 `<Activity>` 保活（批量建单切换重建表单）。
  - `orders/production/page.tsx` 直连 db。
  - `PageHeader.back` 支持提交中锁定：Bom/Craft/ProductCategory/PurchaseOrder 四个表单删掉底部返回后，提交中离开只剩 PendingButton 的导航拦截；新建外协单保留表单内锁定返回（§8.3 例外）。

## 验证

- 静态门禁：`check:architecture`、`test:backup`、`lint`（含 ui-copy 0 命中、ui-tokens 0 违例）、`typecheck` 全部通过。
- 单测：716 文件 / 7858 项通过（143 跳过）。
- 组件浏览器测试：59 文件 / 908 项通过。修复中发现并处理：表头勾选框 44px、价格版本选中态小字对比度、`SidebarInset` 缺 `min-w-0`（测试夹具与真实布局不一致，已下沉到原子件）、浏览器模式 `next/form` 需要 `process.env` 定义。

- E2E（隔离库、开发配置、单 worker）：
  - 首轮 chromium 199/216，17 失败，逐条定位：12 项为本轮回归（RequiredMark 进了 label 文本、面包屑无 title 截断、规则中心栏浅色对比度 1.43、销售筛选暗色叠色 3.99、not-found 丢 data-kind、详情页 React key 警告触发错误弹层），1 项为有意改名（删除 → 永久删除），其余为同因连带；修复见 8fcd1ed9。
  - 终轮 chromium 215/216；唯一失败 `purchase-flow` 为既有测试时序问题（确认层关闭即读库），改为轮询持久状态后 4/4 通过（969c9848）。
  - 六视口门禁：管理端 152 通过 / 10 跳过（首轮 24 失败：新建外协单双返回入口 + 面包屑改名定位，已修）；师傅端 12/12。
  - 期间一次开发服务器 Turbopack 持久缓存 panic（`Restore of All … failed`），清 `.next` 后不再出现，与业务无关。
