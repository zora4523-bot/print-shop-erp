# 会话交接

> **每次新对话开始前，先读这份文件。** 它记录了上次会话停在哪、下次该接着做什么。
>
> 本文件每次 session 结束前**整体重写**（除"历史"小节是追加式时间线）。

---

## 当前任务

**P0 #1–#6 全部完成 clean** + 上线前运维补齐已完成。下一阶段（P1）待业主拍板优先级。

## 本次 session 主要产出

- P0 #6 Slice A 应收账单后端（commits `ec86612 → 503e438`）—— 4 commits，+56 单测（累计 772），Codex rounds 52–54。
- **P0 #5 daily-salary race 补齐**（commit `50956ee`）—— per-(worker,date) advisory lock + tx，`markDailySalaryPaid` 取同一锁。+4 单测（累计 776）。
- **P0 #6 Slice B 老板账单 UI**（commits `135cbd2 → 65f7789`）—— 5 commits，0 单测（Server Component UI），Codex rounds 55–60（1 个 P2 真 bug + 4 轮"漏抓"文案精度迭代）。
- **P0 #6 Slices C+D**（commits `ffbc3ca → 07edf02`）—— 3 commits，0 单测，Codex rounds 61–63（2 个 P2/P3 真 bug + 1 轮 layout-pathname 限制讨论）。
  - Slice C：`app/sales/layout.tsx`（SALES + CUSTOMER_SERVICE gate，OWNER 不在此 layer 转发——见 round 62）+ `/sales/bills` 列表 + `/sales/bills/[id]` 详情（**资源所有权双闸：404 而非 403 防 id 枚举**），权限补 CUSTOMER_SERVICE 进 `bill:view:self`。
  - Slice D：`POST /api/cron/generate-bills` 镜像 daily-salary 的 shared-secret + COUNTS-ONLY pattern；上月 default；**explicit-vs-absent period 区分**（round 61 P2：`{"period":""}` 不能静默 fallback）。
  - Round 62：layout.tsx 拿不到 pathname，OWNER 转发 `/sales/bills/<id>` → `/owner/bills` list 会丢 leaf id；干脆删掉 OWNER 转发，OWNER 走根页找入口。

同一 session 前半段已完成 P0 #5 Slice C（时薪工 + 考勤），+90 单测，Codex rounds 48–51。

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

**P0 + 运维补齐都完成 clean**。下一步：

1. **业主拍板 P1 优先级**。SPEC §10 / `PROGRESS.md` 列了 E-full（款式级编辑）、推送、报表、Docker 化等候选——建议从工作流痛点回收（业主用一天给反馈）。
2. **运维剩下的硬件 / 平台动作**（代码侧 done，剩纯 ops）：
   - `.env` 真实填 CRON_SECRET / SENTRY_DSN / OSS 5 必填变量（README §🚢 §1 表格列了影响）
   - 上线后 cron 由 shared-secret curl 切到 Pigsty pg_cron（README §🚢 §2 4 个 endpoint 都给了 curl 示例）
   - Pigsty pgbackrest 启用 + 季度恢复演练（README §🚢 §3）
3. **已知未做但 SPEC 写过的非 P0 项**：CS 提成&ldquo;工单 FINISHED 时累加 vs 账单 mark-paid 累加&rdquo;二选一仍未拍板（HANDOFF 卡住的问题里），目前实现是后者；退单语义未实现（业主拍板）。

**Codex review 闸口**：所有提交都过 Codex review（最近 round 69 no findings）。776 单测 / lint / typecheck 全绿。

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

2026-04-25

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
