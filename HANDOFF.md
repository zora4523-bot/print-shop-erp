# 会话交接

> **每次新对话开始前，先读这份文件。** 它记录了上次会话停在哪、下次该接着做什么。
>
> 本文件每次 session 结束前**整体重写**（除"历史"小节是追加式时间线）。

---

## 当前任务

**全库架构体检 + 去重收敛批次完成** ✅（2026-07-09）。6 子系统并行深读 + 44 agent 逐提案风险验证；实施 7 个"行为零变化"重构切片（`06ecc62` 日期 / `b449b68` cron 认证 / `d57a2ec` OSS 工厂+锁 key / `610096a` 通知常量 / `a310e23` collectFieldErrors / `d3c700e` createOrder 批量 / `f4b6ab7` 薪资规则查询），每切片 tsc+eslint+全量单测验证，Codex 复核 **PASS**。**1272 单测全绿**。

完整报告（架构概述 / 问题区域 / 路线图 / 不做清单）：**`docs/架构体检报告-2026-07-09.md`** ← 下次做重构类任务前必读，尤其"不做清单"（React cache() 等五个已验证否决的方案）。

## 下一步具体指令（给下次 AI）

1. **需业主拍板的行为缺口**（报告 §二A，按危害排序）：
   - A1 cancelOrder 不级联取消 ProductionTask——取消工单后师傅仍可开工报工**计件进工资**（SPEC 未写取消工单的任务处置，禁止猜测，先问业主）；
   - A2 约 23 个管理页面无页面级权限检查（soft-nav 下 layout 不重跑）；
   - A3 3 个页面直接 import Prisma（违反 §3）；A4 3 个 action 模块吞未知错误不进 Sentry；A5 markCsCommissionPaid 缺锁；A6 BOM Toggle 吞错误。
2. **可直接开工的重构路线图**（报告 §三，全部已通过独立验证，含实施细节与陷阱）：parseStrictYmd 抽出 → schemas.ts 拆分（验收必须加 pnpm build）→ Toggle 按钮统一（顺带修 A6）→ .types.ts 别名化（8 文件，不含 outsource/production）→ TextField 去重（9/14 份）→ 状态机工厂 → transitionWithLog 复用 → 组件测试（@vitest/browser-playwright 独立包；"合格+不良+返工=计划数"规则不存在，别写假断言）。
3. **业主拍板后的功能任务**：A05 工单款式级编辑 / A20 生产单拆分 / A21 应收应付扩展 / A07 推送按人路由——Needs 清单在 `docs/AGENT-BACKLOG.md`。
4. **纯运维**（生产上线时）：按 `docs/部署指南.md` + README §🚢。

## 卡住的问题

- 视觉基线 6 张 png（承诺交期 + QR URL 化引起）仍待业主看截图确认后以 `[visual-regression]` commit 提交。
- `pnpm-workspace.yaml` 的 `allowBuilds` 占位符待业主定夺。
- A05/A07/A20/A21 等业务输入（backlog Needs 小节）。

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
- 2026-07-05：**A06 OSS STS 真实接入**（`968b131` feat + `d65804f` / `89b1302` fix，Codex rounds 抓 6 真 bug）。业主提供 bucket `hongbaowebdb` / region `oss-cn-guangzhou` / 角色 `erp-oss-upload` / 子账号 `webhongbao` AK（**曾误填 .env.example，已迁 .env 并恢复模板，密钥未进 git**；region 从完整域名归一化）。`ali-oss` + `archiver` 落地：signViaSts 真 AssumeRole（session policy 收缩单 objectKey，1h）+ CDR 流式打包（get→zip→putStream bundles/* + 24h 预签 GET，长期凭证——STS 1h 签不出 24h 链接）。Codex 6 修：endpoint 走 config、putStream settled 折叠防 unhandled rejection、CDR mock 非生产默认开、expiresAt 对齐签发时刻、malformed OSS_ENDPOINT 双路径降级（sign 折叠 error / isMockMode 降级 mock 防 /foreman/cdr 500）、PassThrough destroy 需先挂 error 监听器（否则崩进程）。真实冒烟：AssumeRole ✅ / 临时凭证 PUT design/* ✅ / 越权护栏 ✅ / 子账号直连 ❌（等业主挂策略）。测试对象遗留 bucket（无 DeleteObject 权限，预期）。1229 单测全绿。pnpm store v10/v11 冲突用 `CI=true pnpm install` 重链接解决。
- 2026-07-05：A06 全链路验证收官——业主挂好 `webhongbao` 对象策略后复跑冒烟 6/6 全通；真实 `uploadBundleZip` 端到端（archiver 流式打包 + 预签 URL 下载 + ZIP 魔数校验）通过。
- 2026-07-05：设计图上传 UI 接线（`3849cbd` + `ed9733e`）。工单详情页款式卡设计图面板（DRAFT 增删/其余只读）；预签 PUT URL 直传（前端零 SDK）；Codex 抓 5 真 bug 全修：sign 前置授权闸（防任意 id 铸凭证写孤儿对象）、HEAD Content-Length 权威 size + 上限兜底（防申报小传大）、order-cascade 锁内 fresh-read（防与提交并发 TOCTOU）、凭证 1h→15min（压缩重放覆写窗口，ETag 固定记 P1）、input 重置。预签 PUT 真实冒烟（含错误 Content-Type 403 护栏）通过。1242 单测。
- 2026-07-06：上线前检查 + 注释清理（`f0cebce`）。全库移除 90+ 处 "Codex round N" 溯源标注（保留约束说明；历史在 git log/HANDOFF/DECISIONS 可查），49 文件纯注释改动。教训：第一版全局正则把代码里的 `()` 也删了——回滚重做，改成只作用于注释行的脚本 + 跨行引用逐处手修。验证：tsc / eslint / 1249 单测 / next build / deploy:smoke（prisma validate + migrate status + mock-mode + Puppeteer + 路由探测）/ 21 Playwright E2E+视觉 全绿。生产部署剩纯运维动作（README §🚢）：服务器 .env 真值、NOTIFICATION_MOCK_MODE=false、OSS CORS 加生产域名、pg_cron 切换、pgbackrest、Pigsty 扩展安装。
- 2026-07-07：承诺交期 + 交期预警 + ORDER_OVERDUE 推送 + 二维码 URL 化（`d240061` / `1483867` / `5d6b04a` / `6c3fdc5`）。Order.promisedDate（2 个 migration：字段 + 规则行数据迁移）；预警口径集中 lib/order/promised-date（详情徽标 / dashboard 关注列表 / 每日 cron 三处共用）；第 11 个推送事件 ORDER_OVERDUE 只推逾期；QR 内容改 {base}/orders|worker/tasks URL（lib/public-base-url 与 CDR 共用推导，foreman-cdr 去重）；打印页眉加承诺交期行。Codex 抓 3 真问题：升级库缺规则行（数据 migration 修，高危）、视觉基线（按惯例截图待业主确认后提交）、cron E2E 缺口（补全链测试）。1264 单测 / 22 E2E 全绿。**待办：视觉基线 6 张 png 等业主看截图 OK 后以 [visual-regression] commit 提交。**
- 2026-07-08：上线前多维度审计（6 维度并行 audit → 逐条对抗性验证 workflow，54 agent；含手动核实）。发现并**即修 4 项**：(1) **blocker** `createOrderFromInput`/`scheduleOrderFromInput` 从 'use server' 导出成公开 Server Action、信任调用方 actor 无 requirePermission = 越权+审计伪造后门，零调用方直接删除（`5bdf5a3`）；(2) **high** `.env.example` 出厂 `NOTIFICATION_MOCK_MODE="true"` 会诱导运维带进生产静默 mock 推送→改留空按 NODE_ENV 判定（`3eaf050`）；(3) README env 表补 mock 开关行+OSS CORS 手动步骤+APP_PUBLIC_URL 扩到二维码、6→7 cron 漂移修正（`3eaf050`）；(4) **low** hourly-payroll cron 意外错误 scrub 对齐 COUNTS-ONLY（`c5ac707`）。1264 单测/tsc/eslint/build 全绿。**剩余为纯手动运维项**（见报告）：生产 .env 注入（APP_PUBLIC_URL/SENTRY_DSN/AUTH_SECRET 新值/DATABASE_URL 生产库）、OSS 控制台配 CORS、首次 seed、cron 调度器（crontab/pg_cron 7 端点）、Pigsty 扩展安装、pgbackrest、Puppeteer chrome、PM2/Nginx 自备。视觉基线 6 png 仍待业主确认后提交。
- 2026-07-09：全库架构体检（6 子系统深读 + 44 agent 提案验证 workflow）→ 7 个行为零变化重构切片落地（日期/cron 认证/OSS 工厂+锁 key/通知常量/collectFieldErrors/createOrder 批量/薪资规则查询，`06ecc62`→`f4b6ab7`），Codex 复核 PASS，1272 单测全绿；交付 `docs/架构体检报告-2026-07-09.md`（含行为缺口 A1-A7、结构债清单、已验证路线图、不做清单）；DECISIONS 记录去重边界决策。
