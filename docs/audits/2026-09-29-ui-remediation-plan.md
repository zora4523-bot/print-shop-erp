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
  - 原生 select 全量迁移（P2-2，72 处 / 41 文件）。——order/bill 以外已迁（2026-09-29），并加 eslint 门禁禁 JSX `<select>` / `<textarea>`。
  - ~~运行时几何探针门禁化~~ **已入库（2026-09-29）**：`tests/visual/ui-gates-geometry.ts` 并入 `expectViewportGate`，admin/worker 响应式门禁全部路由自动获得四条规则：`row-misaligned`（同行控件底边差 >2px 且高差 >2px；每个控件只归属最近一个含其他控件的 flex/grid 行，纯图片缩略图触发器不算控件）、`checkbox-offset`（指示框与其后首个可见标签文字首行中心差 >3px，跳过 `.sr-only`）/ `checkbox-gap`（间距不在 2–20px）、`icon-offset`（输入框内绝对定位图标中心差 >2px）、`selection-column`（「选择本页」/thead 全选框与首行勾选框中心 X 差 >1px）。样式指纹普查仍只作审查工具，不进门禁。首次运行命中的真实问题（待修，门禁在修复前为红）：
    - `/foreman/materials` 搜索框放大镜 `top-2`，全部六视口 dy −6px（`icon-offset`）。
    - `/foreman/outsource/new` 款式勾选行 `items-center` + 长名换行，dy 12–24px（375/393/768/1024）。
    - 工单详情「变更申请」款式勾选（`OrderChangeRequestForm`），长名换行 dy 12–36px（六视口）。
    - `/orders/new` 急单说明在 375/393 换行，dy 8.5px（`OrderForm` 急单字段）。
    - `/orders` 桌面紧凑列表「选择本页」与行勾选框 dx 5px（1024/1280/1920）。
    以上四条勾选均违反 §8.1「多行说明 `items-start` 且勾选框与首行居中」。
  - `OrderForm` 的 `<Activity>` 保活（批量建单切换重建表单）。
  - `orders/production/page.tsx` 直连 db。
  - ~~`PageHeader.back` 支持提交中锁定~~ **已解决（2026-09-29）**：`back.pending` 复用 `PendingLink`（aria-disabled、tabindex -1、阻止点击/导航）；页头与表单分处服务端页面时用 `components/business/form/FormPendingScope`（客户端 Provider，不产生 DOM）+ `ScopedPageHeader` / `RuleCenterPageHeader lockBackWhilePending`，表单内 `useReportFormPending(pending)` 上报。Bom/Craft/ProductCategory/PurchaseOrder 四个表单已接入；SSR / 零 JS 下 pending 恒 false，不影响原生提交。新建外协单仍保留表单内锁定返回（§8.3 例外）。

## 验证

- 静态门禁：`check:architecture`、`test:backup`、`lint`（含 ui-copy 0 命中、ui-tokens 0 违例）、`typecheck` 全部通过。
- 单测：716 文件 / 7858 项通过（143 跳过）。
- 组件浏览器测试：59 文件 / 908 项通过。修复中发现并处理：表头勾选框 44px、价格版本选中态小字对比度、`SidebarInset` 缺 `min-w-0`（测试夹具与真实布局不一致，已下沉到原子件）、浏览器模式 `next/form` 需要 `process.env` 定义。

- E2E（隔离库、开发配置、单 worker）：
  - 首轮 chromium 199/216，17 失败，逐条定位：12 项为本轮回归（RequiredMark 进了 label 文本、面包屑无 title 截断、规则中心栏浅色对比度 1.43、销售筛选暗色叠色 3.99、not-found 丢 data-kind、详情页 React key 警告触发错误弹层），1 项为有意改名（删除 → 永久删除），其余为同因连带；修复见 8fcd1ed9。
  - 终轮 chromium 215/216；唯一失败 `purchase-flow` 为既有测试时序问题（确认层关闭即读库），改为轮询持久状态后 4/4 通过（969c9848）。
  - 六视口门禁：管理端 152 通过 / 10 跳过（首轮 24 失败：新建外协单双返回入口 + 面包屑改名定位，已修）；师傅端 12/12。
  - 期间一次开发服务器 Turbopack 持久缓存 panic（`Restore of All … failed`），清 `.next` 后不再出现，与业务无关。

## 第二轮（2026-09-29，上一轮遗留）

| 遗留项 | 结果 | 提交 |
|---|---|---|
| 原生 select 全量迁移（P2-2） | 73 处 select + 剩余 textarea 全部迁到 NativeSelect / Textarea，eslint 禁止原生 `<select>` / `<textarea>` | b7707951 |
| 运行时几何探针门禁化 | `tests/visual/ui-gates-geometry.ts` 并入 `expectViewportGate`：行内控件底边、勾选框首行居中与间距、输入框图标居中、表头全选同列；首轮命中 5 处真实问题并已修 | 28524ffd、b7707951 |
| 批量建单保活 | 每张表单挂在独立常驻节点，只挂当前一张；切换不再重建 OrderForm，id 唯一，只有当前表单登记编辑器与离开守卫 | b7707951 |
| `orders/production` 直连 db | 数据组装下沉 `lib/production/dispatch-page.ts`，页面不再引用 db | e67ec43e |
| PageHeader back 提交中锁定 | `back.pending` 走 PendingLink；四个表单经 FormPendingScope 把提交状态传给页头 | b7707951 |

验证（隔离库、开发配置）：静态门禁全过；单测 718 文件 / 7865 项；组件浏览器测试 60 文件 / 910 项；chromium E2E 216/216；六视口门禁管理端 150 通过 / 10 跳过、师傅端 12/12。管理端首轮有 2 项（768、1024 的 `/orders` 搜索回车后等待地址栏 `q`，5 秒超时）失败，单独复跑 4/4 通过，判为偶发时序。

观察项（未改）：
- `/orders` 筛选表单改为 `next/form` 后，地址栏要等 RSC 返回才更新（原生 GET 是整页跳转，地址栏即时变化）；负载高时上述用例可能超时。若要消除，可给筛选提交加即时 pending 提示或让测试等待列表结果而非地址栏。
- 批量建单保活后，隐藏表单的报价请求、自动保存定时器仍在运行（10 张时内存与后台请求增加）；隐藏表单出错要切回才可见。

## 完整性复审（2026-09-30）

用户要求复查是否有遗漏。两路独立复审：逐条代码取证代理（审查报告第五节每条 → HEAD 证据 + 全仓同类残留扫描）与 Codex 完整性审查（c3908b1c..HEAD）。结论：**多条标「已修」的条目只修了首个位置**，同类问题在其它文件仍在；另有审查报告第七节承诺的 ESLint 门禁未落地。以上状态表中的 #2、#8、#22、#27、#36、#39、#41、#48、#49、#52、#53 在本节之前的「已修」不准确，已由 1db38838 收口：

| 类别 | 遗漏位置（摘要） | 收口 |
|---|---|---|
| #2 待工厂核价颜色 | 工单列表金额/摘要、看板卡、详情核价区、建单成功页、销售侧栏 | 全部 primary；ActionNotice 新增 `tone="primary"` |
| #9/#1 确认层 | 驳回、取消并结算、拒绝取消申请、拒绝变更的确认框缺 danger；取消并结算关闭按钮仍叫「取消」 | 传 danger + 具体关闭文案 |
| #8 选中态 | 工单行操作墨色覆写、看板卡、快捷筛选、师傅工资、关注事项 | 统一 `variant="selected"` |
| #22/#23 页头 | 建单、样品、收费工作台、客户计价手写 h1；/orders 字号覆写；销售改单双返回；新建工单无返回 | PageHeader + 唯一返回 |
| #27 宽度 | 规则目录四个新建页 | `FormPageContainer` 唯一定义，FormPage 复用 |
| #36/#39/#41 筛选 | 4 个原生 GET 表单、3 页双主按钮、状态标签缺 scroll/pending、清除入口手写 | next/form + FilterClearLink；搜索 outline |
| #48 文案 | 清空/清除搜索/清除全部/全部记录、登录中…/处理中…、入口「创建X」、新增款式、恢复使用、缺陷数/良品/次品（含 lib 报错与 XLSX 表头） | 按口径统一 |
| #49 必填 | 4 张表单必填与选填混用；确认层理由手写星号 | 只标必填；RequiredMark 唯一实现在 ui-business |
| #52/#53 字重/层级 | `z-[5]`、`z-[8]`、`shadow-xl`、粘性栏 `shadow-lg`、`tracking-[…]`、非 KPI extrabold | 按 §8.2.1 |
| 原生 input | 14 处可见 `<input>`（UI 迁移清单 P2-2 的 input 部分从未执行） | 全部 Input |
| 其它 | 暗色禁用勾选框不可见、勾选行 opacity 淡化、暗色红按钮悬停对比 4.27、无权限空态 h1 14px、ChannelForm/RuleForm 错误未连线、销售账单详情回显原始枚举、/orders 看板 1280 孤行、表格行「编辑」红色下划线链接 ×8、价格阶梯编辑器按钮与输入底边差 20px | 已修 |

新增门禁（业务范围，0 命中）：原生可见 `<input>`；Button / buttonVariants 的 className 覆写 `bg-primary|foreground|destructive` 或固定高度；`<h1>` 仅限 PageHeader / EmptyState 与四个独立外壳（global-error、login、改密码、作废工单）。

有意保留：
- `app/(admin)/owner/prices/external-sales/visual-fixture` 页面有两个 h1：仅非生产环境渲染的视觉验收夹具，其标题是视口门禁的 `readyHeading` 锚点。
- `app/wo/[orderNo]` 作废警示页的强化样式，登记为附录 A-9。
- 详情页「暂不能结算」阻塞块保持 warning：属于阻塞 / 待办，不是待核价。

已知后续（非本轮范围）：
- 多个 E2E 原生 SQL 夹具用 `NOW()` 写入无时区时间列，库时区为 Asia/Shanghai 时比实际快 8 小时；看板夹具按上海当天中午建单。上海时间 0–12 点跑全套时，这些单会排在列表最前，挤掉依赖首屏的用例（`sample-orders` 已改为按工单号搜索定位）。
