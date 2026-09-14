# 会话交接

> **每次新对话开始前，先读这份文件。** 它记录了上次会话停在哪、下次该接着做什么。
>
> 本文件每次 session 结束前**整体重写**（除"历史"小节是追加式时间线）。

---

## 当前任务

**2026-09-14：分支 `codex/gongdanceshi` 已完成结构体检并收口 4 项缺陷，全部已 commit、未推送、未部署。**

本分支自 2026-09-13 起（含本次文档提交）共 30 个提交领先 `origin/main`，内容分三块：

1. **建单 / 定价 / 装盒批次（09-13，业务代码）**：管理员建单定价与关联外部销售、默认入袋 / 不包装 /
   版本化装盒计价、专版十一档「达到档位取价」（`e5bac3cb`，价目簿由 `scripts/publish-confirmed-custom-tiers.ts`
   按 `config/customer-price-books/custom-tiers-20260913.json` 发布，**不是 migration**）、空白封纸张规格价格、
   批量打印 PDF、报价转单草稿修复、品牌名统一为「长昆纸品有限公司」。对应决策见 DECISIONS 2026-09-11 ~ 09-13。
2. **结构体检（09-14，只读）**：报告在 `docs/项目结构体检-2026-09-14.md`。门禁实测：typecheck / lint /
   prisma validate / dead-code 全绿；分层、权限闸口、Prisma 直连边界与 CLAUDE.md 一致。
3. **体检收口（09-14，4 个独立 commit）**：
   - `e357efcc` 抽出 `buildFinalizePayload`，`OrderPricingReviewForm` 回到 723 行上限内，`check:architecture` 回绿
   - `666e8d89` `.gitignore` 忽略 `**/__tests__/__screenshots__/`（Browser Mode 运行产物，非基线）
   - `fb433c39` golden-gate 测试改按 print-sentinel 谱系（`notes.ruleVersion` + `sourceSha256`）时间点回读快照，
     本机开发库已发布 v9 / v10 十一档也能过；黄金用例一字未动
   - 本次 CLAUDE.md 1.3 + HANDOFF 同步（见下）

**验证事实（09-14）**：`pnpm test run` 614 文件通过 / 4 跳过（修复前 1 失败即 golden-gate）；
`pnpm check:architecture` 902 模块 / 25 项债务无增长；相关组件单测 8/8、Browser Mode 1/1。
没有跑 Codex 复审，没有更新任何截图基线。

**体检里尚未处理的项（业主定夺）**：
- 超大文件：`lib/order/change-request.ts` 6143 行、`lib/order.ts` 4410 行、`OrderForm.tsx` 3991 行、
  `lib/auth/schemas.ts` 3756 行。建议只在触碰时顺手拆；`schemas.ts` 可按域拆目录并保留 re-export。
- 根目录 8 份 AUDIT- / PLAN- / REPORT- 过程文件与 `docs/` 里带日期的一次性报告没有归档规则，建议 `git mv` 进
  `docs/archive/`。移动时要同步本文件与 PROGRESS 的链接。
- `PROGRESS.md` 仍停在 09-03，09-13 这批建单 / 定价 / 打印工作还没写进去。
- knip 134 个未用导出 / 229 个未用类型，集中在 barrel 文件；CI 只当证据，不是门禁。

### 仍成立的 Git / 生产事实

- remote：`https://github.com/zora4523-bot/print-shop-erp.git`（**私有，HTTPS**）。开发机 SSH 不通，**不要把 remote 改回 SSH**。
- 远端只有 `main` 与 `codex/*`（`codex/fabuceshi`、`codex/gongdan`），**没有 `dev`**；本分支 `codex/gongdanceshi` 尚未推送。
- **生产未动。** <https://bag.sshapi.cn> 上次记录仍是 `aa42ba0`（2026-08-02）/ 45 项 migration；本地迁移链已有 146 项。
  这些都**不是生产已 apply 事实**，部署前必须重新核对。
- 本机开发库加工费价目簿已到 v10（`2026-09-13-attained-custom-tiers`），v8 是 print-sentinel 迁移版。
  golden-gate 测试现在按谱系读 v8，**不要**为了让它过去回滚开发库版本。

---

## 下一步具体指令（给下次 AI）

**先做：把这批改动送去 review，不要开新功能**

1. 推送 `codex/gongdanceshi` 前再跑一遍 `pnpm check:architecture && pnpm lint && pnpm typecheck && pnpm test run`
   （CI 的 Static quality gates 会按这个顺序跑，架构门禁排最前）。
2. 若按惯例走 Codex 复审，把 `e357efcc`、`fb433c39` 两个 commit 一起给它看：前者是纯搬运，后者改了测试语义
   （「当前生效版」→「print-sentinel 谱系版」），复审重点是这个语义变化是否可接受。
3. 更新 `PROGRESS.md`：把 09-13 批次（建单定价 / 装盒 / 十一档 / 批量打印）与 09-14 体检收口写进「已完成」。
4. 文档归档（`docs/archive/`）只在业主点头后做；动根目录文件会牵连本文件与 PROGRESS 的链接。
5. 不要把 `docs/项目结构体检-2026-09-14.md` 里的「建议」当成已拍板；超大文件拆分没有立项。


**部署前仍必须先做（顺序不能反）**

1. **跑 `docs/上线前置操作清单.md` §一的"底数核对" + 查询 1**（只读，可反复跑）。
   ⚠️ **查询 1 返回 0 行有两种完全不同的含义**：真的没缺口，或谓词根本没匹配到任何东西。2026-08-21 在开发库上实测就是后者（6 个外协工艺、1 张有效外协单，但"应外协款式数 = 0"），那次执行**只证明了 SQL 语法可用，没有证明判定逻辑对**。先看底数核对的三个数字再解读查询 1。
2. **查询 2 单独成表报**——它是"横幅会误报"而不是"会被卡住"，混在一起报会让业主误判。
3. **外协那条要拆两步部署**：`f512046` 这一个 commit 里读路径横幅和完工闸口都在，**部署时需手动拆**。先上横幅让主管照着补完存量缺口，确认查询 1 返回空之后再上闸口。顺序反了 = 部署当天一批在产工单突然完不了工。
4. **盘点页低峰期发布**：部署瞬间浏览器里开着旧版盘点页的操作员，提交会因缺 `bookQuantity` 被判 invalid（fail-closed，刻意设计），刷新即可——**但已录入未提交的数据会丢**（`counts` 是纯 `useState`）。建议先口头通知盘点岗。
5. **迁移后验收唯一索引**：`SELECT indisvalid FROM pg_index WHERE indexrelid = '"NotificationLog_deliveryKey_channelId_key"'::regclass;` 必须为 `t`。`20260821120100` 用了 `CREATE INDEX CONCURRENTLY`，不能包在事务里跑（`prisma migrate deploy` 会正确处理）。

**部署前的人工验收（单测覆盖不到的）**

6. **fix#2b 外协闸口**：两个款式、只给其中一个建外协单并收货 → 报完全部内部任务后工单仍停 `IN_PRODUCTION`，主管点「已回货」时看到 notice。
7. **fix#1 报工守卫的知情通道**：计划 5000 报 6200 → 出现「确认超出计划数」复选框 → 勾选提交成功 → 工单时间线出现「超计划报工」→ **老板看板「超计划报工」表里能看到这一条**。守卫与看板是一个决策的两半，看板没验就等于守卫没上。
   （守卫本身已在真实应用上以零 JS 路径端到端验过：计划 1000 时 1500 需确认且输入值回填、3000 恰好等于 3 倍上限被硬拒、10000 被硬拒、1500+确认通过并写入 remark 与 `TASK_OVER_REPORT` 日志。验证用的开发库数据已还原。）
8. **fix#3a 盘点 CAS**：两个浏览器窗口，A 录入实盘数不提交，B 对同库位做一次领料改动，A 提交 → 该行被点名退回、其余行正常过账。
9. **业务侧重点验收**：外部销售加工费 / 快递耗材价目、改价审批、真实 OSS 图片 PDF、企业微信推送、cron、批量报工、分次结款、多地址与售后重做。

**已排期、需业主或单独评审**

10. **fix#3b：盘点的逐行时间基线 + ledger scan**（单独设计评审）。只解决「净额为零的往返」。要做就必须做**逐行**基线：`counts` 的 entry 加 `snapshotAt`、提交时逐行下发、服务端一条 `groupBy` 走 `(materialId, locationId, createdAt)` 复合索引、`InventoryCount.snapshotAt` 存 `min(item.snapshotAt)`、成功后服务端回 `postedAt` 让客户端设 `baselineFloor`。**不要**重新引入整页共用的基线时刻，也不要引入 `inventory_count_snapshot_max_age_hours` 这类墙上时钟阈值——那正是被否的四条理由的来源。需要 1 个 migration（可空列 + 复合索引，additive）。
11. **fix#4：OSS 临时 key + 服务端 copy**。**前置动作必须先于代码上线**：RAM 子账号加 `upload-tmp/*` 的 `GetObject`+`DeleteObject`、加 `design/*` 的 `PutObject`、bucket 给 `upload-tmp/` 挂生命周期规则。清单在 `docs/上线前置操作清单.md`。`design/` 前缀**永远不能挂生命周期规则**（它是业务数据）。实施时两个必踩陷阱已写进 DECISIONS 2026-08-21：`ali-oss` 的 `copyObject` 对 headers 只加前缀不删原键 → 裸 `If-Match` 让 copy 恒 412 而所有单测都 mock 了 SDK、CI 会一路全绿；`etag` 缺失被当成成功 → 写出悬空指针。
12. **三处无界查询（backlog）**——都是 `findMany` 无 `take`，行数随时间线性增长：
    - `lib/salary/daily.ts:593 listDailyWorkerSalaries`（`/owner/salary/daily`，不筛就是全表）
    - `lib/salary/hourly-aggregate.ts:549 listHourlyPayrolls`（同上）
    - `lib/worker-portal.ts:222 listWorkerSalaries`（师傅端 H5，三年约 900 行）
    **`listWorkerSalaries` 不能照抄 `listWorkerOrders` 的分页补丁**：`app/(worker)/worker/salary/page.tsx` 的 `salaryTotals()` 从整个数组 reduce 出「累计工资 / 尚未发放」，直接分页会把这两个金额静默变成「本页合计」——给师傅看错工资总额比慢更糟。正确修法是行分页 + `db.dailyWorkerSalary.aggregate` 单独算 total / unpaid。（`listWorkerHourlyPayrolls` 已核实**不需要**分页：每人每月最多一行。）
13. **运维缺口**：Pigsty 异地 repo2、30 天保留、恢复演练；生产 `SENTRY_DSN / APP_VERSION`；应用机至少 4 GiB RAM；`deploy-smoke` 继承 PM2 的系统 Chromium 路径与 `--no-sandbox`。
14. **`/api/health/jobs` 尚未接进任何外部监控**；在有东西按分钟去拉它之前，SLO 表里的死信响应目标不生效。

---

## 卡住的问题

### 待业主拍板（本批新增，代码已按默认口径落地）

- **盘点「部分过账」语义需业主点头**：一次提交现在可能只过账一部分行，`InventoryCount` 单据上只有被接受的那些，冲突行原样退回要求重数。原设计是一行冲突整单驳回（99 行合格数据陪葬且无 override）。风险评估为低（盘点行本来就是逐 (物料, 库位) 独立的），但要确认。
- **师傅超报要多一次提交往返**（零 JS 下是整页 POST + 重渲染），弱网车间会感知到延迟。这是拍板方案的固有成本，上线前跟业主对一次预期。
- **首页「24 小时推送失败」告警条的计数语义变了**：瞬时抖动不再点红，重试成功会把历史 `FAILED` 行就地翻成 `SUCCESS`。上线前告知业主，别让人以为数据丢了。
- **`ProductionTask.remark` 的写入格式从此是对外契约**：`[超计划报工] YYYY-MM-DD 计划 N / 合计 M（合格 a / 不良 b / 返工 c），报工人 <id>，已勾选确认`，多次写入 `\n` 追加；老板看板「明细」列原样渲染它。
- **`pnpm test:browser` 是否纳入 §6.3 文档化门禁仍需业主拍板**：当前只有 `components/business/cdr/__tests__/CreateBundleForm.browser.spec.tsx` 等交互契约落在该通道，但 `CLAUDE.md` / `DECISIONS.md` 都还没把它写成正式门禁。本轮只在单文件层面使用普通 Vitest 守住共享 Checkbox 的 Enter/Space wrapper 契约，没有擅自接浏览器门禁。

### **CLAUDE.md 待业主落笔**（配置文件，AI 不改）

- **§4.5 措辞已漂移**：`reportTasks` 实际是「逐任务 advisory 锁 + 读 + 逐条 update」，比文档描述的 `updateMany({ where: { status } })` **更稳**，但 §4.5 与 DECISIONS 2026-08-19 的措辞都还停在旧写法。（`beginTasks` 仍符合原描述，不要改错。）
- **§15.7 或 §5.3 值得补一句**：`Setting` 现在有 4 个键，`report_qty_max_multiple` 是唯一 money-adjacent 的那个（守着会算出计件金额那条路径），但 `resolveSetting` 的「校验不过退回 fallback」对它仍然安全——它不参与金额计算、只是一个上界，退回 3 只会更严。这一条已写进 `lib/settings/definitions.ts` 的 doc 注释和 `definitions.test.ts`，只是 CLAUDE.md 里还没有。

### 上一批带出、仍未拍板

- **薪资「当天 / 当月」重算的残余风险**：现只拒绝**严格未来**（日薪 `date > 今天`、月结 `month > 本月`）。(1) 当天日薪——上午 10 点点一次全员重算，当天还没报工的师傅会被写出一条只有 `dailyBase` 的正式行，能被标记已发，晚上真报工后重算又被 paid guard 挡住，只能人工撤销。(2) 月中月结更肉疼——COOK 的 `monthlyBasePay` 是整月 flat、不按天折算，月中重算厨师立刻拿满一整月 `COOK_MONTHLY`。选项 A（现状）/ B（月结改成只允许已结束的月份，方案作者推荐）/ C（连当天也拒）。任一选择都只动谓词里一个比较符 + 一条测试断言。
- **交期预警口径**：(1) 未提交的草稿单 `DRAFT` 该不该继续留在 `PROMISE_ALERT_STATUSES`？摘掉的影响不止看板——工单详情页 `PromisedDateBadge` 用同一份清单，草稿单详情页会同时不再显示「已逾期」红标。(2) 逾期超过多少天后停止预警/推送？要设就按 `outsource_overdue_days` 的样子加 `Setting`（建议 key `order_overdue_alert_max_days`），不硬编码。
- **师傅端「我的工单」**：是否接受不再急单置顶（待办队列仍在 `/worker/tasks`，那里保持急单分组）；每页 20 条（`WORKER_ORDER_PAGE_SIZE`）对手机端是否合适。
- **登录限流配套**：厂区 NAT 出口 IP 是否加 `geo` 白名单；429 是否配 `error_page` 友好提示；应用层账号级失败锁定是否另立项（现状完全没有）。
- **6 处冗余 `router.refresh()`**：已确认「`revalidatePath` 不刷 client RSC 缓存」是错误认知。选 A（清代码 + 订正注释）/ B（只订正注释，当前做法）/ C（照抄 refresh）。

### 长期未决

- 默认本地开发库 `print_shop_erp` 尚不能直接跑本发布候选：前向 migration `20260807180000_order_pricing_and_settlement` 的财务护栏识别到已全额结清账单 `cmsbmplo40008850rahu58pb4`（已付 ¥3000、2 笔付款）混入非外部销售项目，拒绝自动改写。失败 migration 已按 Prisma 标准流程标为 rolled back，未删除或修正业务行。必须先由业务负责人决定该历史账单归属，再显式修复，不能绕过护栏或猜测重分账。
- 生产 pgBackRest 只有 repo1 且仅保留 2 份 full；即时备份和 WAL 正常，但两 repo / 30 天 / 月度恢复演练目标未达成。
- 生产尚未配置 `SENTRY_DSN`，`APP_VERSION` 需核对；当前错误主要依赖 PM2 / Next 日志。
- `deploy-smoke` 尚未自动继承 PM2 的系统 Chromium 路径与 root sandbox 参数，直接按旧文档运行会假失败。
- 应用机仅 1.6 GiB RAM，构建严重依赖 swap。
- 新增三款 A4 视觉基线已生成；既有 7 张打印基线未重写。`pnpm-workspace.yaml` 的 `allowBuilds` 占位符待业主定夺。
- A07（推送按人路由）/ A20（生产单拆分）业务输入，以及 A21 供应商合同自动定价的工艺、单位、阶梯、最低收费与有效期口径。
- 后台任务账本尚无自动保留清理策略。**注意**：将来给 `NotificationLog` 加保留期时，必须排除「所属 `BackgroundJob` 仍在 `PENDING`/`RUNNING`」的行——`deliveryKey` 行是幂等凭证，删早了会让重试对已收到消息的群重复推送。
- 已结算/已发客服提成遇跨周期撤单或降价时的政策（下期扣回 / 历史工资调整 / 不追溯）；客服停用或改岗时同样不能猜测。当前代码宁可整体阻断。
- 已发布报价条件仍有 `productCodes / craftCodes` 字符串引用；若允许修改产品/工艺编码，需改用稳定 ID 或在仍被 CURRENT/SCHEDULED 价目引用时阻止改码。
- 收费类目若要新增停用入口，必须先明确 `category.isActive` 是「全局紧急停收」还是「随冻结版本不漂移」。

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
- 2026-08-02：财务/薪资/外协对账审查以 `aa42ba0` 固化（121 文件 / 1688 单测、45 项 fresh migration 全绿），随后发布到 <https://bag.sshapi.cn>。Pigsty 上线前 full backup `20260802-193420F` 成功，生产 12 条待迁移全部应用，三 PM2 进程、ready、HTTPS 路由和系统 Chromium PDF 内存生成验收通过；同时确认 repo2/Sentry/内存升级与 smoke 口径为后续运维缺口。
- 2026-08-03：同步近期功能与生产事实到三份记忆文档、README、部署/冒烟/SLO 和同事使用手册；清除 A06、任务排序、工单修改申请与生产 Chromium 等陈旧口径，并记录发布分支领先 `main`、无 Git remote 的恢复风险。
- 2026-08-07：工单列表新单优先、37 类独立筛选、稳定服务端分页和 ADMIN 全量/筛选异步 XLSX 导出在本地收官。导出包含 11 工作表、精确 Decimal、发起人+当前 ADMIN 双重授权、24h 保留和第 8 cron；事务模糊提交、过期竞态、终态 PII 收缩与删除重试经对抗性复核闭合。筛选表单导航同步、烫金色可逆转义和 WORKER 排产草稿边界已补回归；Fresh 64 migration、1840 单测、build 和 24 项全视口/axe 门禁全绿；未 commit、未部署。
- 2026-08-07：修复管理端工单详情把工艺 ID 直接显示给用户的问题；详情查询批量映射中文名并保留历史/缺失回退，款式卡补数量、四位单价、小计和准确排产语义。139 文件 / 1845 单测、生产 build、24 项全视口明暗/axe 门禁及真实草稿单浏览器回归全绿；未 commit、未部署。
- 2026-08-07：完成对客加工费自动报价与资金方向隔离：订单冻结结算类型，产品阶梯/基础价叠加工艺收费项并保存快照，MOQ 失败关闭，改单提供只读差额预览且批准时重新报价；客户应收、内部工资/提成、师傅计件和供应商应付互不复用。历史建议单价、考勤身份快照和数据库兼容围栏由第 67–71 项前向 migration 严格收口；本地库及 PostgreSQL 16 空库 71 / 71、156 文件 / 2070 单测、空库 Dashboard E2E、typecheck、lint、Prisma、生产 build 全绿；未 commit、未部署。
- 2026-08-08：外部销售快递/打包耗材对客收费完成：中通与纸箱两份来源的 SHA-256/单元格证据、每票创建估算、最终重量发货终审、顺丰到付管理员后期更正、改单耗材跨档重算、账单分项与工厂内部成本分账均已收口。74 / 74 migrations、170 个测试文件 / 2265 项单测、typecheck、lint、Prisma validate、生产 build、375px + 1280px 管理/销售明暗响应式 + axe 门禁全绿；未 commit、未部署。
- 2026-08-09：外部销售报价统一为管理/销售单入口，已接入 PROCESSING/LOGISTICS 草稿复制、单项目编辑、严格校验、上海时间发布与放弃；已发布版只读，技术证据不进入业务页面，并发陈旧覆盖失败关闭。178 个测试文件 / 2325 项单测、typecheck、lint、Prisma validate、生产 build、375×667 管理/销售 viewport+axe+touch 门禁全绿；真实草稿页技术字段零可见且无横向溢出。未 commit、未部署。
- 2026-08-11：管理端外部销售收费拆为 `/items` 日常工作台与 `/versions` 发布中心，左侧菜单可直达；121 条加工规则与物流规则支持服务端搜索、类目/产品/省份/数量/计价/状态组合筛选和当前价→草稿价对比。客户端编辑 DTO 已裁掉 code/JSON/SHA/Excel/互斥组/优先级，服务端写锁内保留技术条件并同步产品匹配。计划生效与无当前版不再显示必失败动作；桌面长编辑器改为视口内滚动。180 文件 / 2362 单测、typecheck、lint、Prisma、build 及干净 74 migration 隔离库的 375×667、1280×800 管理/销售明暗 viewport+touch+axe 门禁全绿；未 commit、未部署。
- 2026-08-12：外部销售收费按纸张、产品/工艺/规格聚合精确数量锚点；157 克与 200 克严格分组，底层规则仍逐档独立。草稿可在一个编辑器中原子保存全部数量档金额/启停，固定总价与按个/按张/每万/每款单位分别诚实展示；181 文件 / 2427 单测、生产 build 和 12 个确定性响应式/axe 场景全绿；未 commit、未部署。
- 2026-08-17：将零 JS 硬约束收敛到登录、登出、改密码三条关键会话路径，新增禁用 JavaScript 的 Playwright project；师傅端开工/报工恢复原生 form 形状，其余后台 CRUD 不再被未拍板的全仓约束阻断。
- 2026-08-18：将工单筛选/导出、计价结算、工资与外协账本、外部销售加工/物流价目、收费工作台、价格阶梯编辑、74 项 migration、测试和记录文档统一固化为提交 `feat: complete pricing, settlement, and order operations`。183 文件 / 2441 单测、typecheck、lint、Prisma、build、diff-check 与零 JS 会话门禁 3 / 3 全绿；本条只表示 Git 归档完成，生产仍为 `aa42ba0 / 45 migrations`。
- 2026-08-21：并行缺陷修复批次（11 项）：cron 密钥不再进 curl argv + 恒定时间比较、登录限流改挂 `location = /login` 并按方法豁免 GET、新增 `/api/health/jobs` 死信探针（`/ready` 状态码语义不变）、日薪/月结拒绝严格未来日期、`/owner/salary` 未发聚合下推数据库（+1 项 CONCURRENTLY 索引 migration，累计 75 项）、交期看板与逾期推送各自收窄并加 200 条 fan-out 安全阀、师傅端「我的工单」改 `createdAt desc` 分页、9 个详情页 `generateMetadata` 查真实业务编号（含四页越权标题泄漏修复）、`lib/order/export.ts` 全量显式 `select`、background-jobs 时间戳锚到数据库时钟、`OrderForm` 必填语义与 `AttendanceRecordDialog` 保存回执的无障碍修复。文档由单一 agent 统一同步：README、`docs/部署指南.md`、`docs/deployment-smoke-checklist.md`、`docs/production-slo-and-recovery.md`，DECISIONS 追加 12 条。**CLAUDE.md 未改**（配置文件，留给业主）。
- 2026-08-21：上线前对抗审查 + 修复。四条候选高风险修复经对抗性审查后**没有一条能照原样实施**，全部 blocking 破绽实读代码核对属实；定稿后落地四项：单条报工数量守卫（判据 `>=`、`Setting` 默认 3、配套老板看板「超计划报工」知情通道）、工单完工闸口收紧为款式级外协覆盖（残留粒度缺口显式接受）、盘点并发守卫改用逐行账面回声 CAS + 部分过账（时间戳基线方案整体否决）、通知投递失败可重试并进死信（`NotificationLog.deliveryKey` 幂等，+2 项 migration，累计 77 项）。OSS 直传重放加固与盘点 ledger scan 明确本批不做并写明理由与陷阱。新增 `docs/上线前置操作清单.md`（外协覆盖的两段部署前只读 SQL、唯一索引 `indisvalid` 验收、单向门与人工验证），DECISIONS 追加 6 条。**CLAUDE.md 未改**（留给业主）。
- 2026-08-22：发布源连续性收口。仓库首次配置 Git remote（`https://github.com/zora4523-bot/print-shop-erp.git`，私有）；`main`、`codex/complex-client-data-layer-poc`、`fix/launch-review` 三个分支推送完成。上线前审查的 17 项修复按主题拆成 10 个 commit 经 PR #1 合入发布分支，随后 PR #2 将发布分支快进合入 `main`（`245be5c → dd648c0`，104 commit / 795 文件）。合并后在 `main` 上复跑门禁：lint 0 / typecheck 0 / 206 文件 2758 项单测 / Prisma validate 全绿。**生产仍为 `aa42ba0` / 45 migrations，本次只是 Git 归档，未部署。**
- 2026-08-23：对工作区未提交加固批次（相对 `357a084`，111 文件 +5999/-1991 及 47 个未跟踪文件）做结构审查。结论：要求修改，不能按现状合入。报告 `docs/代码质量审查-2026-08-23.md`，Codex 执行稿 `docs/codex-prompt-代码质量审查修复-2026-08-23.md`。旧「RETRYING→FAILED」修法作废。未改业务代码，未 commit，未部署。
- 2026-08-23：Codex 独立复审代码质量审查；成立项已按规定修法收口并拆成 `f608e39 → 9dd1cc5` 小提交。未做 / 已证伪的是已发与冻结 roster 语义改写、删外协兼容缓存或把 `max` 改 `sum`、强搬所有取号进事务、客户端化 Server Component `<details>`、改登录令牌消耗时机及 `RETRYING→FAILED`；程序化门禁全绿，未部署。
- 2026-08-23：修复签名 JWT 仍有效但数据库账号已失效时 `/` 返回 500 并连带触发 Script 警告的问题；根路由现统一跳转 `/login`，四角色分流与异常透传回归已补，提交 `cbc88ca`，全量门禁与浏览器复验通过，未部署。
- 2026-08-24：入库 UI 重设计交付包（源：Downloads「定价表单优化分析」）。交互稿在 `docs/ux-redesign/`；定价对照 `docs/定价表单优化-2026-08-24.md`；Codex 展示层执行稿 `docs/codex-prompt-定价表单优化-2026-08-24.md`。首批只做外部销售工作台/阶梯表/发布中心，不做全站 12 项。未实现、未部署。
- 2026-08-24：按交互稿改已有页面（展示层，未 commit）：工单详情常驻动作条 + 时间线 + 款式折叠 + 取消收回页头；收费工作台阶梯 Δ / 粘性草稿条 / 两套只读文案 / 发布 L3 影响；排产「本次可派 / 阻断」列 + 师傅候选卡；Dashboard 处理队列优先（无毛利、无上次查看）；工单修改申请列表前移决策列；计件工资重算移到筛选行末。未碰 lib/actions/prisma。未部署。
- 2026-09-08：UI 规范三段式完成（只写 docs / lint / PR 模板，零 UI 代码改动，未 commit）。盘点 `docs/UI现状盘点.md`（原始扫描 `docs/audits/2026-09-08-ui-scan-*.md`）；对照裁决 `docs/audits/2026-09-08-UI对照裁决表.md`（业主确认，待拍板项按默认生效）；定稿 `docs/ui-规范.md`（§2 令牌、§7 文案，附录 A 豁免）；`docs/UI迁移清单.md` P0/P1/P2；新门禁 `scripts/ui-tokens/check.mjs` + `baseline.json`（裸色 / 内联金额 / deep import，存量 warn、新增 error、stale 报错）已挂进 `pnpm lint`，实测 0 error / 132 warn。随附的「七组原型 ui-规范.md」未送达，基准由四份原型 `:root` + 仓库条款拼合。同日完成 P0-3：`AdminOrderEditor` 的 Sheet「确认保存修改」与 Dialog 离开确认改走 `ConfirmActionController`，待补运费/阻断改为页内「核价结果」区，`AdminOrderEditor.browser.spec.tsx` 43/43。同日完成 P0-2：`app/`+`components/` 14 处 UTC 日期切片改 Shanghai formatter（真缺陷仅 `AccountForm` 默认入职日）。2026-09-09 完成 P0-1：金额全部走 `formatMoney` / `formatMoneyPlain` / `formatMoneyDelta` / `formatUnitPrice`，门禁新增拦 `¥ ${…}` 直拼，`baseline.json` money 待迁移清零；遗留阶梯价 4 位小数与费率格式两项待拍板（见迁移清单）。同日完成 P1-4（deep import 清零）与 P1-3（删 10 行无用 token）。P1-8 / P1-7 / P1-10 / P1-2 同日完成。P1-5 圆角间距归并同日完成。P1-6 与 P1-1 同日实施完毕（`baseline.json` 存量豁免清零；`--muted-foreground` 因 AA 压到 L 0.53），admin 门禁 axe 对比度归零、剩余失败为另一任务的工单号标题定位器；业主已目视确认；`.decision` 深色按钮方案另立 P2-12。P1 仅剩 P1-9 金额三态（待拍板）。P2 已完成 P2-9（关闭，无死导出）、P2-5（2/3，RulePriceWorkbench 因导航拦截豁免）、P2-8（空态工厂改「暂无X」/「没有匹配的X」）、P2-7（新增 `SectionLoading`，业务代码 `animate-pulse` 归零）、P2-11（手写横滚包裹归零，`TableScrollArea` 透传 div 属性）。三项待拍板已按业主授权定案（DECISIONS 2026-09-09：`formatRate`、保持 L2、三态收编 `pricingStatus`+`estimated`），P1-9 转 P2-13。P2-4（复制 hook）与 P2-12（决策列 emphasis，顺带修好批准/拒绝同色的潜在缺陷）已完成。P2-13（三态 helper，顺带把待核价的 destructive/warning 统一成 primary、销售端文案统一为「待工厂核价」）已完成。P2-1（状态药丸归并，6 组并行 + 对抗校验；顺带修掉归档账单外显原始枚举、销售端急单 danger 误用、临期/逾期同色，以及并行任务引入的 heading-order 回归）已完成，残余登记为 P2-14 / P2-15。P2 剩余：、P2-2 NativeSelect、P2-6 字段错误、P2-3 PendingButton、P2-10 disabled 审计。注意 `AdminOrderListLayout.browser.spec.tsx`（未跟踪，另一任务 WIP）等待尚不存在的「下发生产」按钮，整套超时，不是回归。
- 2026-09-14：结构体检（`docs/项目结构体检-2026-09-14.md`）+ 四项收口 commit：架构门禁回绿（`e357efcc`）、忽略 Browser Mode 截图产物（`666e8d89`）、golden-gate 按 print-sentinel 谱系回读（`fb433c39`）、CLAUDE.md 1.3 同步现状。未推送、未部署、未跑 Codex 复审。
