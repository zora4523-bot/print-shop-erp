---
status: canonical
owner: engineering
last_verified: 2026-08-24
applies_to: current worktree
---

# UI、状态反馈与工程文档整改任务

本文把 2026-08-24 的设计稿对齐审查、状态组件审查和工程文档审查整理成可独立实现、独立验证的任务。它是执行顺序与验收边界，不替代业务规格、`DECISIONS.md` 或部署 runbook。提交 `41abe65` 之后的对抗复审、代码证据和细分任务见 [`UI-UX-ADVERSARIAL-REVIEW-2026-08-24.md`](./UI-UX-ADVERSARIAL-REVIEW-2026-08-24.md)。

## 分级方法

### 严重程度

- **S0 · 致命**：已确认会造成越权、不可恢复的数据损失或生产中断。本轮 UI 审查没有确认 S0。
- **S1 · 高**：会阻断核心操作、误导业务状态、造成重复/错误操作，或在故障时没有恢复路径。
- **S2 · 中**：明显的一致性、可访问性、响应式或维护性缺口，但已有可用替代路径。
- **S3 · 低**：主要影响长期演进效率和视觉漂移控制。

### 修改成本

- **C1 · 小**：单个组件或少量文件，无数据库变更，可用定向测试验收。
- **C2 · 中**：一个共享组件及若干消费者，需要组件测试和关键页面回归。
- **C3 · 大**：跨多个领域或需要状态契约调整，需要 E2E/视觉回归。
- **C4 · 计划级**：覆盖页面族、数据库/审计或大批量迁移，应拆批交付。

排序规则：先按严重程度从 S1 到 S3，再在同级内优先低成本任务。每个任务只拥有表中列出的文件/能力边界，避免并行修改互相覆盖。

## 独立任务清单

| 顺序 | ID | 严重度 | 成本 | 独立任务 | 依赖 | 验收标准 | 状态 |
|---:|---|---|---|---|---|---|---|
| 1 | UI-F01 | S1 | C1 | 根路由错误恢复 | 无 | 新增根 `error.tsx`、`global-error.tsx`；认证、账号、打印等非 admin/worker 路由发生意外错误时可重试；不泄露服务端错误详情 | 已完成 |
| 2 | UI-F02 | S1 | C1 | CDR 过期结果“按同条件重新生成” | 现有 `LongTaskReceipt` | 过期记录有明确操作；保留原条件；重复点击受 pending/幂等保护 | 已完成 |
| 3 | DOC-01 | S1 | C2 | 建立九类工程文档与 UI 单一事实源 | 无 | 九个标准入口可发现；README 不再指导重建项目；部署、迁移、seed、cron 口径引用权威来源 | 已完成 |
| 4 | UI-F03 | S1 | C2 | 统一操作反馈与确认层 | UI-P01、UI-S01 | 新增 `ConfirmActionDialog`；替换全部 `alert/confirm`；L2 显示影响范围；L3 在业务已有 reason/remark 契约时必填并恢复焦点，禁止由 UI 自创字段 | 基础组件完成；主数据启停、账单/外协、采购/盘点、工单/排产/发货、师傅批量完工与薪资领域已迁移；需新增审计理由的动作仍待 ADR |
| 5 | UI-F04 | S1 | C2 | 统一业务状态注册表 | UI-S01 | 页面不再定义本地 `StatusBadge`；账单、通知、任务、薪资的 label/tone/dot 集中；失败/取消才使用 danger | 部分完成（核心域；采购/CDR/发货/导出待迁移） |
| 6 | UI-F05 | S1 | C2 | 工单变更逐字段差异 | 无 | 审批页显示字段名、before、after、计价影响和生产阻断；空值和长文本可读；审批仍受现有权限与并发锁保护 | 已完成 |
| 7 | UI-F06 | S1 | C3 | Server Action 统一 pending 与结果反馈 | UI-S01 | 所有写表单使用 `PendingButton` 或等价 hook；表单有 `aria-busy`；成功/失败不会只靠按钮复原表达 | 部分完成：当前 74/74 个生产 `useActionState` 消费者均有 busy/pending 结构契约；确定性断网与未知提交结果仍归 `UI-F14` |
| 8 | UI-F07 | S1 | C3 | 长任务与部分成功统一回执 | UI-S01 | 已证明的导出/CDR 长任务显示回执 ID、状态、成功/失败明细、重试与过期；账单生成、薪资重算先量化耗时/超时，达到阈值后再迁移后台回执 | 部分完成 |
| 9 | UI-F08 | S1 | C3 | 通知投递状态与人工决策 | UI-S01；先确认 schema/审计契约 | 传输状态与 job 状态分列；`UNKNOWN` 支持已送达/重发/忽略并留痕；`RETRYING + DEAD` 不被合并成单一状态 | 已完成 |
| 10 | UI-F09 | S1 | C3 | 工单列表批量选择与行内更多菜单 | UI-P01、List shell | 桌面/手机均可选择；批量条仅出现合法动作；每行保留 1 个主动作，其余进入“⋯”；权限和终态动作不泄露 | 安全子集完成；已有批量排产能力待 UI 交接，其他批量写操作待契约 |
| 10.5 | UI-F01B | S1 | C3 | Dashboard/定价/仓库分区错误隔离 | UI-F01、UI-S01 | 数据获取拆为可独立流式渲染的分区；一个数据源失败只替换该分区，其他内容和页头动作继续可用 | 部分完成 |
| 11 | UI-F10 | S1 | C4 | 主数据“被引用”与停用影响范围 | UI-F03；需要逐领域查询 | 产品、工艺、账号、BOM 等主数据展示引用状态；停用进入 L3 并列出影响对象；历史引用保留 | 部分完成：账号、工艺、BOM、分类、往来单位、物料与调价启停已有 L2 影响确认；真实引用数、会话/任务影响与审计 reason 仍待逐域契约 |
| 12 | UI-S01 | S2 | C1 | 状态反馈组件补齐 | 无 | `ActionNotice`、`FormMessage`、`FormErrorSummary`、`BatchActionResult`、`ConflictResolutionPanel`、`TerminalReadOnlyBanner`、`TableEmptyState` 有测试和 showcase | 已完成 |
| 13 | UI-P01 | S2 | C1 | 基础 UI 原子件补齐 | 无 | `Card`、`Alert`、`Textarea`、`Dialog/AlertDialog`、`Progress` 遵守 token、data-slot、焦点与暗色规范 | 已完成 |
| 14 | UI-F11 | S2 | C2 | 空态单一所有者 | UI-S01 | 移除双重空态；区分 no-data/no-result/no-access；表格使用 compact/table variant；不再新增手写“暂无” | 部分完成（共享列表与首批详情页） |
| 15 | UI-F12 | S2 | C2 | 表单字段原子化与错误摘要 | UI-P01、UI-S01 | 收口本地 `TextField`；统一 label/hint/error ID；提交失败聚焦首个错误；静态前置缺失不使用 assertive error | 部分完成（首批五域） |
| 16 | UI-F13 | S2 | C2 | Loading 骨架收口 | UI-S01 | route loading 与分区 Suspense 共用骨架；行数匹配真实分页；页面 chrome 不被替换；8 秒后才提示慢加载 | 部分完成 |
| 17 | UI-F14 | S2 | C2 | 网络断开与 Server Action 失联反馈 | UI-S01 | `Failed to fetch` 可解释为服务失联；提供刷新/重试；保留用户输入；不把网络故障伪装成字段错误 | 部分完成（错误边界/文档） |
| 18 | DOC-02 | S2 | C2 | 发布日志治理 | DOC-01 | 现有 SPEC 历史明确归档；新 CHANGELOG 按 release/SHA 记录 Added/Changed/Fixed/Migrations/Operations，不伪造历史版本 | 已完成 |
| 19 | UI-L01 | S2 | C3 | `ListPageShell` 与 `ResponsiveDataView` | UI-P01、UI-S01 | 列表统一页头、筛选 chips、计数、桌面表格、手机卡片、横滚提示、批量条、分页和五态 | 部分完成（工单列表） |
| 20 | UI-L02 | S2 | C3 | `DetailPageShell` | UI-P01、UI-S01 | 详情统一 sticky 动作、状态、时间线、证据分区、终态只读；先迁移账单/外协/采购 | 部分完成（工单详情） |
| 21 | UI-L03 | S2 | C3 | `FormPageShell` | UI-P01、UI-S01 | 表单统一分区、草稿/保存状态、摘要/缺口、错误摘要与 sticky actions；先迁移主数据表单 | 部分完成（新建工单/首批主数据） |
| 22 | UI-Q01 | S2 | C3 | 核心页真实视觉基线 | UI-L01–03 | showcase 与核心流程在 393/1280、light/dark 使用稳定 fixture 做 `toHaveScreenshot`；继续保留 axe/溢出/触控门禁 | 待开始 |
| 23 | UI-Q02 | S3 | C2 | 防回退静态门禁 | UI-F03、UI-F11、UI-F12 | ESLint/结构测试禁止业务层新增调色板字面量、原生 confirm/alert、本地状态徽章、无原因禁用和重复空态 | 部分完成（颜色与原生弹窗） |

## 并行边界

- `UI-P01` 只修改 `components/ui/`。
- `UI-S01` 只修改 `components/ui-business/`、对应测试和 showcase。
- `DOC-01` 只修改 Markdown 文档。
- `UI-F01` 只修改根错误边界、分区包装及其测试。
- 领域迁移任务一次只拥有一个页面族；共享组件变更先回到对应基础任务，禁止在领域页复制一份。

## 每个任务的共同完成门禁

1. 不改变权限、金额 Decimal、快照、乐观锁、审计和幂等业务不变量。
2. `pnpm typecheck`、`pnpm lint`、相关 Vitest 必须通过。
3. 修改页面布局时必须通过 375/393/768/1024/1280/1920 的 light/dark 几何、axe、溢出与触控门禁。
4. 修改打印必须另立任务并经过既有 8 张截图基线；本清单默认不触碰打印。
5. 禁止通过放宽断言、删除测试或更新无关基线制造“通过”。
6. 每个任务在对应文档中更新状态、验证命令和仍未覆盖的边界。

## 2026-08-24 对抗整改增量

以 `41abe65` 为代码基线，本批按领域独立提交，没有放宽业务、权限或测试契约。

| 提交 | 已交付范围 | 契约边界 |
|---|---|---|
| `fb0c156` | 账号、工艺、BOM、分类、往来单位、物料与调价启停 L2；账单发单/收款 L2 | 无服务端 reason 的启停不伪造 L3；真实引用计数仍待逐域查询 |
| `4be1421` | 根 404、工单无数据/筛选无结果区分、三个权限安全动态标题 | 404 继续不泄露对象是否存在 |
| `aceea3f` | 强焦点、44px 触控、共享 disclosure、portal reduced-motion、错误摘要聚焦/去重播报 | 不通过修改颜色语义或放宽 axe 断言规避问题 |
| `7474ccb` | 采购取消 L2、收货取消 L3、盘点过账 L3 | L3 只复用已持久的 reason/remark；保留现有库存流水与部分成功语义 |
| `851dbcb` | 工单变更审批/拒绝、发货、批量排产确认 | 发货准确表达费用定稿、应收重算、非终态 `SHIPPED`、不扣库存和通知排队 |
| `fb86fed` | 师傅批量完工 L2、逐任务数量/计薪预览、未知返回恢复提示 | 忠实保留现有“同一事务，任一失败整批回滚”，不伪称部分成功 |
| `edd72dd` | 外协回货/取消/付款 L2，幂等付款预览和结构化回执 | 回货不伪称确认应付或付款；只在条件满足时可能促成关联工单完工 |
| `a5f88fe` | 日薪/时薪发放与撤销、客服工资流水、时薪重算、客服单周期/批量结算 L2 | 无持久 reason 所以不升 L3；保留幂等、规则快照、已发锁定与逐项事务语义 |
| `c49d7b0` | 账单收款、外协付款与外协回货的 Enter 键路径 | 原生表单触发提交时先进行校验并打开 L2；仅确认按钮可放行真实提交，禁止键盘绕过 |

本批纳入实施的高风险 UI 已安全收口，但下列不得由 UI 自行决定：

- 工单编辑 CAS/三选冲突恢复与 DRAFT 款式编辑范围；
- 价格冲突的“用我的 / 用最新 / 取消”服务端覆盖/合并契约；
- 考勤撤销的硬删除、actor 审计、已发工资阻断与月份锁；
- 通知模板/群绑定的强制理由与审计载体；
- 账单生成、薪资重算/结算是否达到后台长任务迁移阈值；
- 非打印页的 owner 签核像素基线。

## 2026-08-24 验证记录

本批验证不通过放宽断言或更新无关截图基线制造通过；打印基线保持不变。

| 门禁 | 结果 |
|---|---|
| `pnpm exec vitest run`（clean HEAD） | 281 个文件 / 3247 项全部通过 |
| `pnpm typecheck` | 通过 |
| `pnpm lint` | 通过，含颜色字面量与原生 `alert/confirm` 防回退规则 |
| `pnpm exec prisma validate` | schema 有效 |
| `git diff --check` | 通过 |
| `pnpm build` | Next.js 16.2.4 Turbopack 生产构建通过，61 个静态页面生成完成 |
| `pnpm test:admin-ui` | 36 / 36 通过；6 视口×明暗主题，含几何、触控、axe 和候选截图 |
| `pnpm test:worker-ui` | 12 / 12 通过；6 视口×明暗主题 |
| `pnpm exec playwright test tests/visual/order-print.spec.ts --project=chromium` | 8 / 8 像素基线通过，未更新 expected 截图 |
| `pnpm exec playwright test tests/e2e/batch-scheduling.spec.ts tests/e2e/production-flow.spec.ts --project=chromium --workers=1` | 5 / 5 通过；覆盖批量排产和生产主流程 |
| 应用内浏览器实机 | Dashboard 在 393 与 1280 宽度无页面级横向溢出、控制台 0 error；账号停用与时薪重算 L2、根 404、收款 Enter 键不绕过确认均已复核，未提交真实业务变更 |
| 开发服务器 | Node 24 持久运行于 `http://localhost:3000` |

全量 Vitest 使用 `git archive HEAD` 的干净快照运行，避免把共享工作区中不属于本批的未提交文件误算入结果。验证仅证明上述路由与状态通过当前门禁。`UI-Q01` 仍保持待开始：管理端与师傅端的候选截图不是经业主确认的设计稿像素基线。
