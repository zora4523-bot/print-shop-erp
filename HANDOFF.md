# 会话交接

> **每次新对话开始前，先读这份文件。** 它记录了上次会话停在哪、下次该接着做什么。
>
> 本文件每次 session 结束前**整体重写**（除"历史"小节是追加式时间线）。

---

## 当前任务

**2026-06 大批次已提交固化 + STOCK_ALERT 接线完成（SPEC §8.1 事件 10/10 全接通）**。自动化队列（`docs/AGENT-BACKLOG.md`）已无 `agent-ready` 任务，剩余项全部 `needs-owner-input`，等业主拍板。

## 本次 session 主要产出（2026-07-05）

1. **工作区大批次全量验证通过**（127 文件、schema +832 行、16 个新 migration、30+ 新模块文件）：
   - `prisma validate` ✅ / `tsc --noEmit` ✅ / `eslint .` ✅
   - **1214 单测全绿**（80 文件，4.5s）
   - `next build` ✅（全部新路由编译通过：parties / purchases / warehouses / boms / prices / product-categories / materials(count) / pigsty / orders 迁入 `(admin)`）
   - `prisma migrate deploy` 应用 7 个 pending migration 到本地库 ✅
   - **21 Playwright E2E + 视觉回归全绿**（40.6s，含 smoke.spec 覆盖 Pigsty readiness 页与物料搜索）
2. **A09 分区 cutover 计划交付（plan-only）**：新增 `docs/partition-cutover-plan.md` —— 三张日志表复合主键改造、入向外键复核 SQL（当前为 0）、按月回填、rename-swap 切换、验证/保留/回滚步骤、Prisma `@@id` 复合化及 `findUnique` 调用点排查清单。backlog A09 已标记 Delivered（执行仍 manual-ops-only）。
3. **PROGRESS.md 整体刷新**（原文停在 4-25"P0 6/9"，已更新到当前真实状态）。
4. **大批次提交固化（业主授权后）**：按模块拆 12 个 commit `c84162f → accb713`（db/Pigsty → admin 框架 → audit → material → party → product → price → purchase/warehouse → bom → orders 路由迁移 → e2e smoke → docs），提交后 1214 单测 + tsc 复验绿。`pnpm-workspace.yaml` 留了一段未填的 `allowBuilds` 占位符改动**未提交**，等业主确认意图。
5. **STOCK_ALERT 接线（SPEC §8.1 收官，10/10 事件全通）**：commits `3184a26` + `4f76a85`。出库跨越检测（>=安全库存 跌破 <安全库存 那次变动触发，低位不重复，回补后再跌破重新触发）；wire 点 `createMaterialTransaction` + `cancelPurchaseReceipt`，tx 提交后 dispatch。Codex 2 轮：抓 payload number 丢尾零（改 toFixed(2) 字符串）+ 测试未锁提交顺序（callOrder 断言），复核 clean。决策已记 DECISIONS 2026-07-05。**1220 单测**全绿。

## 下一步具体指令（给下次 AI）

1. **业主拍板后可开工的任务**（按优先级）：A05 工单款式级编辑 / A06 OSS STS 真实接入 / A20 生产单拆分 / A21 应收应付扩展 / A07 推送按人路由——Needs 清单都在 `docs/AGENT-BACKLOG.md`。
2. **纯运维**（生产上线时）：`.env` 真值、cron 切 pg_cron、pgbackrest、Pigsty 扩展安装按 `docs/pigsty-production-activation-runbook.md`。
3. **可选小活**：`pnpm-workspace.yaml` 的 allowBuilds 占位符处理；STOCK_ALERT 低位周期重复提醒（如业主要求，加 cron 端点复用现有 payload）。

## 卡住的问题

- A05/A06/A07/A20/A21 全部等业务输入（见 backlog Needs 小节）。
- `pnpm-workspace.yaml` 有一段 `allowBuilds` 占位符改动（值是字面量 "set this to true or false"），像是 pnpm 命令生成后未填完，未提交，等业主确认。

## 相关文件清单（下次 AI 必读）

- `docs/AGENT-BACKLOG.md` — 任务队列与状态（A01–A23）
- `docs/AGENT-ROUTINES.md` — routine 执行协议（先 `pnpm agent:next`）
- `docs/partition-cutover-plan.md` — 本次新增的 A09 计划
- `docs/pigsty-production-activation-runbook.md` — 生产扩展启用 runbook
- `docs/ADMIN-FRAMEWORK-PLAN.md` / `docs/SOYBEANADMIN-ADOPTION.md` — admin 框架蓝图
- `PIGSTY-EXTENSIONS.md` — 扩展清单与降级策略

## 上次会话结束时间

2026-07-05

---

## 历史（追加式时间线）

- 2026-04-22：建立了项目记忆管理体系（PROGRESS / DECISIONS / HANDOFF + CLAUDE.md §13）。
- 2026-04-22 → 2026-04-23：完成 P0 #1 认证与用户管理全部切片。149 单测，Codex 15 轮 review。
- 2026-04-23：完成 P0 #2 工艺字典 + 产品字典。+100 单测（累计 249），Codex 9 轮。
- 2026-04-23：完成 P0 #3 工单核心（E-lean）。21 commits，+151 单测（累计 400），Codex rounds 25–36。E-full 延期 P1。
- 2026-04-23：完成 P0 #4 生产流程。+107 单测（累计 507），Codex rounds 37–42。
- 2026-04-24：完成 P0 #5 薪资系统 4/5 切片。+119 单测（累计 626），Codex rounds 43–47。
- 2026-04-24：完成 P0 #5 Slice C（时薪工 + 考勤）。+90 单测（累计 716），Codex rounds 48–51。
- 2026-04-25：完成 P0 #6 Slice A 应收账单后端。+56 单测（累计 772），Codex rounds 52–54。
- 2026-04-25：闭合 P0 #5 遗留 daily-salary race（commit `50956ee`）。+4 单测（累计 776）。
- 2026-04-25：完成 P0 #6 Slice B/C/D 账单 UI + cron。Codex rounds 55–63。P0 #1–#6 全 clean。
- 2026-04-25：上线前运维补齐 + Sentry 隐私收紧（rounds 64–69）。
- 2026-04-25 → 2026-04-26：本地真跑暴露 4 个 prod-only bug 全修（rounds 70–72）。
- 2026-04-26：Playwright E2E + 视觉回归落地（5 waves，13 测试，rounds 73–94）。
- 2026-04-26：SHIP / FINISH 状态机收尾，Order.status 写入路径统一 advisory lock（rounds 87–88）。
- 2026-04-26：Admin shell scaffolding（AppSidebar / AdminBreadcrumb，round 81 收敛）。
- 2026-04-26 → 2026-04-27：P1 #1 老板 Dashboard 三切片（KPI / 关注列表 / recharts 图表）。+68 单测（累计 870），rounds 98–100。
- 2026-04-27 → 2026-05-05：P1 #2 企业微信推送四切片（引擎 / admin UI / 状态机 wire / cron）。+121 单测（累计 991），rounds 101–118。
- 2026-05-05：P0 #7 CDR 汇总下载落地。+20 单测（累计 1011）。
- 2026-05-06：CDR 收尾审计 8 轮（rounds 119–126，baseUrl 推导硬化）。+12 单测（累计 1035）。**P0 9/9 收官**。
- 2026-06-28：（Codex 批次，工作区交付）Pigsty 扩展 PR-1..10 + admin 框架 A11–A15 + ERP 主数据 A16–A19 + 审计 A22 + 客户端数据层 POC A23 + agent 自动化协议（backlog / routines / agent:next）。16 个新 migration。
- 2026-07-05：（本 session）UI Phase A–E 之后的工作区大批次全量验证绿（1214 单测 / 21 Playwright / build / lint / typecheck / migrate deploy）；A09 分区 cutover 计划交付 `docs/partition-cutover-plan.md`（Codex 2 findings 闭合）；PROGRESS.md 刷新到真实状态。队列无 `agent-ready` 任务，剩余项等业主输入。
- 2026-07-05：（业主授权）大批次按模块拆 12 commit 固化（`c84162f → accb713`）；STOCK_ALERT 出库跨越检测接线收官 SPEC §8.1 10/10 事件（`3184a26` + `4f76a85`，Codex 抓 payload 丢尾零 + 测试锁提交顺序，复核 clean）。1220 单测 / lint / typecheck 全绿。
