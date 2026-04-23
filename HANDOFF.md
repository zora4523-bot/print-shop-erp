# 会话交接

> **每次新对话开始前，先读这份文件。** 它记录了上次会话停在哪、下次该接着做什么。
>
> 本文件每次 session 结束前**整体重写**（除"历史"小节是追加式时间线）。

---

## 当前任务

P0 #1 / #2 / #3 / #4 全部完成。**下一步：P0 #5 薪资系统**（预计 2 周，P0 最难的一块）。

## 本次 session 主要产出

P0 #4 生产流程完整交付——9 个 commits，+107 单测（累计 507），Codex rounds 37–42 共 6 轮（Slice A 一次修 / Slice B 一次修 / Slice C 一次修，其余首过）。

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

P0 #5 薪资系统（预计 2 周，核心难点）。开工前**必读**：

1. SPEC-v1.2.md §5（全部算法）、§7（四个示例表，逐行对应）、§3.7（客服周期结算时序）、§3.8（师傅日薪定时）、§3.9（时薪工月结）
2. `prisma/schema.prisma` 的 `SalaryRule` / `DailyWorkerSalary` / `SalaryPeriod` / `CustomerServiceCommission` / `HourlyWorkerPayroll`
3. `lib/salary/machine-piecework.ts`（已写好，Slice B 已在用）
4. `lib/salary/rules.ts`（已写好的 `getActiveMachineRule`；之后会加 `getActiveCsTiers` / `getActiveHourlyRule`）
5. 现有每条计件记录已快照了规则（`ProductionTask.salaryRuleSnapshot`）——P0 #5 薪资汇总**读快照，不回查 SalaryRule.id**

分解建议（按 CLAUDE.md §4.2 垂直切片）：

**Slice A — 师傅日薪汇总**
- `lib/salary/daily.ts` `computeDailyWorkerSalary(workerId, date)`：
  - 查当日 `completedAt` 落在 [date 00:00, date+1 00:00) 的 `ProductionTask`（该师傅的）
  - 汇总 `pieceworkAmount`（Decimal 加法）
  - 读师傅的 machineType 的 active `SalaryRule` 拿 `dailyBase`
  - 结果 `actualSalary = max(sum, dailyBase)`
  - 写 `DailyWorkerSalary`（`@@unique([workerId, date])`，幂等 upsert，每次覆盖写 `salaryRuleSnapshot`）
- Cron hook：SPEC §3.8 要求"每日 24:00"；用 `pg_cron` 或 Next.js 的 scheduled API route（Pigsty 已启用 pg_cron，DECISIONS 2026-04-22）
- 老板 UI：`/owner/salary/daily` 列表，筛选日期 + 师傅，显示 actualSalary、汇总 / 保底两列；"标记已发放"切 `isPaid`

**Slice B — 客服周期业绩 + 结算**
- `lib/salary/cs.ts` `startPeriod(csUserId, start, initialSales?)` 在客服开户时触发（当前 `account.ts createUser` 需要钩）
- `lib/salary/cs.ts accumulateSales(periodId, amount)` 在账单 mark-paid 时累加（P0 #6 才会调用，现在先写好接口）
- `lib/salary/cs.ts settlePeriod(periodId, now)`：查 `CS_TIERS` 规则、按 `totalSales + initialSales` 匹配档位、生成 `CustomerServiceCommission`、切状态 IN_PROGRESS → SETTLED、自动开启下一周期
- Cron hook：每日扫 `periodEnd <= today && status=IN_PROGRESS`
- 历史业绩导入（SPEC §5.5）：`/owner/salary/cs/import` 页面或 seed 里直接喂

**Slice C — 时薪工月结**
- 需要先有"考勤"表（schema 里没有，需要加 migration：`Attendance` 表：`workerId, date, normalHours, otHours, spareHours?`）
- `lib/salary/hourly.ts` `computeHourlyPayroll(workerId, month)`：PACKER/CLEANER 走正常工时 × 时薪 + 加班工时 × 倍率，COOK 走月薪 + spareHours × PACKER 时薪
- 月底 cron 触发

**Slice D — 老板薪资看板**
- `/owner/salary` 聚合页：今日日薪 / 本月提成 / 本月时薪 / 待发放合计
- 每块都有 drill-down 到对应 resource 的详情页

建议顺序 A → B → D → C；A 直接测通报工 → 日薪闭环；B 可以等 P0 #6 账单模块之后回来补（或者先用 seed 喂数据）；C 的考勤表和 UI 工作量最大，放最后。

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

2026-04-23

---

## 历史（追加式时间线）

- 2026-04-22：建立了项目记忆管理体系（PROGRESS / DECISIONS / HANDOFF + CLAUDE.md §13）。
- 2026-04-22 → 2026-04-23：完成 P0 #1 认证与用户管理全部切片（seed 硬化 + 认证基础 + 登录 + 自服务改密 + 老板管账号 CRUD）。16 个 feature/fix commits + 1 docs commit，149 单测，Codex 走了 15 轮 review。
- 2026-04-23：完成 P0 #2 工艺字典 + 产品字典。10 个 feature/fix commits，+100 单测（累计 249），Codex 9 轮 review。Round 24 统一修了三份字典的 "编辑页双 isActive 控件" 和 "create 后停留 /new" 两个通病。
- 2026-04-23：完成 P0 #3 工单核心（E-lean）。21 commits，+151 单测（累计 400），Codex rounds 25–36 共 9 轮。E-full（款式级编辑）延期到 P1。OSS 直传脚手架、打印 + PDF 双通道、工单编辑 + 急单 + OrderLog diff 全部落地。
- 2026-04-23：完成 P0 #4 生产流程。9 commits，+107 单测（累计 507），Codex rounds 37–42 共 6 轮。排产 + 师傅报工 + 薪资算法纯函数 + 外协单全部落地。级联的并发正确性一来就被 round 39 打中，cascade 锁内 fresh-read 补上；严格 `YYYY-MM-DD` 日期解析避免 JS Date 的滚动坑。
