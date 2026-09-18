# 开发进度

> 本文档记录"当前做到哪了、下一步做什么"。每次 session 结束前更新。

## 当前阶段

**P0/P1 + Pigsty/ERP 主数据 + 生产硬化已完成，生产环境仍运行 `aa42ba0`**。当前发布提交另已完成工单列表/导出、工单详情语义修复、对客加工费自动报价、外部销售版本化价目簿、结算方向冻结、员工工资与供应商应付分账、改单审批重报价和金额权限隔离。本轮又把外部销售收费管理重构为可检索、可筛选、可安全编辑的业务工作台，并将同一产品的精确数量价位合并为一个可原子保存的价格阶梯；完整发布候选**已由 2026-08-18 的 Git 提交固化，但尚未部署生产**。2026-08-21 又在其上叠了两批上线前修复，2026-08-23 完成 Codex 独立结构复审与成立项收口。当前 `HEAD` 已跟踪 **82 项** migration，工作树另有 1 项未提交 migration；生产仍是 `aa42ba0` / 45 项。

## 最后更新

2026-09-18（对抗 review 修复批次 12 个提交在 `codex/memory-after-pr19`，未 push；PR #19 已合入 `main`；生产未部署）

## 已完成

### 2026-09-18 对抗 review 修复批次

- 120g 退役只拦新建入口（`hasRetiredPaperItem`），共享报价适配器中立，含 120g 的历史工单可改单 / 取消结算；「关联物料已停用」的历史工单仍被既有规则挡，待拍板（HANDOFF 卡住的问题）。
- 改单烫金色显示名反查并保护真实目录名；师傅工资汇总 / 未结算报工全量，链接只带显式日期；规格按可用克重启用 + 设计款分叉提示；珠光暗红显示名补齐详情 / 打印 / 导出 / 师傅端。
- 12 个提交（`3f0ce6db` 起），全量 Vitest 7024 通过、OrderCreationWorkspace browser spec 5/5，Codex 六轮对抗 review。
- 追加：收货地址输入统一复用粘贴自动识别组件 `ReceiverAddressPasteField`（`d58f5e79` + 两轮 Codex 修正），寄样品/打样、追加地址、工单编辑、建单额外地址、客户默认地址全部接入。
- 追加：管理员侧栏「工单」改「工单列表」，「新建工单」进「常用」一级入口（`lib/navigation/admin-modules.ts` 新增 `owner.orders.new`）。

### 2026-09-15 寄样品与打样

- [x] 工作台新增两类入口，外部销售可创建；公共收件信息保留、账号范围草稿恢复。
- [x] 寄样仅快递费 + 包装费，最新已发布包装默认最小档，免生产；打样管理员整单核价，费用版本/审计/结算保持单一总额。
- [x] 管理与销售用途胶囊；148 项 fresh migrations、6839 单测、23 组件浏览器回归、3 E2E 与 UI 门禁、类型/lint/架构检查。
- 首版与验证边界见 [实施记录](./docs/寄样与打样开发任务.md#实施记录2026-09-15)。本轮仅本地提交，未发布。


### 2026-09-15 半分金额容差与存量生产资料补录

- [x] 单价乘数量先舍入再拆固定费；建单与改单统一 0.01 元容差。
- [x] 管理员终价保存与生产就绪分离，未就绪日志/预览/详情页提示。
- [x] 管理员补录空工艺及缺失包装组，保留历史金额、版本锁和审计；已确认价格只对可信依据续接。
- Codex 逐文件说明见 `docs/archive/2026-09-14-金额与存量生产资料修复报告.md`；随 PR #19 合入 `main`，未部署。

### 2026-09-15 前端缺陷批次与 PR #19 合并

- [x] Codex 只读审计 4 条 + 技术债 2 项：登录跳转保留查询串（`2afdb77e`，`5bdb907e` 剔除 `_rsc`）、旧任务详情挂异议面板（`ace6f360`）、改密页无会话跳登录（`7ef99774`）、日薪 / 时薪 / 师傅端工资三处分页且合计走 aggregate（`23d0e29c`）、建单逐字段错误去 `role=alert`（`21e92124`）、后台外壳零 JS 原生退出（`cafb16ad`）。
- [x] CI run 34927184124 全绿（verify 67 分钟），PR #19 以 merge commit `d283b5a5` 合入 `main`，两个 `codex/*` 分支已删。生产仍为 `aa42ba0`。

### P0（MVP 核心，2026-05-06 收官，详细过程见 HANDOFF.md 历史）

- [x] **#1 认证与用户管理**（149 单测，Codex 15 轮）
- [x] **#2 工艺 + 产品字典**（累计 249 单测）
- [x] **#3 工单核心 E-lean**：创建/提交/编辑/取消、急单、打印 + Puppeteer PDF、OSS 直传脚手架（P0 当时 STS 仍是桩；现已真实接入并完成全链路验证）（累计 400 单测）
- [x] **#4 生产流程**：排产、师傅报工（薪资快照铁律）、外协单、SHIP/FINISH 状态机收尾，所有 Order.status 写入共享一把 advisory lock（累计 507 单测）
- [x] **#5 薪资系统**：师傅日薪、客服周期提成、时薪工月结 + 考勤，全量规则快照 + 已发放行拒绝重算（累计 716 单测）
- [x] **#6 应收账单**：生成/发单/收款；现行实现已将客服销售额流水与收款流水分离（累计 776 单测）
- [x] **#7 CDR 汇总下载**：24h 短链 + baseUrl 推导硬化（Codex rounds 119–126）
- [x] **#8 推送 + Dashboard**：作为 P1 #1/#2 交付（见下）
- [x] **#9 测试 + 运维**：E2E + 视觉回归、Sentry 隐私收紧、cron 端点、上线 checklist、4 个 prod-only bug 修复

### P1（2026-04-26 → 2026-05-05）

- [x] **P1 #1 老板 Dashboard** 三层：KPI 卡 + 关注列表 + recharts 图表（累计 870 单测）
- [x] **P1 #2 企业微信推送** 四切片：notify 引擎（mock-mode）→ admin UI → 业务事件 wire → cron 端点。当时的 SPEC 基线是 10 个事件；当前 registry 已扩展为 15 个，不再用历史的&ldquo;9/10&rdquo;表示现状。（累计 1011 单测）

### 企业微信通知现状（2026-09-02）

- [x] **canonical 通知接线收口**：保留历史 eventType `ORDER_SCHEDULED`，将触发边界收到 `CONFIRMED → RELEASED`，任务数按当前代次的计件工序 + 非计件进度步骤计数；`ORDER_COMPLETED` 在当前代次所有内部工作与必需外协通过闸口时按代次幂等发送，canonical 工单会原子收口到 `PACKING` 直到显式发货。
- [x] **企业微信单条字节守卫**：按[官方消息推送文档](https://developer.work.weixin.qq.com/document/path/99110)在模板保存和真实/mock 发送前均限制 `markdown.content ≤ 4096 UTF-8 字节`。
- [x] **共享 Webhook 全局节流**：真实 `sendWebhook` 以规范化 endpoint/key 的 SHA-256 摘要为键，由 PostgreSQL 原子预留 3500ms permit，同 URL 跨事件、跨 worker 进程串行；等待可被 durable lease signal 中止，mock/注入 sender 不触库。未部署 migration `20260902121100_notification_webhook_global_throttle` 前不得开启生产真发。
- [ ] **企业微信仍未完成的项**：尚未做 per-CS / 对应师傅的按人路由；真实企微群与 durable LIGHT worker 仍需在应用新 migration 后做生产人工验收。

### 2026-09-13 建单 / 定价 / 装盒 / 打印批次（26 个提交，详见 DECISIONS 2026-09-11 ~ 09-13）

- [x] 管理员建单定价与关联外部销售（仅 ADMIN 可选活动 SALES，冻结 `EXTERNAL_SALES`）；管理员创建不再录入工单客户及简称。
- [x] 包装：默认入袋、不包装、红卡盒 / 触感盒版本化装盒计价；每包上限 12；多地址装盒分别进位。
- [x] 专版十一档「达到档位取价」（`e5bac3cb`），价目簿由 `scripts/publish-confirmed-custom-tiers.ts` 发布，**不是 migration**。
- [x] 空白封纸张规格价格、批量打印 PDF、报价转单草稿修复、品牌名统一为「长昆纸品有限公司」、库存列表隐藏物料编码。

### 2026-09-14 结构体检与 PR #19 CI 复核（`codex/tijian-2` 修后快进）

- [x] 体检报告 `docs/archive/项目结构体检-2026-09-14.md`；6 项缺陷收口：架构门禁回绿、Browser Mode 截图产物 gitignore、golden-gate 按谱系登记期望（`1f6556ef`）、`lib/auth/schemas.ts` 按域拆分（`3a70278e`）、`docs/archive/` 归档规则、CLAUDE.md 1.3 同步。两轮 Codex 只读复审通过。
- [x] CI 复核（Actions 账单恢复后）：打印基线更新（`4a6d5fd9`，业主确认）、Browser Mode 5 个 spec 补 mock（`010b154f`）、管理端六视口门禁与 e2e 过时断言同步（`77aebdd7` / `8622a5dc` / `65c2e1de`）。
- [x] **真回归修复 `3578db20`**：管理员建单「复制当前」整页崩进错误边界（人工定价区按下标取款缺守卫）。
- [x] **`64f78382`**：装盒价目是部署后数据步骤，新增 `prepare-e2e-box-packaging.ts` 进 `test:e2e:prepare`；生产启用装盒仍需手动执行 `install-box-packaging-rules.ts --apply`。
- [x] `aec6e722`：经营分析业绩排行 Y 轴长显示名按字体度量省略，不再在 375 / 393 溢出。
- [x] CI 后三步（durable / 跨浏览器打印 / dev-fixtures）已在 run 34845568496 与 34927184124 跑绿；PR 已合并，`codex/tijian-2` 已删。

### 2026-09-03 提交记录

- `677a638` `feat(db): add workflow and notification safety state`：增加改单生产版本约束、共享 Webhook 限流台账及通知模板语义迁移。
- `df812c9` `fix(notification): harden WeCom production delivery`：收口 canonical 生产事件、跨进程限流、过期代次拦截、模板保护和失败告警。
- `165df27` `fix(pricing): require manual confirmation for plate fees`：独立制烫金版费改为管理员人工终价，禁止自动推导并防止彩印含版费套餐重复收费。
- `7a4a1ab` `fix(orders): harden change review lifecycle`：增加改单双版本并发守卫、取消/审核队列、价格确认门禁和生产代次时间线。
- `f140362` `fix(admin-ui): simplify order list navigation`：移除工单列表重复容器与侧栏冗余子组标题。
- 提交前门禁：503 个测试文件通过、4820 项通过、44 项按配置跳过；`typecheck`、`lint`、`prisma validate`、生产 `build` 与 `git diff --check` 通过。未向真实企业微信群发送消息，未部署；生产启用前必须先应用本批 3 个 migration。

### 生产硬化审查修复（2026-07-17）

- [x] worker 改为 PM2 管理 PID 内的 `node --import tsx`，heap limit / memory restart 对真实进程生效；生产 env 按 `@next/env` 加载，重启带指数退避。
- [x] durable 通知恢复“永不抛”契约；DEAD/CANCELLED dedupe 可重入队；CDR 终态同步；未知任务进入标准 fail/dead 流程。
- [x] 7 cron + 通知 + CDR + PDF durable 路径、repository、worker、handler registry 测试落地；**94 文件 / 1353 单测**全绿。
- [x] PDF 排队改自动重试 HTML，jobId 强绑定 actor/order；匿名 ready 响应移除任务明细与版本。

### Pigsty 扩展 + 内部 Admin 框架 + ERP 主数据（2026-06-28 批次，已提交并纳入当前生产版本）

- [x] **Pigsty PR-1..10**：`citext` 产品编码、价格窗口防重叠（`btree_gist`）、`ltree` 分类树、`pg_pinyin` 拼音搜索、`pg_ivm` 库存看板、partman/anon/pgaudit/cron/observability readiness（`app_ops.*`）、`/owner/pigsty` readiness 页
- [x] **A11–A15 内部 admin 框架**：action-helpers 契约、AdminDataTable 表格原语、模块元数据 registry、Soybean 风格 shell
- [x] **A16 往来单位**（Party/Contact/Address + 工单选客户回填快照）
- [x] **A17 采购单 + 收货**（部分收货、取消回冲，库存与流水同事务）
- [x] **A18 仓库/库位 + 库存台账**（默认仓回填、负库存拒绝）
- [x] **A19 BOM + 用料估算**（工单详情只读估算，不自动发料）
- [x] **A22 业务审计日志**（BusinessAuditLog + 敏感字段掩码）
- [x] **A23 复杂页客户端数据层 POC**（库存盘点页 + `/api/admin/*` 路由复用权限）
- [x] **UI Phase A–E**（已提交 `fde48b8 → 245be5c`）：design tokens、业务原子组件、admin shell 统一
- [x] **2026-07-05 全量验证**：prisma validate / tsc / eslint / next build / migrate deploy（16 个新 migration）/ **21 Playwright E2E + 视觉** 全绿
- [x] **2026-07-05 大批次提交固化**：按模块拆成 12 个 commit（`c84162f → accb713`），随时可按提交粒度回滚
- [x] **A09 分区 cutover 计划**（plan-only）：`docs/partition-cutover-plan.md`，Codex 2 findings 已闭合
- [x] **STOCK_ALERT 接线**（`3184a26` + `4f76a85`）：出库跨越检测，完成当时 SPEC 的原始 10 事件基线；当前通知事件总数为 15。
- [x] **A06 OSS STS 真实接入**（`968b131` + `d65804f` + `89b1302`）：ali-oss AssumeRole（session policy 收缩到单 objectKey）+ CDR 真打包（流式 zip → bundles/* + 24h 预签 URL）；`webhongbao` 对象策略已补齐，真实上传、越权护栏、CDR 打包、预签下载与 ZIP 校验 **6 / 6 全通**；**1229 单测**。

## 进行中

- [x] 外部销售快递/打包耗材扩展已完成 migration、历史回填、公式、角色投影、响应式与无障碍的最终对抗性验收。本轮实际绿灯为 74 / 74 migrations、170 个测试文件 / 2265 项单测、typecheck、lint、Prisma validate、生产 build、375px + 1280px 管理/销售明暗响应式 + axe 门禁和 `git diff --check`。
- [ ] 默认本地开发库有一张已全额结清的历史账单触发财务 migration 的失败关闭，不能用现行角色猜测重分账；干净隔离库 74 / 74 已通过，但历史库需业务负责人确认账单归属后再显式修复。详见 HANDOFF“卡住的问题”。

## 2026-08-21 并行缺陷修复批次（11 项）

- [x] **安全**：cron 密钥不再进 curl argv（`deploy/run-cron.sh` 改 `--header @-`，新增源码级门禁），`lib/cron-auth.ts` 换恒定时间比较；nginx 登录限流改挂 `location = /login` 并按 `$request_method` 豁免 GET（此前挂在 `/api/auth/callback/credentials` 上是一条假事实——本项目登录走 Server Action）；9 个详情页 `generateMetadata` 改查真实业务编号，顺带堵上 `owner/bills`、`owner/salary/cs`、`foreman/outsource`、`foreman/scheduling` 四页的标题越权泄漏。
- [x] **正确性**：日薪 / 时薪月结拒绝严格未来的 `date` / `month`（新增 400 分支，其余响应形状不变）；background-jobs 的租约与心跳时间戳一律锚到数据库时钟。
- [x] **无界查询**：`/owner/salary` 未发聚合下推数据库（+1 项 CONCURRENTLY 索引 migration，累计 **75 项**，尾项 `20260821090000_salary_unpaid_summary_indexes`）；交期看板与逾期推送各自收窄边界并加 `ORDER_OVERDUE_NOTIFY_CAP = 200` fan-out 安全阀（响应体新增 `truncated`）；师傅端「我的工单」改 `createdAt desc` 分页（`WORKER_ORDER_PAGE_SIZE = 20`，不再急单置顶）；`lib/order/export.ts` 11 个工作表 generator 全量显式 `select`、禁 `include`。
- [x] **可运维性**：新增 `/api/health/jobs` 死信 / 卡死 RUNNING / worker 缺失探针，`/api/health/ready` 状态码语义**刻意不变**（`deploy/update.sh` 拿它判定发布成败，历史死信不该拦住发布）。
- [x] **无障碍**：`OrderForm` 的 `TextField` / `TextareaField` 必填语义修复，`AttendanceRecordDialog` 补 `role="status"` 保存回执；新增 2 个 SSR markup 测试文件共 7 个用例。
- [x] 文档由单一 agent 统一同步：README、`docs/部署指南.md`、`docs/deployment-smoke-checklist.md`、`docs/production-slo-and-recovery.md`；DECISIONS 追加 12 条。**CLAUDE.md 未改**（配置文件，§4.5 关于 `reportTasks` 的措辞已漂移，改法写在 DECISIONS 2026-08-21 对应条目里，留给业主落笔）。
- [ ] 6 组待业主拍板 / 待同步项见 HANDOFF「卡住的问题」；本批次**未跑**全量 typecheck / `pnpm test run` / Playwright（并发多 agent 改同一仓库，全量门禁结果无意义），合并前需补一次完整门禁 + `pnpm test:admin-ui`。

## 2026-08-21 上线前对抗审查修复批次（4 项）

做法：四条候选高风险修复先各由另一方**逐锚点实读代码做对抗性审查**，再对全部 blocking / major 破绽逐条定稿，只实施定稿后的版本。结论是**四条方案没有一条能照原样实施**，全部 blocking 破绽经核对均属实。

- [x] **单条报工数量守卫**：`合格 + 不良 + 返工` 的合计 **达到** `计划数 × N` 一律硬拒；N 进新 `Setting` 键 `report_qty_max_multiple`（默认 3、范围收在 1–10）。判据用 `>=` 而不是 `>`：默认 10 倍配严格大于时，「多打一个零」恰好等于上限、一次都挡不住。超过计划数但未达上限由师傅勾选「确认超出计划数」通过并双处留痕（`ProductionTask.remark` + `OrderLog(action='TASK_OVER_REPORT')`）；**计件仍按实际合计数全额付**（业主拍板，算钱链路未改）。配套老板看板新增「超计划报工」表作为知情通道——**守卫与看板是一个决策的两半**，因为批准权落在被发钱的人手上。数量框刻意不设 `max`，上限判定只在服务端（否则零 JS 下只弹原生气泡，中文提示永远看不到）。
- [x] **工单完工闸口收紧为款式级外协覆盖**：由「有外协单且全部 `RECEIVED`」改为「每个含外协工艺的款式都被至少一张本工单未取消的外协单覆盖」。不改表，复用 `OrderItem.crafts` 与 `OutsourceOrder.orderItemIds`；新增共用谓词 `outsourceCoverageApplies` 让闸口与工单详情页横幅口径一致（`requiresOutsource` 是排产快照且无重算路径，不共用会出现「页面说不能完工、闸口照样完工」的反向漂移）。`ProductionCompletionTx` 返回值由 `boolean` 改为对象，五个调用点改取 `.completed`。**残留缺口（同款式两道外协工艺只发一道时仍放行）已显式接受，别当 bug 修**。
- [x] **盘点并发守卫改用逐行账面回声 CAS**：页面把「录入这一格时看到的账面数」钉在该行回传，服务端行锁后比对；冲突行剔除后**部分过账**余下的，一条不剩才整单回滚；另加事务外预检避免每次驳回白烧一个当日 IC 号。原「时间戳基线」方案的 4 条 blocking/major 全部源自那一个设计，整体否决。**零 schema 变更、零 migration、零新 `Setting`**。
- [x] **通知投递失败可重试并进死信**：`NotificationLog` 新增 `deliveryKey`（取 `BackgroundJob.dedupeKey`）与 `@@unique([deliveryKey, channelId])`，重试时 upsert 就地翻状态、跳过已成功的 channel；明确未送达的瞬时失败写 `RETRYING`，job 耗尽后日志仍保持 `RETRYING` 并通过 owning `DEAD` job 进入业主告警 / 待处理队列 / “重试耗尽”徽章；永久性投递失败仍让 job 判 `SUCCEEDED`。单次 cron 批量扇出按 `index × 3500ms` 摊开；2026-09-02 又增加了真实 webhook 出口的 PostgreSQL 跨事件/跨进程全局 permit，共享 URL 不再仅依赖批次内摊开。`/api/health/jobs` 新增 `deadNotificationLast24h` 与告警码 `dead-notification-jobs-last-24h`，通知类死信只 200 `degraded`；`/api/health/ready` 状态码语义不变。**+2 项 migration，累计 77 项**，尾项 `20260821120100_notification_log_delivery_key_unique`。
- [x] 文档同步：`DECISIONS.md` 追加 6 条；新增 `docs/上线前置操作清单.md`（外协覆盖的两段部署前只读 SQL、唯一索引 `indisvalid` 验收、单向门、上线后人工验证、OSS 未来实施的前置项）；`README.md`、`docs/部署指南.md`、`docs/production-slo-and-recovery.md` 同步 migration 计数与告警语义。**CLAUDE.md 未改**（配置文件，留给业主）。
- [ ] **明确不做**：OSS「临时 key + 服务端 copy」（业主决定保持 STS 单 key + 15 分钟过期的现有缓解，**已知接受的风险**，两个必踩陷阱已写进 DECISIONS）；盘点的逐行 `snapshotAt` + ledger scan（只解决「净额为零的往返」，已拆出单独设计评审）。
- [ ] 本批同样**未跑**全量 typecheck / `pnpm test run` / Playwright（并发多 agent 改同一仓库，全量门禁结果无意义），合并前需补一次完整门禁 + `pnpm vitest run --coverage` + `pnpm test:admin-ui`。

## 2026-08-18 完整发布候选提交固化

- [x] 将 8 月 7 日以来的工单筛选/导出、计价与结算分账、外协/工资账本、外部销售加工费与物流价目、收费工作台、价格阶梯编辑及其 migrations、测试和运维文档统一纳入本次发布提交。
- [x] 提交前重新核对全部新增与修改文件：没有真实 `.env`、密钥、日志、数据库、归档或构建/测试产物；打印 PNG 均为受测试管理的视觉基线。
- [x] 提交前最终门禁：**183 个测试文件 / 2441 项单测**、typecheck、全库 lint、Prisma validate、Next 16.2.4 生产 build、`git diff --check` 全绿；隔离端口启动当前应用后，零 JS 登录/登出/改密码 Playwright **3 / 3** 通过。
- [x] 本次动作只固化 Git 历史，不等于生产发布；生产仍是 `aa42ba0` 与 45 / 45 migrations，后续部署仍需独立授权、备份、历史数据预检和恢复门禁。

## 2026-08-17 三条关键会话路径建立零 JS 恢复门禁

- [x] 零 JS 可提交性只对登录、登出和改密码三条“失败后用户无法自救”的路径设为硬约束；其余后台 CRUD 保持 Server Action 原生表单为默认写法，但不再冒充全仓门禁。
- [x] 新增 Playwright `no-js` project，并在 `javaScriptEnabled: false` 下分别验证登录建立 session、登出清除 session、改密码往返服务端校验；师傅端开工/报工两处真实退化同时恢复原生 form 形状。
- [x] 决策边界与不纳入范围已记录在 `DECISIONS.md` 2026-08-17 和 `CLAUDE.md` §15.8，避免后续继续凭注释扩大约束。

## 2026-08-12 外部销售产品价格阶梯合并编辑

- [x] 收费项目按纸张分区；同一纸张下只保留“工艺 · 规格”的关键标题。`157克双铜纸彩印 大号` 的 7 条重复规则现显示为一个产品项目和 7 行“数量 / 当前价 / 草稿价”，`157克` 与 `200克` 因产品和匹配条件不同仍严格分开。
- [x] 只合并“同价目版本、同产品、同类目、同计价方式、同匹配条件、同互斥组/优先级、同来源文档/工作表/说明，且 `minQty = maxQty` 的 BASE 精确锚点”。范围价、附加费、人工参考和任何条件不一致规则继续单项显示；底层 7 条规则不合表、不插值，报价引擎语义不变。
- [x] 草稿态在一个编辑框内批量修改全部数量档金额与启停状态；数量档只读。保存由服务端从锚点重新推导完整组，要求客户端精确覆盖全部成员，对每行执行 `updatedAt` 乐观锁，并在单一事务内用 `Decimal` 更新、整组校验和写审计；任一档失败则全部回滚。
- [x] 列表、详情和编辑器只接收中文业务 DTO；规则 code、原始 JSON、来源范围、SHA 与内部 ID/时间戳不进入可见页面或表单字段。金额、折合单价和涨跌百分比均使用十进制计算，不经浮点数换算。
- [x] 最终门禁：**181 个测试文件 / 2427 项单测**、typecheck、全库 lint、Prisma validate、生产 build 与 `git diff --check` 全绿；375×667、1280×800 × 明暗 × 当前固定总价/草稿固定总价/草稿按个单价的 12 个确定性 viewport/overflow/axe 场景全绿。真实本地管理员页面另确认 157 克 7 档金额为 295 / 420 / 530 / 680 / 800 / 1400 / 2300，技术字段零泄露且控制台无报错。

## 2026-08-11 外部销售收费项目工作台

- [x] 管理员左侧“字典”新增高频入口“外部销售收费”，直达 `/owner/prices/external-sales/items`；旧 `/owner/prices` 明确改名“内部报价（低频）”。收费日常操作与版本发布拆为 `/items` 和 `/versions`，旧 query 路径只保留兼容跳转。
- [x] 收费项目列表改为服务端搜索、组合筛选和分页：加工费支持类目、产品、数量、规则类型、计价方式、自动/人工、启停和仅看修改；物流支持真实省份筛选，不再把地区误当产品。加工条件从服务端翻译为产品、工艺、纸张、规格和色数等业务摘要，不再错误显示成“通用收费项”。
- [x] 有草稿时桌面为列表 + 右侧编辑面板，手机为编辑器优先的单列流程；当前价、草稿价和变更数量同时可见。编辑面板在桌面限制为 `100dvh` 内可滚动，不再因 sticky 长表单把保存按钮粘到视口外。
- [x] 浏览器只接收业务编辑 DTO；规则代码、JSON、互斥组、优先级、Excel 范围和 SHA 不进入客户端属性或隐藏字段。服务端在写锁内保留这些技术条件，并在管理员改产品时同步稳定匹配条件，避免“页面能改、发布必失败”。
- [x] 计划生效、无生效版和已有草稿分别建模；页面不会再显示一个注定失败的“发起调价”。发布/放弃/改单继续使用草稿与规则 `updatedAt` 乐观锁，旧工单与当前发布版不被草稿修改。
- [x] 最终门禁：**180 个测试文件 / 2362 项单测**、typecheck、lint、Prisma validate、生产 build 与 `git diff --check` 全绿；干净 74 migration 隔离库的 375×667 与 1280×800 管理/销售明暗 viewport、touch、axe 矩阵各 4 / 4 全绿。真实浏览器另验证 121 条加工规则、广东物流筛选、组合筛选、草稿 `¥295 → ¥296` 保存、技术字段零客户端暴露和根页面零横向溢出。

## 2026-08-09 外部销售报价统一入口与可发布草稿

- [x] 2026-08-09 初版曾把加工费、物流和版本发布放在 `/owner/prices/external-sales?section=...` 同页；该管理入口已由 2026-08-11 的 `/items` 收费工作台与 `/versions` 发布中心取代。外部销售只读查询仍统一为 `/sales/quote?section=...`，旧 URL 只做兼容跳转。
- [x] 管理员可从 PROCESSING 或 LOGISTICS 当前版复制唯一草稿，搜索并单条编辑金额/区间/适用条件，按上海时间校验发布或放弃草稿。已发布/历史版只读，旧工单价格快照不回写。
- [x] 四类写操作共用独占事务锁和业务审计；规则与草稿 `updatedAt` 阻止多管理员陈旧覆盖/发布/删除。发布校验用途隔离、产品条件、金额精度与叠加上限、物流省份/首续重/耗材严格合同；运行时会忽略的字段不允许发布。
- [x] 管理端与销售端均不展示规则代码、JSON、Excel 范围或 SHA-256；这些证据只在数据库和服务端审计中保留。业务页面只显示中文收费项目、条件、金额、版本状态与调价原因；历史金额分项也不再输出规则/来源编号。
- [x] 最终门禁：**178 个测试文件 / 2325 项单测**、typecheck、lint、Prisma validate、生产 build、`git diff --check` 全绿；375×667 管理端 23 条路由与销售端 6 条路由的 viewport / axe / touch 门禁全绿。真实草稿编辑页另验证技术字段零可见、无横向溢出。

## 2026-08-08 外部销售快递与打包耗材收费

- [x] 新增独立 `LOGISTICS` 价目用途，与外部销售加工费 `PROCESSING` 价目按用途隔离。`长昆中通报价表(1).xlsx` 与 `纸箱价格表1(1).xlsx` 分别保留原文件 SHA-256、工作表和单元格范围；价目合并来源不改写两份原表证据。
- [x] 中通按每票运单独立起算首重，使用省份和承运商已进位计费重量核价；系统不从自由文本地址猜省份，不猜原始重量进位。同地址多包裹必须拆为多条 shipment，每票分别计首重。
- [x] 纸箱表的 1–500 / 501–1000 / 1001–2000 / 2001–3000 / 3001–5000 个对应 ¥1 / ¥3 / ¥5 / ¥7 / ¥8，但原表未定义计费粒度，因此只作每票分配数量的参考建议。超 5000 个或任何人工差异必须说明，禁止擅自外推。
- [x] 对客收费使用 `OrderCustomerCharge`，与工厂内部 `OrderCostEntry` 分账。工单创建时保存每票 `ESTIMATED` 快递/耗材及价目快照，管理员发货时按原冻结版本确认为 `FINAL`；未准备完整收费的外部销售单不得结案。
- [x] 顺丰到付只将对客快递费标记为 `WAIVED / ¥0`，打包耗材仍计入应收。历史外部销售单只回填零元结构行，不用现行规则追溯加价，不改旧账单。
- [x] 外部销售新建页只在 `EXTERNAL_SALES` 结算方向显示收费字段；工单详情与外部销售账单拆分加工费、快递费、打包耗材费，管理员账单另与内部成本对账。师傅数据查询不读取对客收费；外部销售只读物流价目入口为 `/sales/quote?section=logistics`，管理员物流收费入口为 `/owner/prices/external-sales/items?purpose=logistics`，发布入口为 `/owner/prices/external-sales/versions`。
- [x] 最终收口完成：新建、发货、详情、外部销售/管理员账单和价目页已进入真实窄屏溢出 + axe 门禁；fresh PostgreSQL 16 空库与含历史单的本地库均已完整应用第 **74** 项 migration；Prisma、typecheck、lint、全单测与生产 build 均通过。

## 2026-08-07 加工费计价与身份结算隔离

- [x] 工单创建时冻结 `Order.settlementType`：外部销售进入加工费应收，内部客服进入销售额/工资流水，管理员直接业务不冒充销售，免费重做不重复收费；账号后续改岗不会改变历史资金方向。
- [x] 对客报价按“产品数量阶梯/基础单价 + 命中的收费项”计算。收费项支持按个、按张向上取整、每万个和每款一次，并可按产品、工艺、规格、纸张、烫金颜色、单双面、单双色、数量区间与结算方向组合命中；多色可按实际烫金色数倍增，“无颜色”不参与倍增。
- [x] 产品最小起订量进入服务端报价事实；低于 MOQ 或 MOQ 配置无效时自动报价失败关闭，只有写明人工定价原因才允许特殊订单继续，不能静默套用错误单价。
- [x] 浏览器预览不是财务权威。新建工单在写入事务内重新报价，保存基础价来源、命中规则、分项与实际金额快照；人工差价或规则不完整必须说明原因，金额与数量在 schema、纯计算器和领域写入边界均做 Decimal 精度/上限校验。
- [x] 数量、规格、烫金色变更及新增款式在管理员批准修改申请时批量重报价；只改名称不触碰原价。管理员可先看只读的新旧金额/差额及逐款完整性预览，但批准时仍在写事务内按最新规则重算；规则不完整时必须由审核人写明原因后才可沿用原成交价，快照保留申请 ID、时间和实际金额。
- [x] 产品基础价、价格阶梯、收费项共同使用共享读/独占写 advisory transaction lock；一次报价只会看到一组连贯规则。时薪批次同样先读取一份不可变规则 bundle，再分员工结算。
- [x] `/owner/prices` 只管理对客加工费；`/owner/salary/rules` 管理客服、打包、清废、厨师等内部工资版本，开机师傅仍支持账号级机型计件覆盖。所有工资记录继续保存规则快照，规则变更不回写历史。
- [x] 历史工资不再依赖账号当前岗位：开机师傅按完工任务保存的工种、机型和计件金额快照补算；时薪员工按考勤发生时冻结的角色/工种身份补算。员工后续改岗、停用或删除登录资格都不会让已发生的任务/考勤从批次中消失；旧考勤身份无法被可靠证明时，迁移会列出记录并中止，禁止猜测工资归属。
- [x] 外协款式归属和合计数量由服务端在工单锁内验证/派生；供应商应付、金额更正与逐笔付款使用独立账本并禁止超付。因尚无供应商合同价口径，应付金额明确由管理员人工确认，不复用客户报价或员工工资规则。
- [x] 外部销售自助账单改为服务端最小投影，不查询/展示工厂计件、外协、重做、伙食、电费等内部成本；师傅列表、详情和日志同样在服务端裁掉客户金额、报价快照与审核备注；管理员财务视图仍保留完整对账信息。
- [x] `OrderItem.suggestedPrice` 保持历史“建议单价”语义，新增 `suggestedSubtotal` 保存当前系统建议小计；迁移只转换可由合法报价快照和金额一致性严格证明的过渡数据，歧义数据直接 fail-fast。
- [x] 新增前向 migrations `20260807180000_order_pricing_and_settlement` 至 `20260807184000_pricing_compatibility_fence`：计价/结算、外协付款、历史建议价、考勤身份快照与兼容性围栏均采用可恢复的 fail-fast；只有可证明安全的数据才自动修正。当前工作区共 **71 migrations**，本地库和一次性 PostgreSQL 16 空库均已完整应用 71 / 71；这不是生产数据库状态。
- [x] 本轮最终门禁：Prisma validate/status、typecheck、lint、生产 build、`git diff --check`、**156 个测试文件 / 2070 个单测**全绿；另在一次性空库完成 migration + seed + 管理员 Dashboard 真页面 E2E，延迟图表水合与渲染通过，临时库已销毁。

## 2026-08-07 外部销售版本化加工费价目簿

- [x] 使用 `长昆-线下报价表(3)(1).xlsx` 的 SHA-256 锁定来源版本，把烫金与彩印两张工作表导入独立的 `CustomerPriceBook / CustomerChargeCategory / CustomerPriceRule`；共 22 个报价产品、8 个可扩展收费类目和 111 条来源规则（75 BASE / 18 ADD_ON / 18 REFERENCE），另有 10 条只阻断漏收、不产生金额的安全围栏。新增类目不要求再改数据库结构。
- [x] 外部销售录单只读取 `EXTERNAL_SALES` 当前唯一生效价目簿，绝不回退到内部销售/工厂直客使用的旧 `Product.baseUnitPrice / PriceTier / PriceAdjustment`；没有生效价目簿、规则冲突或条件未覆盖时一律转人工报价。
- [x] 工作簿明确的现货单价可按个计算；专版烫金和彩印只在原表明确的数量锚点自动报价。纸张、双色、浮雕/激凸和单色彩印烫金等无歧义加价分项叠加；多色彩印烫金、三色以上专版、1000 个机仔烫金边界、包装替代口径、打样计费单位和缺失规格行全部失败关闭，不插值、不猜价。
- [x] 每个报价分项冻结价目簿版本、规则编码、收费类目、原工作表与单元格范围；管理员在 `/owner/prices/external-sales/versions` 从生效版复制草稿并发布，外部销售在 `/sales/quote` 查询，真实自动计价入口仍是 `/orders/new`。已发布版本不可原地编辑，历史工单快照不会因后续发布新价目簿而漂移。
- [x] migrations `20260807185000_external_sales_price_book` 与 `20260807185100_external_sales_quote_safety_guards` 已应用到本地库；当前共 **73 migrations**，并已在一次性 PostgreSQL 16 空库从头完整执行 73 / 73。实库核对为 1 份价目簿、8 类、22 产品、121 规则，版本警告列为 JSONB。真实计算已核对专版大号 1000 个 ¥325、157g 铜版大号 1000 个纯彩印 ¥295、同款单色烫金 ¥545，非锚点 1500 个、低数量彩印+烫金、专版缺色、现货加烫和未定价工艺均明确转人工。
- [x] 外部销售价目簿完成后的最终门禁：**161 个测试文件 / 2118 个单测**、typecheck、lint、Prisma validate/status、生产 build 与 `git diff --check` 全绿。

## 2026-08-07 工单列表、筛选与受控全量导出

- [x] 默认排序固定为 `createdAt DESC, id DESC`，新工单在前；分页、排序、总数和 37 类筛选全部由 PostgreSQL 执行，并始终与销售/客服/师傅/ADMIN 的数据范围做 `AND`。
- [x] 地址、款式/任务、外协筛选约束在同一条子记录上命中，避免不同地址或款式拼出假阳性；列表与导出复用同一解析和 `buildOrderWhere`。
- [x] 筛选 chip /“清除全部”的客户端导航以规范化 URL 重建原生表单，`defaultValue/defaultChecked` 不再残留；烫金色列表用 `\,` 表示颜色名内逗号、`\\` 表示反斜杠并兼容旧逗号列表；共享 WORKER scope 统一排除仍为 `SUBMITTED` 的排产草稿。
- [x] ADMIN 可导出全部或当前筛选命中的全部工单。XLSX 以 HEAVY worker 生成 11 个业务工作表，金额保持 Decimal 精度，不导出内部 ID、OSS URL/object key、工资规则快照或 raw JSON。
- [x] 导出仅发起人本人且当前仍为有效 ADMIN 可下载；文件 `0600`、24 小时过期。过期/失败终态只保留 scope，模糊 commit、过期竞态、文件删除重试和 FAILED 下载语义均有回归。
- [x] 新增第 8 个认证 cron `/api/cron/order-export-cleanup`；每批 100、单次最多 500 条并可下次续跑，orphan 经约 48 小时安全窗再回收。
- [x] 本地库与一次性空库均从头验证 **64 migrations**，并发索引 `indisvalid/indisready/indislive` 异常为 0；Prisma validate/status、typecheck、lint、生产 build、**139 文件 / 1845 单测**全绿。
- [x] 管理端完整视觉门禁为 6 视口 × ADMIN/SALES × 明暗，**24 / 24** 通过；每项包含横向溢出、裁切、触控目标与 axe。打印组件未改动；详情视觉 fixture 已补非零精确金额和工艺名称断言。

## 2026-08-07 工单详情款式卡语义修复

- [x] `getOrderDetail` 对全单工艺 ID 去重后一次查询中文名称，逐款式按原选择顺序返回 `craftNames`；保留原始 ID 供变更/重做逻辑使用，停用工艺仍显示历史名称，缺失工艺显示“已删除工艺”。
- [x] 款式卡不再显示裸 `数量 × 单价 = 小计`：数量使用千分位，单价固定四位，小计固定两位并带人民币符号；款式名改为 `h3`，属性值恢复正文层级。
- [x] “双面 / 双色”拆成“印刷面 / 印刷色数”；无任务显示“尚未排产”，已有任务但尚未选择师傅才显示“未派工”。
- [x] 数据层新增空工艺、跨款式去重、顺序、停用和缺失字典回归；视觉 fixture 使用非零精确金额并断言中文工艺、金额格式和内部 ID 不泄漏。真实草稿单浏览器确认无横向溢出。

## 2026-07-31 管理端履约与售后增强

- [x] `OrderShipment / OrderShipmentLine` 多地址模型、历史单地址回填、数量守恒校验、列表/详情/打印标识、每地址独立运单号。
- [x] 提交人、已派师傅、顺丰到付（自行预约）在管理端可见；顺丰到付可在 FINISHED/CANCELLED 前独立更正并留日志。新外部销售口径下仅快递费为 ¥0，打包耗材仍计对客应收，不得继续用“整票不计费”解释。
- [x] SHIPPED / FINISHED 原单可创建 `REWORK + NO_CHARGE` 关联工单；不回退原状态、不重复客户应收，生产与计件仍走正常链路。
- [x] 排产工艺行支持多选并批量应用共同兼容师傅，最终仍由原有单事务排产命令一次确认。
- [x] 三款工单启用 A4 紧凑样式；长自定义名称、三条长红色备注、多色烫金 fixture 经 Chromium 截图与单页 PDF 断言通过。
- [x] 本地 migration 已应用；typecheck、lint、Prisma validate、109 文件 / 1479 单测通过（最终 build/视觉全闸见本次交接）。

## 2026-07-31 工单变更、生产、薪资与财务闭环

- [x] 销售/客服在完工前申请修改款式名称、数量、规格和烫金颜色，或复制新增款式；管理员在 `/owner/order-changes` 审核，版本冲突和已开工数量变更有硬阻断。
- [x] 彩印+烫金支持“外协彩印 + 回厂烫金”混合排产，厂内阶段可选风车机或机仔师傅。
- [x] 待排产列表展示具体工艺、外协/回厂属性、款式数量、交期、师傅兼容数和阻断原因；先选师傅后可从最多 30 张工单批量分配其兼容工艺，混合机型分步派工并显示已排/待排进度，全部分配完成才向师傅开放。
- [x] 师傅任务按急单优先、工单创建日期升序排列；任务列表支持多选一键开工和按计划数量一键完工，详情展示设计图与接单人。
- [x] 风车机默认规则更新为 `≤1000: ¥20；>1000: 数量×¥0.01 + ¥10/款`，并支持账号级机型计件规则覆盖；日报按日期显示超底薪/底薪补足原因。
- [x] 客服提成改按工单销售额流水计算；账单保存每次结款明细，工单成本支持材料、物流、伙食、电费、外协、上板装板、其他与调整项，重做成本回归原账单毛利。
- [x] 全体正式员工账户记录用工类型；上班/请假支持 0.5 天，工资详情同步展示考勤摘要。
- [x] JWT 会话在服务端按用户主键实时校验账号存在、启用状态和当前角色；失效账号执行批量排产时显示重新登录入口，事务保持零写入。
- [x] 本地 migrations 已应用至 `20260731160000_order_changes_finance_and_attendance`；Prisma validate、typecheck、lint、生产 build、113 文件 / 1520 单测、3 项真实批量排产 E2E、24 项管理端 UI、12 项师傅端 UI、8 项打印视觉/PDF 闸全绿。

## 2026-07-31 多能力师傅与管理员最终派工

- [x] 开机师傅账号支持“主机型 + 多个可操作机型 + 多个熟练工艺”，历史兼容账号/工艺组合由 migration 自动回填为推荐项。
- [x] 单工单、跨工单批量排产和未开工任务改派统一分成“推荐”“可分配但需说明”“硬阻断”三层；非推荐原因进入工单操作日志。
- [x] 排产选择器支持按姓名/岗位/设备搜索，显示在制负载；工资按任务实际机型快照，个人计件规则可覆盖师傅登记的每一种设备能力。
- [x] 本地 migration 已应用至 `20260731210000_worker_capabilities_and_assignment_override`；最终测试、build 与浏览器验收结果见本次 HANDOFF。

## 2026-08-02 客服业绩、应收与周期口径收敛

- [x] 客服业绩以 `CsSalesEntry` 为可对账事件流水：工单提交记正数、管理员批准金额变更记差额、取消记负数；客户 `BillPayment` 只更新应收，不再增加业绩。
- [x] 新建在职客服账号自动建立工资周期；工单业绩发生日没有可用周期时整体回滚，防止静默漏记。
- [x] 周期结束日按上海自然日包含计算，次日才结算；提成按 `totalSales + initialSales` 定档。客服底薪可在周期内分次发，提成只在结算后发，每笔都追加 `CsPayrollPayment` 不可覆盖流水。
- [x] 重写客服金额 E2E：先验证提交 3000 元工单即记业绩，再验证两次 1500 元客户付款均不改变业绩。
- [x] 账单重算保留 `openingAmount` 与历史调整；付款、成本和工资发放按完整业务载荷幂等。自动计件/外协事实优先于旧手工成本，避免毛利重复扣减。
- [x] 财务 migration 链已延伸至 `20260802113000_hourly_payroll_reconciliation`；最终验证见下方“金额一致性审查”。

## 2026-08-02 金额一致性、可对账与重试语义审查

- [x] 时薪普通/底薪、加班、空闲打包分项先舍入到分，再从分项求总额；前向 migration 自动修正未发放旧记录，已发放不一致记录阻断并要求人工确认。
- [x] 客服周期新增“累计销售额 + 期初校准”联合上限；旧客服工单逐单流水未对平时，修改/取消整体回滚，避免无正向来源的负冲或差额。
- [x] 日薪重算遇“新毛薪 + 既有扣款 < 0”明确拒绝，不再静默截成 0；零底薪历史导入不再制造违反约束的 ¥0 发放流水。
- [x] 账单按工单提交时角色快照展示客服业绩，不随账号后续改岗漂移；跨周期提成明确标注为估算，历史期初收款明确标注时间未知。
- [x] 原单与重做单的自定义成本统一展示单号、数量、单价、录入人和时间；页面“本区已计入合计”与成本公式可逐项对账。
- [x] 外协创建端到端 UUID 幂等；报价可后补，金额确认/更正使用追加账本并保留旧值、原因、操作人和审计，避免重复外协单或漏记成本。
- [x] 日薪奖金、扣款和修正使用 UUID 请求键与完整载荷比对；网络重试返回同一结果，同键不同内容拒绝，`20260802103000_salary_adjustment_idempotency` 已为历史调整补齐唯一键。
- [x] 日薪、时薪、账单批次只吞已知业务错误；数据库/程序异常携部分进度重抛，让 durable worker 重试而不是错误标记成功。
- [x] 最终门禁：Prisma validate/generate、typecheck、lint、生产 build、**121 文件 / 1688 单测**、45 项 fresh DB migration 全绿；另用旧数据实测 migration 会阻断已发放时薪差异，并在人工确认后自动修正未发放差异。

## 2026-08-02 生产发布与真实环境验收

- [x] commit `aa42ba0` 已发布到 <https://bag.sshapi.cn>；生产库从 33 项升级到 **45 / 45 migrations**，尾部为 `20260802113000_hourly_payroll_reconciliation`，12 条待发布 migration 全部通过历史数据预检。
- [x] 迁移前在 Pigsty 主节点创建 full backup `20260802-193420F`，数据库约 50.1 MiB，连续 WAL 正常；当前实际只有 `repo1` 且 full retention 为 2 份，**尚未达到“两 repo + 30 天”目标**。
- [x] PM2 Web、LIGHT worker、HEAVY worker 三进程上线并持久化；`/api/health/ready` 返回 200、DB `ok`、库存差异 0、无 warning。公网实测 login TTFB 约 0.15 秒、ready TTFB 约 0.41 秒。
- [x] 生产 `/usr/bin/chromium` 实际生成 37,646 字节中文测试 PDF，服务器可识别 15 个中文字体族；管理员登录态下 Dashboard 与工艺列表可见。
- [x] 生产机为 1.6 GiB RAM + 4 GiB swap；Next TypeScript 构建因换页耗时约 10.9 分钟，运行期正常但发布资源余量偏低。

## 下一步

**当前批次已完成（2026-08-24）**：

0. [x] 设计证据、问题严重度/成本和独立任务已分别落到 `docs/UI-DESIGN-COVERAGE.md` 与 `docs/UI-REMEDIATION-BACKLOG.md`。根错误恢复、共享五态、L2/L3 确认、工单列表安全子集/字段差异、CDR 重生、通知 UNKNOWN 决策和产品引用影响已完成。具体开放边界以整改台账为准。

**下一批可独立执行（仍需守住业务决策边界）**：

1. `UI-F10`：工艺、账号等主数据的真实引用查询和停用策略，需先确认未完成任务/历史引用的处理口径。
2. `UI-F06/F07/F12–F14`：按页面族迁移剩余写表单、长任务回执、loading 和断网恢复。
3. `UI-Q01`：在固定 fixture/字体/浏览器后，由业主确认管理端和师傅端第一版设计像素基线；本批候选截图不自动升格为 expected。

**已完成（2026-08-23）**：

- [x] **根路由失效会话 500 已修复**：签名 JWT 通过 Edge proxy、但数据库账号已删除或停用时，`/` 现由 `getSession()` 验证后跳转 `/login`，不再抛 `UnauthorizedError` 500 或连带触发 React Script 警告。四角色分流、失效会话和真实异常透传测试已补；提交 `cbc88ca`，Prisma validate、typecheck、lint、236 文件 / 2988 单测、Next build 与浏览器复验全绿。

0a. [x] **Codex 结构复审已收口**：复审表已填完，B1–B6 和 S1–S7 中当前仍成立的部分已按规定修法落地并拆成小提交。未采用的旧修法 / 过度推论见 `docs/archive/代码质量审查-2026-08-23.md`；`RETRYING` 仍不会在 job DEAD 时被改成 `FAILED`。本次 Prisma validate、typecheck、lint、235 文件 / 2982 单测、覆盖率门禁和 Next 生产 build 均通过；仅有当前 Node 22 低于仓库声明 Node 24 的 engine 警告。

**然后（2026-08-21 对抗审查批次收尾，仍不需要拍板）**：

0b. 结构收口的程序化门禁已补齐；整批发布候选仍需跑 `pnpm test:admin-ui` / `pnpm test:worker-ui`，把 `docs/上线前置操作清单.md` §一的两段只读 SQL 交业主跑，并按同文档 §五做四项人工验收。查询 1 的存量缺口补完之前**不要**上外协闸口那一步。

以下全部**需业主拍板**后才能推进：

1. **发布候选部署评审**：本次发布候选已提交固化；部署仍需业主单独授权，并执行生产备份、历史数据预检、migration 与恢复门禁。发布前另需过一遍 `docs/上线前置操作清单.md`。
2. ~~**发布源连续性**~~ —— **2026-08-22 已完成**：仓库配置了私有 remote
   `https://github.com/zora4523-bot/print-shop-erp.git`；发布分支经 PR #2 快进合入 `main`
   （`245be5c → dd648c0`）。生产的 `aa42ba0` 已是 `main` 的祖先，可从 `main` 重建。
   （开发机 SSH 被本地网络劫持，remote 用 HTTPS，见 `docs/部署指南.md` §3。）
3. **生产运维收尾**：补 Pigsty 异地 `repo2`、30 天保留和恢复演练；配置 `SENTRY_DSN / APP_VERSION`；把应用机升级到至少 4 GiB RAM；完成真实 OSS 图片 PDF、企业微信和 cron 入队的人工验收。
4. **企微通知剩余项**：A07 按客服/师傅的个人路由（P2，需确认是否有私有 webhook）；共享 Webhook 的跨事件/跨进程全局节流已完成，但仍需先在生产应用 `20260902121100_notification_webhook_global_throttle` migration，再做真实群 + durable LIGHT worker 人工验收。
5. **A20 生产单拆分**（P1）— 需确认生产单粒度与发料时机
6. **A21 供应商自动定价**（P1）— 独立应付、金额更正、逐笔付款和防超付已完成；如需自动算供应商价，须先提供“供应商 × 工艺 × 数量/单位 × 有效期”的合同口径，禁止套用对客报价表
6b. **OSS 直传重放加固**（2026-08-21 暂缓）— 「临时 key + 服务端 copy」。前置动作全在阿里云控制台且**顺序不能反**（RAM 前缀权限 + `upload-tmp/` 生命周期规则必须先于代码上线），清单见 `docs/上线前置操作清单.md` §六
6c. **盘点 ledger scan（fix#3b）**（2026-08-21 拆出）— 逐行 `snapshotAt` + `MaterialTransaction` 复合索引 + 账本扫描，只解决「净额为零的往返」。需 1 个 additive migration，**单独设计评审**
7. **架构报告 A1–A6**：按危害顺序处理需业主确认的行为缺口。
8. **客服跨期冲销政策**：需确认已结算/已发提成后的撤单或降价，是下周期扣回、生成历史工资调整，还是不追溯；也要覆盖客服已停用/改岗的情形。

## 待澄清的业务问题

- A07/A20 剩余 Needs，以及 A21 供应商合同自动定价输入（见 `docs/AGENT-BACKLOG.md`）
- **ProductCategory 中文标签**：业主过一眼 `/owner/product-categories` 与 SPEC 附录 C 对一遍
- **CDR 预览方案**：等真实上传流跑起来再定
- **STOCK_ALERT 补充语义**（可选）：当前为跨越检测（跌破那次告警、低位不重复）；若需"低位周期重复提醒"或"上调安全库存立即提醒"再加 cron 扫描端点
- **跨客服周期冲销**：当前安全地拒绝无可用周期或旧单流水未对平的修改/取消，但“已结算且已发提成如何追溯”必须由业主选择，不能由代码猜测。
- **薪资「当天 / 当月」重算**（2026-08-21）：现已拒绝严格未来的 `date` / `month`，但当天日薪会给未报工师傅写出只有 `dailyBase` 的正式行、月中月结会让 COOK 立刻发满整月 `COOK_MONTHLY`。选项 A（现状）/ B（月结只允许已结束的月份，方案作者推荐）/ C（连当天也拒）。详见 HANDOFF「卡住的问题」与 DECISIONS 2026-08-21。
- **交期预警口径**（2026-08-21）：草稿单 `DRAFT` 是否继续进 `PROMISE_ALERT_STATUSES`（同时决定工单详情页 `PromisedDateBadge` 显不显示「已逾期」）；逾期超过多少天后停止预警/推送（要设就加 `Setting`，建议 key `order_overdue_alert_max_days`，不硬编码）。
- **师傅端「我的工单」**（2026-08-21）：是否接受不再急单置顶（待办队列仍在 `/worker/tasks`，那里保持急单分组）；每页 20 条（`WORKER_ORDER_PAGE_SIZE`）对手机端是否合适。
- **登录限流配套**（2026-08-21）：厂区 NAT 出口 IP 是否加 `geo` 白名单；429 是否配 `error_page` 友好提示；应用层账号级失败锁定是否另立项（现状完全没有）。
- **6 处冗余 `router.refresh()`**（2026-08-21）：已确认「`revalidatePath` 不刷 client RSC 缓存」是错误认知，选 A（清代码+订正注释）/ B（只订正注释，本次做法）/ C（照抄 refresh）。
- **盘点「部分过账」语义**（2026-08-21）：一次提交现在可能只过账一部分行，`InventoryCount` 单据上只有被接受的那些，冲突行原样退回要求重数（原设计是一行冲突整单驳回）。风险评估为低，但要业主点头。
- **超报确认的操作成本**（2026-08-21）：师傅超报要多一次提交往返（零 JS 下是整页 POST + 重渲染），弱网车间会感知到延迟。这是拍板方案的固有成本，上线前跟业主对一次预期。
- **首页 24h 推送失败告警条的计数语义**（2026-08-21）：瞬时抖动不再点红，重试成功会把历史 `FAILED` 行就地翻成 `SUCCESS`。上线前告知业主，别让人以为数据丢了。

## 已知技术债

- 生产 PDF 以 PM2 注入的系统 `/usr/bin/chromium` 为唯一口径；当前 `deploy-smoke` 尚未自动继承该路径和 root `--no-sandbox` 参数，运行时需显式传入，后续应让 smoke/update 脚本与真实渲染配置共用一套 preflight。
- PDF 产物目录是单机 PM2 共享目录；未来多机部署需迁往对象存储。
- 通知事件在业务事务 commit 后入队；已持久化且调用方 await，但严格 transactional outbox 仍可作未来增强。
- BackgroundJob 账本暂无自动保留清理策略；待生产增长率可观测后确定清理窗口。
- 外协供应商目前只有独立应付账本，没有可自动计算的合同价字典；增加自动定价前必须先确定供应商、工艺、计量单位、数量阶梯、最低收费和有效期，不能复用客户售价规则。
- `pg_pinyin` / `pg_ivm` / `pg_partman` 等在非 Pigsty 本地库降级为普通列/视图/缺席，生产安装按 `docs/pigsty-production-activation-runbook.md`
- **三处无界查询仍在 backlog**（都是 `findMany` 无 `take`，行数随时间线性增长）：`lib/salary/daily.ts:593 listDailyWorkerSalaries`（`/owner/salary/daily`，不筛就是全表）、`lib/salary/hourly-aggregate.ts:549 listHourlyPayrolls`（`/owner/salary/hourly`，同上）、`lib/worker-portal.ts:222 listWorkerSalaries`（师傅端 H5，`@@unique([workerId, date])` → 三年约 900 行，一次渲染 900 张卡片并逐张做 Decimal 运算）。`listWorkerSalaries` **不能照抄 `listWorkerOrders` 的分页补丁**：`app/(worker)/worker/salary/page.tsx` 的 `salaryTotals()` 从整个数组 reduce 出「累计工资 / 尚未发放」，直接分页会把这两个金额静默变成「本页合计」——给师傅看错工资总额比慢更糟。正确修法是行分页 + 用 `db.dailyWorkerSalary.aggregate` 单独算 total/unpaid。（`listWorkerHourlyPayrolls` 已核实**不需要**分页：每人每月最多一行，十年 120 行，结构有界。）
- **`NotificationLog` 若加保留期/清理任务，必须排除「所属 `BackgroundJob` 仍在 `PENDING`/`RUNNING`」的行**——`deliveryKey` 行是幂等凭证，删早了会让重试对已收到消息的群重复推送。
- **OSS 直传的 15 分钟重放窗口仍开着**（2026-08-21 业主决定本批不做「临时 key + 服务端 copy」）：窗口内浏览器仍可覆写自己刚登记的对象。这是**已知接受的风险**，不是已修复；实施前置与两个必踩陷阱见 `DECISIONS.md` 2026-08-21 与 `docs/上线前置操作清单.md` §六。
- **盘点 CAS 的残留缺口**：净额为零的往返（先出 20 再进 20，余额回到原值）检测不到。堵口需要逐行 `snapshotAt` + `MaterialTransaction` 复合索引 + ledger scan，已拆出单独设计评审。**别顺手改回时间戳基线**。
- `databaseNow()` 与 background-jobs 里所有 `now()` 都必须在**主库**执行；目前 `lib/db.ts` 只有单一 `DATABASE_URL`，将来若把只读查询路由到 Pigsty 只读副本，`getBackgroundJobHealth` 这条纯读路径要重新审。
- `OrderForm` 的逐字段错误挂了 `role="alert"`，与 `29334e0` 就 `EditOrderForm` 拍板的「逐字段错误不给 `role="alert"`」相冲突（`OrderForm` 是 RHF `mode: 'onBlur'`，每次失焦重算都会重新播报）。属独立一致性问题，未混进 2026-08-21 批次。
- `/api/health/jobs` 已就绪但**尚未接进任何外部监控**；在有东西按分钟去拉它之前，SLO 表里的死信 30 分钟响应目标不生效。

## 2026-08-28 销售报价 / 询价入口退役

- [x] 销售和客服菜单已移除独立报价 / 询价入口；旧销售查价页与物流跳转页已废止，旧深链不再兼容跳转。
- [x] 历史进度中对销售只读查价入口的描述仅供追溯，已被 2026-08-28 决策废止。当前流程是直接建单；配置中心与工单 UI 仍保留。
