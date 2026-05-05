# 会话交接

> **每次新对话开始前，先读这份文件。** 它记录了上次会话停在哪、下次该接着做什么。
>
> 本文件每次 session 结束前**整体重写**（除"历史"小节是追加式时间线）。

---

## 当前任务

**P0 #1–#6 全部完成 clean** + 上线前运维补齐 + 本地真实跑起来发现的 4 个 prod-only bug 全修 + Playwright E2E + 视觉回归 + SHIP/FINISH 状态机端到端打通。整体&ldquo;能上线&rdquo;级别。下一阶段（P1）待业主拍板优先级。

## 本次 session 主要产出

跨度大，按层归类。

### A. 本地启动暴露的 4 个 prod-only bug（mock 单测全漏）
1. `pg_advisory_xact_lock` 返 void → Prisma 7 `$queryRaw` 反序列化炸；16 个 callsite + 5 narrow tx 类型 + 7 测试 mock 一律切到 `$executeRaw`。commit `5481d58`。
2. `react-dom/server` 静态 import → Next 16 build guard 拒；改动态 import + buildPrintHtml 改 async；commit `dae18ba`。
3. `qrcode.react` 跨 React 实例 hooks 炸 → 改服务端 `qrcode.toString` 预渲染 SVG 字符串，layout 用 `dangerouslySetInnerHTML`；删 `qrcode.react` 依赖；commit `7847415`。
4. Puppeteer Chrome 没装（pnpm 默认跳过 postinstall）；`npx puppeteer browsers install chrome` + README §🚢 §6 写明 + hint regex 加 Chrome 支持 + 同时覆盖&ldquo;没装&rdquo;和&ldquo;路径错配&rdquo;两种原因；commits `9489696` / `f218cca`。

### B. E2E + 视觉回归（waves 1–5）
- 12 Playwright 测试 / ~12s 总时长。803 单测仍全绿。
- **Wave 1**（auth + order create）3 commits。`tests/e2e/auth.spec.ts`（3 测）+ `order-create.spec.ts`（1 测）。`@next/env` 加载 `.env*`；E2E_PASSWORD 必填守 guard；bad-password 断言 `role=alert`。
- **Wave 2**（production flow）SALES create → submit → FOREMAN schedule → WORKER report → cascade COMPLETED → SHIP → FINISHED 整链 1 个测试。
- **Wave 3**（bill flow）OWNER 生成 → 发单 → 录入全款 → FULLY_PAID。
- **Wave 4**（CS 业绩累加）payment 后 SalaryPeriod.totalSales 真 increment。**关键**：拆 1500+1500 两笔，否则 delta vs cumulative 回归测不出来（Codex round 85）。
- **Wave 5**（视觉回归）OrderPrintLayout 6 个 design-grid bucket（1/2/3/5/8/10）。**架构关键**：locator-scoped screenshot（`.print-container`）+ button mask `Open Next.js Dev Tools` 双层防御 ——`page` 全屏会卷 dev toolbar，element 范围又会因 fixed-position 在高 bucket 滚动时 bleed in（rounds 90→93 迭代）。
- **测试基础设施**：`tests/e2e/global-setup.ts`（4 个 e2e- 用户 idempotent upsert）；`tests/e2e/_helpers.ts` 一组 helpers（login / logout / seedFinishedOrder / resetBillsForUser / seedActiveCsPeriod / seedPrintableOrder / midShanghaiMonth）。**`resetBillsForUser` 的 e2e- 用户 guard** 是反复迭代后的最终设计（rounds 79→80→82→83）：拒绝非 e2e- 用户 + 全 wipe + Order 仅清 status=FINISHED（不冲掉 production-flow 的 COMPLETED）。

### C. SHIP / FINISH 状态机收尾（feat）
- COMPLETED → SHIPPED → FINISHED 之前只在状态机声明，没 UI/action。本 session 补全：`shipOrder` / `finishOrder` lib + 2 actions + `ShipOrderForm` + `FinishOrderButton` + 工单详情页 conditional 渲染 + 9 单测 + 扩 production-flow E2E。
- 顺手把所有 Order.status 写入路径（submit/cancel/ship/finish/scheduleOrder/worker cascade/createOutsourceOrder）统一在同一把 advisory lock `print-shop-erp:order-cascade:<id>`（rounds 87→88，2 轮迭代才覆盖完整）。
- 加 `canAttachOutsource()` helper：SHIPPED/FINISHED/CANCELLED 状态拒绝新建外协（lib + UI 双闸）。

### D. Admin shell scaffolding（feat）
- 用户在 session 中并行做的——committed shadcn UI 组件（avatar/breadcrumb/sidebar/...）+ `lib/auth/permissions-dict.ts`（拆 PERMISSIONS 字典出 next-auth）+ `lib/navigation/admin-menu.ts`（按角色提供 menu 配置）+ `(admin)`/`(worker)`/`(auth)` 路由组。
- Claude 这边补 `components/business/admin/AppSidebar.tsx` + `AdminBreadcrumb.tsx`：三个 P2 修迭代到 round 81 收敛——嵌套 `<li>` / breadcrumb 404 / sidebar multi-active / `<BreadcrumbPage>` 的 aria-current 副作用。
- `hooks/use-mobile.ts` 重写成 `useSyncExternalStore`，避 `react-hooks/set-state-in-effect` lint 规则。

### E. Codex review 总览
本 session 跑了 rounds 70–94，共约 25 轮 review，最终全部 clean。意外学到的事：
- 我 `git add -A` 把 user 并行 commit 留下的 untracked 文件卷进了我的 commit，回滚才看清。规则已存 memory：**`git ls-files --others --exclude-standard` 看一眼再删/staging**。
- 多次出现"修法过犹不及"模式：90 隐藏整个 portal → 91 揭示连错误 overlay 一起吞了；82 wipe 全部 order → 83 揭示 cross-spec 干扰。每次正确答案是更精准的 scope，不是把锁、mask、wipe 范围拧得更宽。

- **Slice A 排产**（rounds 37 / 38）
  - `lib/production.ts scheduleOrder`：tx 内批量 createMany + 状态机转换 + OrderLog。按 Craft.isOutsource 拆两条路径，每个 item × non-outsource craft 对要求唯一 assignment。
  - `TaskStatus` 状态机 `lib/production/status-machine.ts`（PENDING→IN_PROGRESS→COMPLETED，任何非终态可 CANCELLED）
  - `print-shop-erp:schedule:order:<id>` advisory lock 防双击
  - 活动工艺 gate（round 37 P1）
  - `/foreman/scheduling` list + detail 派工表单
- **Slice D 薪资算法纯函数**（一次过）
  - `lib/salary/machine-piecework.ts`：`calcMachinePieceworkBreakdown` / `calcMachinePiecework` / `calcMachineDailySalary`
  - 与 SPEC §7.1 / §7.2 行对行完全一致（HAND_PRESS 张三、WINDMILL 李四全部示例）
  - 风车机忽略双面、黏封机无小单保护、`DOUBLE_SIDED × DOUBLE_COLOR = ×4` 等边界全覆盖
- **Slice B 师傅报工**（rounds 39 / 40）
  - `beginTask` + `reportTask` + Order-status 双向级联
  - 三把 advisory lock namespace（schedule / task / order-cascade）各管一个不变量
  - **cascade 锁后 fresh-read Order.status**（round 39 关键修复）
  - 计件口径 `totalPressed = completedQty + defectQty + reworkQty`（DECISIONS）
  - `/worker/tasks` H5（phone-first layout，inputMode=numeric，autoFocus on 合格数）
- **Slice C 外协单**（rounds 41 / 42）
  - 独立 CRUD，不阻塞 Order 级联（DECISIONS）
  - `SENT → IN_PROGRESS → RECEIVED`，SENT → RECEIVED 短路合法
  - **严格 YYYY-MM-DD 解析**（round 41，拒绝 `2024-02-31` 滚动）
  - `/foreman/outsource` 列表 + new?orderId + detail + Actions 组件
  - 工单详情页 foreman 可见"外协"入口

## 下一步具体指令（给下次 AI）

**P0 + 上线前运维 + prod-only bug 全修 + E2E + 视觉 + SHIP/FINISH 已交付**。下一步：

1. **业主拍板 P1 优先级**。候选：
   - **老板 Dashboard**（SPEC §6）—— 业主每天首屏，验收标准之一&ldquo;一眼看到今日工单 / 产量 / 待发货&rdquo;。今天没做。
   - **企业微信推送**（SPEC §3.10）—— `lib/notification/` 是空壳；急单 3 秒推送是验收标准。10 个事件类型已 enum 占位。
   - **E-full 工单款式级编辑**（P0 #3 当时延期）—— 业主反馈优先级低但 SPEC 写过。
   - **报表**（SPEC §6 完整版）—— 先 Dashboard 顶替，看业主用一段时间反馈再做。
   - **Docker 化**（CLAUDE.md 说 MVP 稳定 2-3 月后做）—— 现在还早。
2. **Admin shell wire 进 layout**：`AppSidebar` + `AdminBreadcrumb` scaffolding 已就绪但未 wire。补一个 `app/(admin)/layout.tsx` 引入两件套是下一步小工作（半天）。
3. **运维剩下的纯 ops 动作**：填 `.env` 真值；cron 切 pg_cron；pgbackrest 启用。
4. **已知未拍板的业务空白**（HANDOFF&ldquo;卡住的问题&rdquo;里）：CS 提成累加触发链 vs 退单语义；考勤录入 UI 形态；历史业绩导入。

**E2E 现状**：13 个 Playwright 测试，覆盖核心 5 条状态机链 + 4 个钱相关路径。每个真实 advisory lock / cascade / 状态机 transition 都被真 PG 跑过一次。Mock 单测漏抓的 4 个 prod-only bug 各有专测守护。

**Codex review 闸口**：本 session 跑了 ~25 轮，最终全部 clean。803 单测 / lint / typecheck / 13 Playwright 全绿。

## 卡住的问题

- **考勤数据源** — SPEC §3.9 说"车间主管每日录入时薪工上下班时间"——UI 是每日一次批量录入？还是每次打卡一次？业主确认前，先假设"车间主管每天下班前在一个表里录 N 行"，做简单表单即可。
- **CS 提成触发链**——业绩累加应该发生在"账单 mark-paid"时还是"工单 FINISHED"时？SPEC §3.7 文字上说"每次该客服提交工单 → period.totalSales += 工单金额"但这样退单/折扣就难处理。等 P0 #6 账单设计时决定，现在只做 `accumulateSales` 接口。
- **历史业绩导入 UI 形态**——页面 vs seed？业主给几个客服导入就足够了，做成 `/owner/salary/cs/import` 的 CSV 上传或 seed 文件都行。Slice B 做时再选。

## 相关文件清单（下次 AI 必读）

- SPEC-v1.2.md §5.1-5.5（三条铁律 + 三套算法）、§7.1-7.4（示例表对应测试用例）
- `prisma/seed.ts` 第 182-310 行（SalaryRule 初始值，直接复用）
- 已建范式：
  - `lib/salary/machine-piecework.ts` — 纯函数 + Decimal 数学 + SPEC 行对行测试
  - `lib/salary/rules.ts getActiveMachineRule` — 规则查找（半开区间 `effectiveFrom <= now && (effectiveTo IS NULL || effectiveTo > now)`）
  - `lib/production.ts reportTask` — snapshot pattern，已经在 Task 层做了，P0 #5 读 snapshot 不回查
  - `lib/order.ts` 和 `lib/production.ts` 的 tx + advisory lock 模式
- CLAUDE.md §4.4（薪资快照化铁律）、§4.5（状态机铁律）、§4.7（金额全 Decimal）

## 约束提醒（本次任务特有）

- **薪资快照化（CLAUDE.md §4.4）**：P0 #5 每生成一条 `DailyWorkerSalary` / `CustomerServiceCommission` / `HourlyWorkerPayroll` 都必须同步把当时的规则 ruleValue 完整写入 `salaryRuleSnapshot` 字段（每个表都有）。改 SalaryRule 只影响新记录。
- **计件时金额口径已定 (DECISIONS 2026-04-23)**：`totalPressed = completedQty + defectQty + reworkQty`。P0 #5 的日薪汇总直接 sum `ProductionTask.pieceworkAmount`，不重算——快照保证数据一致。
- **状态机铁律**：`SalaryPeriod.status IN_PROGRESS → SETTLED` 必须走状态机函数，禁止裸写。参考 `lib/outsource/status-machine.ts` 的最小实现。
- **Decimal(12,2) / Decimal(10,2) 精度**：`DailyWorkerSalary.actualSalary` 是 10,2；`CustomerServiceCommission.amount` 是 12,2（可能几十万）；都用 `decimal.js` 算再 `.toFixed(2)` 写库。
- **幂等性**：日薪汇总的 unique 约束是 `@@unique([workerId, date])`；上次汇总出错或师傅补报某天的任务都需要能 rerun。用 upsert 而非 create-then-throw。
- **Cron 从 pg_cron 触发 or Next.js endpoint**：Pigsty 的 `pg_cron` 已启用（DECISIONS 2026-04-22），薪资结算是纯 DB 工作可以放 pg_cron；但 Next.js 的 Route Handler + `Authorization` 头部保护也能做，业主拍板前做成后者（env 里一个 `CRON_SECRET`），上线前切 pg_cron。

## 上次会话结束时间

2026-04-26

---

## 历史（追加式时间线）

- 2026-04-22：建立了项目记忆管理体系（PROGRESS / DECISIONS / HANDOFF + CLAUDE.md §13）。
- 2026-04-22 → 2026-04-23：完成 P0 #1 认证与用户管理全部切片（seed 硬化 + 认证基础 + 登录 + 自服务改密 + 老板管账号 CRUD）。16 个 feature/fix commits + 1 docs commit，149 单测，Codex 走了 15 轮 review。
- 2026-04-23：完成 P0 #2 工艺字典 + 产品字典。10 个 feature/fix commits，+100 单测（累计 249），Codex 9 轮 review。Round 24 统一修了三份字典的 "编辑页双 isActive 控件" 和 "create 后停留 /new" 两个通病。
- 2026-04-23：完成 P0 #3 工单核心（E-lean）。21 commits，+151 单测（累计 400），Codex rounds 25–36 共 9 轮。E-full（款式级编辑）延期到 P1。OSS 直传脚手架、打印 + PDF 双通道、工单编辑 + 急单 + OrderLog diff 全部落地。
- 2026-04-23：完成 P0 #4 生产流程。9 commits，+107 单测（累计 507），Codex rounds 37–42 共 6 轮。排产 + 师傅报工 + 薪资算法纯函数 + 外协单全部落地。级联的并发正确性一来就被 round 39 打中，cascade 锁内 fresh-read 补上；严格 `YYYY-MM-DD` 日期解析避免 JS Date 的滚动坑。
- 2026-04-24：完成 P0 #5 薪资系统 4/5 切片。15 commits，+119 单测（累计 626），Codex rounds 43–47 共 5 轮。师傅日薪 + 客服周期 / 提成 + 老板总览页 + 时薪工纯函数全部落地。时薪工的 DB / UI / cron 留到下一 session。关键修复：已发放行拒绝重算（round 43 / P0）；CS accumulate-vs-settle race 最后切到 per-CS-user advisory lock（round 46 / P0）；完整 `salaryRuleSnapshot` on CustomerServiceCommission（round 45 / P1 + migration）。
- 2026-04-24：完成 P0 #5 Slice C（时薪工 + 考勤）。12 commits，+90 单测（累计 716），Codex rounds 48–51 共 4 轮。核心修复：hourly payroll 的 paid-row race → per-(worker, month) advisory lock + tx（round 48 P0）；batch now 贯穿所有 rule getters 防版本漂移（round 48 P1）；**三条 cron 路径统一 COUNTS ONLY 响应**，不返回 settled / errors 避免 pg_cron 日志泄漏薪资（rounds 49-50 P2）；daily batch 改 per-worker try/catch（round 50 P2）；recompute action 补 errors[] 给 owner UI，不然偷摸跳过失败 worker（round 51 P1）。
- 2026-04-25：完成 P0 #6 Slice A 应收账单后端。4 commits，+56 单测（累计 772），Codex rounds 52–54 共 3 轮。状态机 DRAFT → ISSUED → {PARTIAL_PAID | FULLY_PAID}；核心修复 2 个 P1：generateBillsForPeriod read-diff-write race → per-(salesUser, period) advisory lock + `@@unique([billId, orderId])` DB last-line guard（migration 加 pre-dedupe DELETE）；mark-paid 调 accumulateCsSales 独立开事务 → 改成 tx 贯穿，bill write + CS 累计 atomic。Bill FULLY_PAID 为终态（退款新开负数账单，不回退状态）。
- 2026-04-25：闭合 P0 #5 遗留 daily-salary race（commit `50956ee`）。和 hourly round 48 同构的 paid-row race —— compute 的 findUnique(isPaid) 和 upsert 之间被 markDailySalaryPaid 翻转，update 分支静默覆盖金额。修法镜像 hourly：per-(worker,date) advisory lock + tx（compute 和 mark-paid 共用同一把锁，rule 读留在 tx 外）。+4 单测（累计 776）。
- 2026-04-25：完成 P0 #6 Slice B 老板账单 UI + Slices C/D 销售 UI + cron。8 个 commits（5 + 3），0 新单测（纯 Server Component UI），Codex rounds 55–63 共 9 轮。Slice B 1 个 P2 真 bug（period 月份范围）+ 4 轮文案精度迭代；Slice C/D 2 个 P2/P3 真 bug（cron malformed period 静默 fallback、sales layout OWNER 转发丢 leaf id）+ 1 轮 layout-pathname 限制讨论（最终决定不在 layout 做 OWNER 转发，留给 middleware）。**至此 P0 #1-#6 全部 clean，776 测试全绿**。
- 2026-04-25：上线前运维补齐（业主选项 A）。1 个初始 commit（`fe3c668`）+ 5 轮 Codex 进步式 privacy 收紧（rounds 64–68，最终 round 69 clean）。`.env.example` 加 CRON_SECRET / SENTRY_DSN / APP_VERSION + 影响说明；instrumentation.ts 真实 Sentry init（DSN-gated graceful no-op）；README 加&ldquo;上线运维&rdquo;章节（env 表格 + cron pg_cron 切换 + pgbackrest + Sentry + OSS RAM + 10 步 smoke checklist）。**Sentry 隐私收紧关键路径**：Codex 5 轮进步式发现 `captureRequestError` 默认捕获 (1) headers 含 Authorization / Cookie，(2) URL query 含 reset token，(3) transaction event vs exception event 双路径，(4) span.data + span.description，(5) `contexts.nextjs.request_path`，(6) OTel 新旧 method 键名 + Prisma 的 `?` 在 SQL 不能被 URL trim 误伤。最终方案：`scrubEvent()` 同时挂 `beforeSend` + `beforeSendTransaction`，URL 一律 strip query → pathname；span data 走 SAFE_SPAN_DATA_KEYS allowlist；HTTP-op 才 trim description。776 测试不变，无新代码逻辑。
- 2026-04-25 → 2026-04-26：本地真跑暴露 4 个 prod-only bug（mock 单测全漏）。commits `5481d58`（advisory lock $queryRaw → $executeRaw，16 callsite）/ `dae18ba`（PDF react-dom/server 动态 import）/ `7847415`（QR pre-render，删 qrcode.react）/ `f218cca`（Puppeteer install hint 双因素）。Codex rounds 70–72。
- 2026-04-26：Playwright E2E + 视觉回归落地，5 个 wave，9 个 test 文件，13 个 Playwright 测试 / ~12s。Wave 1（auth + order create）→ Wave 2（production flow 含 SHIP/FINISH 全链）→ Wave 3（bill flow）→ Wave 4（CS accumulate，1500+1500 拆笔抓 delta vs cumulative）→ Wave 5（视觉，6 design-grid bucket，element-scope screenshot）。Codex rounds 73–94 共 ~25 轮 review，主要修法包括：`@next/env` 加载 .env\*；e2e- 用户 guard + 全 wipe + status=FINISHED 范围；视觉测试逐步收敛 element-scope + button-mask 双层防御。**Mock 单测漏抓的 4 个 bug 至此每条都有 E2E 守护**。
- 2026-04-26：SHIP / FINISH 状态机收尾。commits `7bbfa0a` (feat) / `c6c42be`（round 87 race lock + outsource gate）/ `60c5f28`（round 88 schedule lock 统一）。**所有 Order.status 写入路径**（submit/cancel/ship/finish/scheduleOrder/worker cascade/createOutsourceOrder）现在共享同一把 advisory lock `print-shop-erp:order-cascade:<id>`。SHIP 接受可选 trackingNo（whitespace 边界 case 已 cover）；FINISH 是终态。canAttachOutsource() 显式拒绝 SHIPPED/FINISHED/CANCELLED 状态新建外协。+10 单测（含 7 SHIP/FINISH + 3 outsource scope）。
- 2026-04-26：Admin shell scaffolding（user 并行 commit + Claude 补 P2 修复）。AppSidebar / AdminBreadcrumb 双组件，3 P2（嵌套 `<li>` / breadcrumb 404 / sidebar multi-active）+ 1 P3（layout-only crumb 误报 aria-current）4 轮收敛 round 81。`hooks/use-mobile.ts` 重写 `useSyncExternalStore` 避 React 19 lint 规则。组件还没 wire 进任何 layout，类型正确即可。
- 2026-04-26：DECISIONS / memory 学习——**永远不 git add -A**，user 并行 commit 时 untracked 文件会被卷入；写入 `~/.claude/.../memory/feedback_untracked_files.md`。
- 2026-04-26：P1 #1 老板 Dashboard Slice A（KPI 卡片层）落地，2 commits（`fdf6fb5` feat + `eeb1ded` round 98 fix）。新文件 `lib/dashboard/format.ts`（zh-CN 千分位）/ `shanghai-clock.ts`（todayShanghai / currentShanghaiMonth / shanghaiDayBoundary）/ `owner-stats.ts`（getTodayOrderStats + getMonthlyBillStats，全 Decimal sum）/ `components/business/dashboard/StatCard.tsx`（共享 KPI 卡 + data-slot="dashboard-kpi"）/ `app/(admin)/owner/page.tsx`（4 张卡 + requirePermission('report:all') + Promise.all 取数）。OWNER sidebar Dashboard href: `#` → `/owner` 恢复，admin-menu 单测加 href 锁定断言。E2E `tests/e2e/owner-dashboard.spec.ts` + `seedDashboardSnapshot()` helper：3 提交（1 急）/ 2 完工 / 1 发货 / 1 张当月 5000-2000 账单。**Codex round 98 抓 2 P1/P2 真 bug**：(P1) getMonthlyBillStats 没排除 DRAFT，与 /owner/bills 已有"DRAFT 未发单不算应收"口径冲突 → filter status IN [ISSUED, PARTIAL_PAID, FULLY_PAID]，seed bill 升 PARTIAL_PAID + issuedAt；(P2) Order.{submittedAt,completedAt,shippedAt} + Bill.period 没索引，dashboard 5 个 range count 在生产数据上退化 seq scan → migration `add_dashboard_indexes` 加 4 个 single-column index。+33 单测（累计 835，新增：format 8 / shanghai-clock 9 / owner-stats 16）。14 Playwright 测试 / ~12s。
- 2026-04-26：P1 #1 老板 Dashboard Slice B（关注列表层）落地，3 commits（`bc20724` DECISIONS docs + `769f8a9` feat + `8a1610e` round 99 fix）。先写 DECISIONS：业绩按 `Order.submittedAt`（不按 finishedAt）+ recharts@3.8.1 选型。新文件 `lib/dashboard/owner-watchlist.ts`（getPendingShipments / getOverdueOutsourcing / getEndingPeriods）+ `components/business/dashboard/WatchlistTable.tsx`（通用表壳）。/owner 页扩成 KPI 卡 + 3 张关注列表（待发货 max 10 含 hasMore 探针 / 超期外协 daysOverdue / 即将结算客服周期 7 天内 + 当前 active CS_TIERS 预测提成）。E2E seedDashboardSnapshot 扩 OutsourceOrder + SalaryPeriod fixture，wipe 范围扩到 e2e-dash-os-* 与 csUserId 的 commission/period。**Codex round 99 抓 2 medium/low**：(medium) 即将结算列&ldquo;已累计业绩&rdquo;只显示 totalSales，但提成按 totalSales+initialSales 算档 → 列改名&ldquo;业绩合计&rdquo;并添 salesForTier 字段，initialSales > 0 时下方 hint 显示&ldquo;含期初&rdquo;；(low) /orders?status=COMPLETED 链是死链（orders index 不读 searchParams）→ 去掉链接保留计数提示。+18 单测（累计 853）。14 Playwright 不变。
- 2026-04-27：P1 #1 老板 Dashboard Slice C（图表层）落地，2 commits（`6631660` feat + `85f7a25` round 100 fix）。`pnpm add recharts@3.8.1` 锁精确版本（DECISIONS 2026-04-26）。新文件 `lib/dashboard/owner-charts.ts`（getProductionTrend 30 天 raw SQL / getSalesRanking 本月 Top 10 groupBy / getCategoryDistribution 本月分布 raw SQL）+ 3 个 `'use client'` chart 组件（ProductionTrendChart LineChart / SalesRankingChart horizontal BarChart / CategoryDistributionChart donut PieChart）。所有 chart `isAnimationActive={false}` + `<ResponsiveContainer>`。视觉回归 `tests/visual/owner-dashboard.spec.ts`（3 darwin baselines）。**视觉基线提交前先 preview spec 截图给用户确认风格**（新 memory `feedback_visual_baseline_review.md`）。E2E seedDashboardSnapshot 加 chartFixture 选项（6 Products + 7 天 trend pattern + 4 ranking 工单），wipe 范围扩到 e2e-dash-* id-prefix（catch admin-submitted）。**Codex round 100 抓 1 high + 2 medium 真 bug**：(high) PG `AT TIME ZONE 'Asia/Shanghai'` 应用在 naked timestamp 列方向反 → 双层 `AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Shanghai'` 修；(medium) pie ORDER BY 缺二级排序 → 加 `category ASC` 字典序兜底；(medium) Tooltip 误用 formatAxisMoney（5000.50 → 5,001 / 12500 → 1.3 万 有损）→ 拆 formatTooltipMoney 精确到分。视觉回归基线（category）regenerated。+17 单测（累计 870；新增 trend 5 + ranking 7 + category 5）。17 Playwright（含 3 视觉基线 owner-dashboard-{trend,ranking,category}）。**至此 P1 #1 老板 Dashboard 全部 3 Slices clean**。
- 2026-04-27：P1 #2 企业微信推送 Slice A（notify 引擎 + dev mock）落地，4 commits（`63e0783` feat + `702a4ba` 拆出 visual baseline 删除 + `a27bb53` round 101 fix + `bb39967` round 102 fix）。先写 2 条 DECISIONS：(1) notify best-effort 永不抛（业务永不感知推送失败）+ (2) dev/test 默认 mock-mode。新文件 `lib/notification/{events,render,webhook,notify,index}.ts`（10 事件 const + payload 类型 + `{key}` 占位符替换 + fetch 5s 超时 + 3 次重试 + rule lookup → render → log）；NOT wired 到任何 Server Action，零调用点（Slice C/D 才 wire）。.env.example 加 `NOTIFICATION_MOCK_MODE`。**Codex 抓 4 真 bug**：(round 101 P1) events.ts payload 类型缺 prisma/seed.ts 默认 template 引用的字段 → 把 totalAmount/urgentMark/expectedDate/csName/commission/totalSales/daysLeft 加进 payload 类型；(round 101 P2) inactive channel 早 return 静默漏推 → findMany 不再 isActive 过滤，JS 侧分流，inactive channel 写 status=FAILED errorMessage='channel inactive'，channelIds 空/全 stale 走 console.warn；(round 102 P1) ORDER_SHIPPED.trackingNo 仍是 string \| null，与 seed `{trackingNo}` 必填模板冲突 → 改必填 string，调用方在 wire 时做 null→'未填' 映射。同 commit 顺手把 dashboard wall-clock-coupled visual baseline 删掉（trend X 轴日期每天滚动 / category 跨月数据漂移 → spec 设计上做不了它该做的事；E2E presence + 改 chart 时人工 review 接管）。+41 单测（累计 911；render 13 / webhook 9 / notify 19）。Slice B（admin UI） / C（5 状态机事件 wire） / D（cron 事件 + 2 新端点）待开。
- 2026-04-27：P1 #2 Slice A 收尾审计 —— **placeholder 与 payload 字段全量交叉检查**（Codex round 101/102 已修 6/10，剩 4 检查零盲点）。grep `prisma/seed.ts:seedNotificationEvents` 抽出 17 个唯一 placeholder（`{commission} {csName} {currentStock} {daysLeft} {expectedDate} {materialName} {orderNo} {outsourceId} {safetyStock} {submitterName} {supplierName} {taskCount} {totalAmount} {totalSales} {trackingNo} {urgentMark} {workerCount}`），逐一对照 `lib/notification/events.ts:NotificationPayloads` 的对应字段类型——全部命中**必填非 null** string/number。剩 4 个未走过 round 101/102 的事件（URGENT_ORDER / ORDER_SCHEDULED / ORDER_COMPLETED / STOCK_ALERT）模板都只引用必填字段，零隐性 null 风险。**业务源头 null 风险**也走了一遍：`OutsourceOrder.expectedDate` schema 是 nullable 但 `getOverdueOutsourcing` 已 NOT null filter；`Order.trackingNo` schema 是 nullable 且 `lib/order.ts:shipOrder` 业务允许 null（round 102 已 surface）；`Order.customerRef` nullable 但任何 template 都不引用它。**Slice C wire 时已知 TODO（防 round 103/104 再来）**：(1) `notify('ORDER_SHIPPED', {...})` 调用前必须把 `trackingNo: string \| null` 映射成 `trackingNo ?? '未填'`（或同义可读串）—— 否则 null → raw `{trackingNo}` 流到群消息；(2) 该路径写一条 unit test：mock null 入参，断言 messageContent 不含字面量 `{trackingNo}`；(3) 同样的&ldquo;null→可读串&rdquo;映射习惯也要 review `OUTSOURCE_OVERDUE.expectedDate`（Slice D wire 时格式化 Date → YYYY-MM-DD）和 `CS_PERIOD_SETTLED.csName`（lib/salary/cs.ts settle 处需 fetch user.displayName）。**可选延伸**（不阻 Slice B）：events.ts 加 runtime `NOTIFICATION_PAYLOAD_FIELDS` const，写一条 spec 解析 seed.ts 模板占位符 + 断言每个都在对应 const 里——这样未来人改 seed 加新占位符会立刻挂 unit test，比再来一轮 Codex review 便宜。
- 2026-04-27：P1 #2 企业微信推送 Slice B（admin UI）落地。新文件 `lib/auth/schemas.ts`（+createNotificationChannelSchema / updateNotificationChannelSchema / updateNotificationRuleSchema：webhook URL 严格 https://qyapi.weixin.qq.com/cgi-bin/webhook/send 前缀防 SSRF）/ `lib/notification/admin.ts`（listChannelsWithRefCount / getChannel / createChannel / updateChannel / deleteChannel + ChannelInUseError / listRules / getRule / updateRule + RuleNotFoundError / StaleChannelIdsError / updateRuleWithGuard + EmptyChannelIdsError / listLogs / countRecentFailures）/ `lib/notification/payload-fields.ts`（**之前 HANDOFF 提的&ldquo;可选延伸&rdquo;也实现了**：runtime const + spec 解析 seed.ts 占位符断言 ⊆ payload 字段——未来再有 round 103/104 类型级遗漏会立即挂 unit test）/ `actions/owner-notifications.ts`（4 个 server action：createChannel / updateChannel / deleteChannel / updateRule + testChannelAction 旁路 mock 测试）/ `components/business/notification/{ChannelForm,RuleForm,DeleteChannelButton,TestChannelButton}.tsx` / `app/(admin)/owner/notifications/{page.tsx,channels/new/page.tsx,channels/[id]/page.tsx,rules/[event]/page.tsx}`（3 个表单页 + 1 个 landing 页含 channel 表 / rule 表 / 最近 log 表 / mock-mode banner / 24h 失败告警条 / webhook URL mask）。Sidebar OWNER 菜单 +1 项&ldquo;推送配置&rdquo;（11 项），admin-menu 单测同步更新 + 新断言 href + perm。**lessons learned**：useTransition + 直调 server action **不会**自动刷新 RSC 缓存，需要 useRouter.refresh() —— DeleteChannel / TestChannel buttons 各加一行；revalidatePath 只对 form action 自动刷。删 channel 双闸：(a) 被 active rule 引用 → ChannelInUseError + 按钮 disabled；(b) 历史 log 引用 → PG FK P2003 → action 翻译成&ldquo;改为停用&rdquo;提示。+33 单测（累计 944；schemas 12 / admin 14 / payload-fields 3 + 2 sanity / 既有 41）。+1 E2E `tests/e2e/owner-notifications.spec.ts`（resetNotificationFixture helper 清 e2e_-prefix channel + 重置 ORDER_SUBMITTED/URGENT_ORDER rule；spec 覆盖建群 → 编规则 → 测试 → 删除前置闸 → FK 闸全链）。15 Playwright / lint / typecheck 全绿。
- 2026-05-05：P1 #2 企业微信推送 Slice C（5 状态机事件 wire）落地，4 commits（`45221bd` feat + `d506140` round 109 fix + `e65aeb4` round 110 fix + `223eb03` round 111 fix）。5 个事件实际接通（ORDER_SUBMITTED / URGENT_ORDER / ORDER_SCHEDULED / ORDER_COMPLETED / ORDER_SHIPPED）—— wire 都在 tx commit 后；submitOrder 后 fetch order → 触发；isUrgent 时**额外** URGENT_ORDER（独立事件不替代）；shipOrder 把 `trackingNo: string \| null` 映射成 `tracking ?? '未填'`（round 102 P1 wire 端兜底）。**Codex 抓 6 真 bug**（rounds 109/110/111）：(round 109 P1 high) `await notify` 阻塞 Server Action 最差 30s+，dead webhook 把"工单已提交"卡 loading → 改 `void notify`；(round 109 P2 medium) `formatMoney` 返 `¥ 5,000.00` 与 seed 模板 `金额：¥{totalAmount}` 双前缀 → 新 `formatMoneyPlain` 不带 ¥；(round 110 P1 high) raw `void notify` 在 SIGTERM 时被切，连 NotificationLog 一起丢 → 新 `lib/notification/dispatch.ts` 包装 Next 16 `after()` + 单测降级 void；(round 110 P2 medium) totalAmount 契约变更没通知 owner（Slice B 让他们自由编模板）→ RuleForm 加金额占位符 hint + events.ts 注释扩写；(round 111 medium) dispatch.ts catch all 把 unexpected `after()` 错误也静默吞掉 → 区分预期 no-scope vs 真意外，后者 console.warn 留 ops 信号；(round 111 low) RuleForm `**不含**` 字面星号渲染 → 改 `<strong>`。+16 单测（累计 967；wire spy 12 / dispatch 4）。E2E：`production-flow.spec.ts` 加 expect.poll 在 4 步后断言 NotificationLog（防 toHaveCount→读空时序 gap）；新 `notification-urgent.spec.ts` 单独覆盖 URGENT_ORDER 路径。新 helpers `seedNotificationWireFixture` + `readNotificationLogs`。16 Playwright / lint / typecheck 全绿。
- 2026-05-05：P1 #2 企业微信推送 Slice D（cron 事件 + 2 新端点）落地。`/api/cron/daily-salary` 末尾 wire DAILY_WORKER_SALARY（settled 行 actualSalary Decimal sum，formatMoneyPlain 千分位）；`/api/cron/cs-settle` 末尾 per-period wire CS_PERIOD_SETTLED（batch user.findMany 拼 csName，格式化 totalSales/commission）；新 `/api/cron/outsource-overdue` 复用 `lib/dashboard/owner-watchlist:getOverdueOutsourcing`（P1 #1 Slice B 已写）+ 每条触发；新 `/api/cron/cs-period-ending` 复用 `getEndingPeriods` + 每条触发。**Pre-existing latent bug surface 出来**：middleware.ts matcher 没排除 `api/cron`，cron 端点的 Bearer auth 之前被 session middleware 抢先 redirect 到 /login（之前 cron 都是 mocked 单测，没真 HTTP 跑过）。修：matcher 加 `api/cron` 排除。+14 单测（`app/api/cron/__tests__/notification-wire.test.ts`：4 个路由各 3-4 测；累计 981）。+2 E2E（新 `notification-cron.spec.ts` 覆盖 outsource-overdue + cs-period-ending；DAILY_WORKER_SALARY / CS_PERIOD_SETTLED 已由 unit 全覆盖，需要真薪资数据触发不重复投入）。新 helpers `seedOverdueOutsourceForCron` / `seedEndingPeriodForCron`；`seedNotificationWireFixture` 扩到 9 个事件全 bind。.env 加 `CRON_SECRET` + `NOTIFICATION_MOCK_MODE`。README §🚢 cron 段更新（6 endpoints 列出 + matcher 排除说明），smoke checklist 加&ldquo;NOTIFICATION_MOCK_MODE=false 验真发&rdquo;条。**至此 P1 #2 企业微信推送全部 4 Slices clean**：notify 引擎 → admin UI → 5 状态机 wire → cron 事件。9/10 SPEC §8.1 事件全接通；STOCK_ALERT 仍待物料模型 P1 后开。18 Playwright / lint / typecheck 全绿。
