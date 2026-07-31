# 会话交接

> **每次新对话开始前，先读这份文件。** 它记录了上次会话停在哪、下次该接着做什么。
>
> 本文件每次 session 结束前**整体重写**（除"历史"小节是追加式时间线）。

---

## 当前任务

**工单变更、生产、薪资、财务闭环与多能力派工完成** ✅（2026-07-31）。

- 多地址：`OrderShipment / OrderShipmentLine` 保存地址与款式分配，历史工单回填为单地址；主地址兼容快照保留并与编辑同步，发货要求完整、顺序一致的地址集合后原子确认。
- 售后重做：SHIPPED / FINISHED 原单可创建 `REWORK + NO_CHARGE` 子工单；复制所选款式和设计证据后进入待排产，原单状态/应收/工资不回退，重做生产仍正常计件。
- 管理端：列表/详情展示提交人、实际师傅、顺丰到付、多地址、原单/重做关联；顺丰到付可后期独立更正。
- 排产：单工单工艺行可多选；待排产列表先选师傅，再从最多 30 张工单批量分配其兼容工艺。混合机型可分步派给不同师傅并显示已排/待排；草稿任务在全部派完前不向师傅开放，最后一项完成后原子进入 SCHEDULING。
- 打印：A4 边距 10mm，3 款启用紧凑布局；长名称、长红色备注、多色烫金 fixture 的 Chromium 截图和 PDF 单页断言通过。
- 工单变更：销售/客服创建带版本的修改申请，管理员批准后原子更新所有端口；版本冲突和已开工数量变更硬阻断。
- 混合工艺：彩印+烫金同时生成外协与厂内任务，回厂阶段可排风车机/机仔师傅。
- 师傅端：急单优先后按工单创建日期排序；支持多选一键开工/完工，任务详情展示设计图与接单人。
- 薪资/考勤：风车机新阶梯与账号级规则覆盖落地；工资可按日期查超底薪原因；全体正式员工考勤支持 0.5 天。
- 财务：客服销售额、客户结款、工单成本分别记不可覆盖流水；账单展示每次结款、提成、成本和毛利，售后重做成本归回原账单。
- 认证：JWT 只作会话提示，页面与 Server Action 使用前按用户主键实时校验账号存在、启用状态和当前角色；账号在排产页打开后失效会返回重新登录入口，事务不落任务、不进入整页错误边界。
- 多能力派工：开机师傅账号配置“主机型 + 多设备能力 + 熟练工艺”；排产与改派分为推荐、可分配但需说明、硬阻断。非推荐原因写 `OrderLog`，实际设备写 `ProductionTask.machineType`，个人计件规则可覆盖每一种登记设备。
- 本地已执行 migrations 至 `20260731210000_worker_capabilities_and_assignment_override`；回填核对为 3 位开机师傅、19 条推荐能力、0 位空设备能力师傅。
- 本轮最终验证：113 测试文件 / 1527 测试、typecheck、lint、Prisma validate、生产 build、4 项真实批量排产 E2E 全绿；375px 明/暗及 1280px 管理端全路由通过溢出探测与 axe 门禁。开发服务器运行在 `http://localhost:3000`。

## 下一步具体指令（给下次 AI）

1. 上生产前先备份，再执行 `pnpm prisma migrate deploy`；履约 migration 会回填 shipment/line，最新能力 migration 会把历史主机型写入多设备能力，并把原可分配的师傅/工艺组合回填为推荐项。
2. 上线门禁：`pnpm check:env` → migrate/build → `pm2 startOrReload deploy/ecosystem.config.cjs` → `/api/health/ready` → `pnpm check:backup`。
3. 重点人工验收：先在账号管理给一位师傅增加第二种设备与熟练工艺；待排产验证推荐排序、搜索与在制数。再取消某个熟练工艺，确认管理员仍可分配但必须填写原因，并在工单日志核对原因与任务实际机型。随后验混合机型分步派工、销售修改申请、师傅批量报工、分次结款、多地址、售后重做和三款打印。
4. 多机扩容前，PDF 产物必须迁到共享对象存储；当前单机 PM2 基线用 `/var/tmp/print-shop-erp/pdf`。
5. 原架构报告与 A07/A20/A21 业务待办仍保留，见 `docs/架构体检报告-2026-07-09.md` / `docs/AGENT-BACKLOG.md`。

## 卡住的问题

- 本机没有 pgBackRest 且未配 `PGBACKREST_STANZA`；`pnpm check:backup` 会正确失败并阻断上线，不伪造生产备份绿灯。
- 新增三款 A4 视觉基线已生成；既有 7 张打印基线未重写。
- `pnpm-workspace.yaml` 的 `allowBuilds` 占位符待业主定夺。
- A07/A20/A21 等业务输入（backlog Needs 小节）。
- 后台任务账本尚无自动保留清理策略；上线后按实际增长率决定 SUCCEEDED/CANCELLED/DEAD 的保留窗口，并单独设计清理任务。

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
- 2026-04-26 → 2026-04-27：P1 #1 管理员 Dashboard 三切片（KPI / 关注列表 / recharts 图表）。+68 单测（累计 870），rounds 98–100。
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
- 2026-07-17：生产硬化：PostgreSQL 任务账本 + LIGHT/HEAVY worker + cron/通知持久化 + CDR/PDF 资源隔离 + live/ready + ADMIN 任务看板 + pgBackRest 验收脚本落地。本地 migration 和 PDF worker 真实演练通过；1296 单测 / lint / typecheck / build 全绿。
- 2026-07-17：生产硬化上线前纠偏：修复 worker 资源限制落在 tsx 包装进程、durable 通知可抛、终态 dedupe 永久占位、CDR 永久 PENDING、未知任务不进 fail、部署 env/重启配置和 PDF 排队体验；补齐生产分支测试，1353 单测 / lint / typecheck / Prisma validate / build 全绿。
- 2026-07-19：后台角色收敛：OWNER / FOREMAN 数据与权限统一迁移为 ADMIN，管理员菜单合并经营、生产、财务、字典和运维入口；保留 `/owner/*`、`/foreman/*` 旧 URL，旧 JWT 与早期默认姓名自动归一化。迁移已在本地库执行并确认 3 个管理账号全部为 ADMIN，后台不再展示“老板/车间主管”；1397 单测 / 3 项登录 E2E / lint / typecheck / Prisma validate / build / 页面实测全绿。
- 2026-07-19：新工单号改为 `GD-YYMMDD-XXX`（例 `GD-260719-001`），保留历史编号；上海业务日 advisory lock 与严格三位流水校验继续生效。配置迁移已执行，真实新建工单 E2E 与工单列表页面验证通过。
- 2026-07-31：管理端履约与售后增强：多地址发货/分地址运单、顺丰到付后期更正、免计费关联重做、批量派工与三款 A4 单页打印落地。本地迁移和真实 Chromium 打印验收通过；109 文件 / 1479 单测全绿。
- 2026-07-31：工单变更、生产、薪资与财务闭环：版本化修改申请、彩印+烫金混合排产、师傅批量开工/完工、风车机新阶梯与账号规则、日期底薪对比、全员半天考勤、客服销售额/结款/成本分账落地；111 文件 / 1496 单测、36 项跨设备 UI、8 项打印视觉/PDF、生产 build 全绿。
- 2026-07-31：待排产列表升级为按兼容工艺分步批量排产：先选师傅再跨工单勾选，混合机型可分两次派给不同师傅；PENDING 草稿由 Order 状态双重门控，全部派完才进入生产。真实同机型批量与混合机型两阶段 E2E 均通过。
- 2026-07-31：修复删除/停用账号的长效 JWT 仍可进入排产动作并在 OrderLog 外键处 500；统一数据库实时会话校验，排产动作提供重新登录恢复态，真实失效会话 E2E 验证零任务落库。
- 2026-07-31：多能力师傅与管理员最终派工落地：账号支持主机型/多设备/熟练工艺，单单/批量/改派统一推荐与硬资格，非推荐派工强制原因并审计；任务按实际设备计薪，个人规则覆盖全部登记机型。1527 单测、4 项真实排产 E2E、375px 明暗与 1280px 管理端 UI 门禁、生产 build 全绿。
