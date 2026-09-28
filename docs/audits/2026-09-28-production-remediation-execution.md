---
status: verified-locally-with-open-decisions
owner: project-maintainers
baseline_commit: b09829ea
scope: 单负责人生产流程修复与验证
---

# 生产流程修复执行记录

依据[修复方案](2026-09-28-production-assignment-remediation-plan.md)。本文件逐步记录实际结果，未验证的项目保持待执行。

## 任务边界与业务选择

- 开始分支 `codex/design-removal`，HEAD `b09829ea`；已跟踪工作区与暂存区均无改动。
- 保留两个无关未跟踪文件：`2026-09-21-first-use-readiness.md`、`2026-09-21-first-use-remediation-brief.md`，不纳入提交。
- 预计修改范围：生产登记/继承/重做、审批与状态转换、工资查询与结算保护、相关管理员及师傅入口、前向迁移、定向测试和业务文档。
- 用户已确认 D1：原计划 1,000、实际核定 990 完成，后增至 1,300，新任务默认 310。仅资料修改仍沿用完成结论，不自动补 10。
- D2（已结算日补差支付方式）待回复；共同的原归属、原日期、原账保护不依赖该选择。

## 改动前基线

- Claude Code `2.1.283` 已启动只读方案审查，显式模型 `claude-opus-5-5`、effort high；仅 Read/Grep/Glob，无 fallback。两轮成功完成，模型回执均为 claude-opus-5-5；原始结果已归档。
- 新建可丢弃 PostgreSQL 库 `erp_e2e_remediation_1790605881991`，由已有隔离测试模板复制；写入型验证不使用普通开发库。
- 全量基线：`pnpm test --run`，在隔离库环境运行。720 个文件中 716 通过、1 失败、3 跳过；7,824 个用例中 7,777 通过、1 失败、46 跳过。
- 唯一失败为 `lib/form-drafts/__tests__/drafts.test.ts:74` 的“成功后旧组件不能重新写回草稿，失败暂存仍保留”；发生在本轮业务修改之前，后续与本次回归分别记录。
- 普通本地开发库只读扫描：`ProductionJob` 为 0 条。该结果不代表其他环境，也不替代异常历史 fixture 的恢复验收。
- 本轮临时证据目录：`/var/folders/1m/qlr1bwhj2h7ck5qbntt0xdcm0000gn/T/erp-remediation-execution-xld7b3ve/`；包含启动边界、审查输入/输出、隔离运行器和基线日志，不保存连接串或登录态。

## 执行与验收进度

| 项目 | 状态 | 实际证据 |
| --- | --- | --- |
| 最新方案 Claude 对抗审查及复核 | 已完成 | 两项阻断补齐后定向复核通过；四项 P3 已收口 |
| R0 失败回归与数据清单 | 本地完成 | 全量基线及本地只读扫描已完成 |
| R2-d 状态转换基础 | 已实现、定向通过 | 同一剩余生产守卫；终态不重开 |
| R1、审批入口及历史保护 | 已实现、定向通过 | 原量原日核定、持久义务、SQL 守卫、历史冲突核定 |
| R3 生产承接与计价 | 已实现、定向通过 | 真实量/需求满足分开；310 增量；CONTINUED 未完工承接；原价快照 |
| R2 重做流程 | 已实现、定向通过 | public create → release → complete → shipment；零内部任务与存量恢复 |
| R4 三端入口与展示 | 本地验证通过 | 数量汇总/定位、工资义务；76 条组件、6 视口通过 |
| R5 恢复、整批验证、代码审查 | 本地共同范围完成，条件分支未定 | 179 空库迁移；全量仅基线草稿失败；Claude 定向复核无新的代码 P1/P2 |

修复前承接回归：10 条中 2 条失败（990 核定后仅资料改版错误新增 10），8 条通过。后续用同一断言复验；不把基线通过项计为修复验收。发布不在本次授权范围内。


## 实现结果与实际代码审查

F1–F5 的共同修复已实现：关联重做走确认/下发；暂停及取消后的数量核定保留原人原日；改版前先核清数量申请及实际生产；首次生产不因版本号进入人工价；列表与工资页可定位待处理生产。历史事实新增持久核对记录及四项前向迁移，不删除旧记录、不改已结算原账。

同一款已核定 990 完成原 1,000 需求，纯资料改版保留完成；新总量 1,300 生成 310，1,001 生成 11，995/1,000 不补做。未做完时仅资料改版使用 CONTINUED 延续原数量、原归属和开始日期，实际完成后计薪一次。

[三轮实际代码审查原文及处置](2026-09-28-production-remediation-code-review.md)已归档。Claude Opus 5.5 最终定向复核确认多工序恢复、包含数量上限、已承接事实保护及外协完成时间沿用没有剩余可达 P1/P2；它未运行测试，不能替代以下验证。保留两个 P3 维护说明及未决业务分支，不宣称全项目无缺陷。

## 实际验证方式

候选为基线 `b09829ea` 加本次工作区差异；本文件与修复代码在同一个本地提交中交付。日期 2026-09-28 至 09-29，上海时区。没有 push、部署、生产库恢复、真实推送或真实付款。

写入型 Vitest 与手动浏览器使用 `erp_e2e_remediation_1790605881991`；最终六视口另用 `erp_e2e_remediation_browser_1790611706621`，均完整应用 179 项迁移。全部命令由临时隔离运行器注入同一 DATABASE_URL / E2E_DATABASE_URL 和数据库名确认。运行器校验 localhost，未在日志输出口令。Playwright 使用真实 Next Server Action 和浏览器表单；release 模式为 next build/start，通知 mock、后台任务 inline、CDR mock。这些模式不证明真实消息或 durable worker 交付。

| 验证 | 实际命令 / 结果 | 证据 |
| --- | --- | --- |
| 数量、历史恢复、真实重做与 SQL 守卫 | `pnpm test --run lib/production/__tests__/dispatch-completion.postgres.test.ts --maxWorkers=2 --testTimeout=30000`；38 通过 | final-pg-38.log |
| 完成通知、改版与历史价 | `pnpm test --run lib/__tests__/production-completion.test.ts lib/production/__tests__/completion-pricing.test.ts lib/order/__tests__/change-request.test.ts --maxWorkers=2 --testTimeout=30000`；205 通过 | completion-final.log |
| 浏览器组件 | `pnpm test:browser components/business/order/__tests__/AdminOrderDetailView.browser.spec.tsx components/business/order/__tests__/AdminOrderListLayout.browser.spec.tsx components/business/order/__tests__/AdminOrderWorkspaceSizing.browser.spec.tsx components/business/order/__tests__/AdminOrderWorkspaceColors.browser.spec.tsx`；4 文件、76 通过 | browser-components-final.log |
| 架构 | `pnpm check:architecture`；1,079 模块、4,346 依赖通过，24 项既有超长函数债务 | closing-architecture.log |
| lint | `pnpm lint`；0 错误、2 项既有 Next 导航警告，UI 文案及 token 门禁通过 | closing-lint.log |
| 类型 | `pnpm typecheck`；通过 | closing-typecheck.log |
| 完整迁移 | `node scripts/verify-fresh-migrations.mjs`；179 项空库迁移及既有金额后置条件通过 | fresh-179.log；空库 erp_e2e_remediation_fresh_1790611276075 |
| 生产构建 | `pnpm exec tsx scripts/e2e-release-build.ts`；通过，Next 16.3.4；同 release 测试环境的 .next-release | release-build.log |
| 六视口真实浏览器 | `E2E_PREBUILT=1 pnpm exec playwright test --config=playwright.release.config.ts tests/visual/production-dispatch.spec.ts --workers=1 --max-failures=1`；6 通过，0 跳过 | release-browser-isolated.log |
| 全量及覆盖率 | `pnpm test --run --maxWorkers=2 --testTimeout=30000 --coverage --coverage.reportOnFailure`；719 文件通过、1 基线失败、3 跳过；7,824 用例通过、1 基线失败、46 跳过（共 7,871） | full-frozen-final.log |

浏览器环境显式指定隔离账号 E2E_ADMIN_USERNAME=e2e-owner 和 fixture 密码、E2E_BASE_URL=http://127.0.0.1:3120；不使用实际管理员账号。六种尺寸为 375×667、393×852、768×1024、1024×768、1280×800、1920×1080。每种尺寸分别检查明暗主题、overflow、触控目标及 axe，并实际展开提成核对和误登记确认、用 Escape 退出。像素截图为候选证据，本轮未更新打印或视觉基线。

### 已发生失败及归类

- 基线草稿测试在业务修改前失败；最终全量仍按该独立问题记录，不通过跳过或删除断言掩盖。
- 早期承接测试 2 条失败后修复，保留原断言。新重做自身改版测试初次因 fixture 没有收货地址失败，补齐测试前置后 38 条 PG 全部通过。
- 末轮修复期间的一次全量启动早于共享完成函数修改，却采集到新断言，产生 2 条完成通知失败；定向 205 条随后通过，冻结代码后另跑整批，前次不算最终候选验收。
- 同次全量旧定价迁移测试出现 PostgreSQL query read timeout；后续单独重跑该文件 7 条通过，归为并行负载下的环境故障，不改 SQL 或超时配置掩盖。
- 生产浏览器首轮误用了默认 SEED 管理员而不是 globalSetup 隔离账号，在登录前置失败并中止；显式指定隔离账号后重跑。开发测试遗留浏览器在 release 切换 secret 后产生 JWTSessionError，关闭本任务的旧会话；不能将这种日志写成 release 业务页面报错。
- 历史 CREATE INDEX CONCURRENTLY 迁移使 Prisma shadow migrate dev 失败（P3006），本轮使用审查过的 schema diff / 前向 SQL，隔离库 deploy 和 fresh 完整链验证；没有 reset、db push 或改写旧迁移。

## 人工浏览器操作证据

本轮通过 Playwright CLI 操作真实页面，不以 SQL 写状态代替表单提交：

1. 管理员发布排单；师傅从默认 1,000 改 990 提交；管理员列表“数量待审批”计数/定位；打开核定表单并批准。
2. 外部销售查看“待打包发货”，看不到生产提成表单及内部金额；销售提交交期调整、管理员预览并批准。v2 沿用 0 新生产，旧 v1 保持完成 990；管理员和销售均保持“待打包发货”。
3. 使用原日 2026-09-27 的独立申请和个人工价 fixture：工资页面显示无工资行的待核定人员；批量结算被明确阻止；链接可定位到工单并固定原日期；批准 990 后工资 198；浏览器单人“锁定结算”确认后，回查原日仅一条 LOCKED 结算。未标记支付。
4. 实际页面曾出现 React key 警告，补齐 RSC 栏目和款式的稳定 key 后刷新复验，最后管理员/销售控制台无对应错误。

主要工单：dispatch-ui-7d080494-a309-44c0-9721-533ab742d026；原日日结工单：dispatch-ui-86dfa565-b8b8-44ed-a56c-a85df4a1d333。证据截图在忽略目录 `output/playwright/production-remediation/`；原始日志/快照在任务临时目录。它们不进入 Git。

## V1–V28 追踪

下表描述实际覆盖，不把同一用户故事的未运行变体冒充浏览器通过。PG 指 `dispatch-completion.postgres.test.ts`；其他断言保留在相应领域测试。未决分支见下一节。

| 编号 | 验证与边界 |
| --- | --- |
| V1 | PG 真实 createReworkOrder → 自动下发/继承 → 完成 → 发货；旧模式调用保持原路径 |
| V2 | PG 新增真实重做自身连续资料/数量改版及重复物化：不重复继承源单；0/100 新量，原单与工资保持 |
| V3 | PG 原申请核定、历史恢复及承接；待审管理员补登不会互锁 |
| V4 | PG 取消前事实保护及预览 token 失效；真实工资不被取消丢弃；超量对客结算分支仍未定 |
| V5 | PG 暂停中核定保持暂停，恢复后才待打包 |
| V6 | PG 旧请求恢复原量原日、幂等、冲突保存；同日包含/独立额外生产各有案例 |
| V7 | PG v2 首产标记修复及自动计价；历史价单测校验局部/专版、颜色与过版、小单费，不仅断言非空 |
| V8 | PG 数量/设计变更人工价；款式余量单测禁止跨款抵扣 |
| V9 | PG 无工资人员待办；浏览器往日请求→结算拒绝→核定→198 单次锁定；未做实际付款 |
| V10 | PG 师傅/补登竞争及重放、SQL 申请/日期/结算守卫；并发调度不作穷举保证 |
| V11 | PG 非负责人/非管理员、停用师傅、旧记录更正和重复请求拒绝；销售视图另经浏览器验证 |
| V12 | 三角色实际点击及 release 六视口生产链；定位入口另有手动 CLI 实测 |
| V13 | PG 已结算原账相等、源单工资/物流不变、恢复命令重放；普通开发库无历史任务可恢复 |
| V14 | PG 990 后连续两次交期修改，0 新量、一份工资及一次通知；实际浏览器复现一轮 |
| V15 | PG 核定真实量差异、驳回必须无生产证据及原申请审计 |
| V16 | PG 仅重打包零生产/工资正常完成；外协缺失/覆盖/收货由共享完成闸口测试覆盖，未测试实体物流 |
| V17 | PG 停用历史负责人补登、超计划核定、已结算日原账保护；历史价格使用冻结依据 |
| V18 | 76 条组件、三角色浏览器、取消显示修复；真实详情稳定 key 复验 |
| V19 | PG 待取消补登、撤回/驳回、事实前置与旧预览失效；物理改版继承另有回归 |
| V20 | 逐款实际量及多工序去重单测；PG 多工序历史恢复不改无关 CARRIED 工序 |
| V21 | 状态机正反例与 PG 更正/增量/暂停恢复；终态不重开 |
| V22 | 原申请恢复 PG 与历史计价快照单测；资料缺失保持拒绝，不读新资料兜底 |
| V23 | PG OPEN/CONFLICT 阻止依赖写入与日结，核清后只重算相关 310；后续事实保留 |
| V24 | PG 身份/日期锁、直接 SQL 和恢复重放；核对期间日结守卫与批处理共用查询 |
| V25 | 990→1,300=310、1,001=11、995/1,000=0；连续改版不将 CARRIED 计为另一批实物 |
| V26 | PG 原账冻结、WAGES_DUE 持久可见、无工资行的更正也拒绝；支付待 D2 |
| V27 | PG 待审补登后撤回/驳回、带待审恢复、一次通知；自动失效路径同步接入并经变更领域整批测试，未另称浏览器自动失效通过 |
| V28 | PG 连续资料改版及单测已完成外协改价保留原时间、不重复通知；真实新增量仍待完成；销售 DTO 保持隔离 |

## 未决规则与发布边界

- D2：原日已结算后的漏付工资，当前能保存原事实和 WAGES_DUE，但未实现补差支付；不得称“已补发”。
- 同一批实物已包含在后续登记，但登记跨日：当前同日守卫保留，界面提示不能冒充额外生产或未生产；记录仍待核对。待业务确认工资日期处置后再实现。
- 多次真实生产总量超过当前订单数量时取消：对客结算算法尚待选择，当前保守拒绝；不把师傅真实工资压回订单数量。
- 已核定完成数量参与成品承接；报废/次品没有新增独立模型。没有接入多人分产、打包扫码或新的生产进度。
- 生产环境清单/恢复、维护窗口、真实通知、durable worker 与实体扫码设备未验证。当前本地变更不能标为整批无条件发布通过。


## 普通本地开发库与开发服务器

已核对目标为 localhost 的 `print_shop_erp`：修改前 175 项迁移、ProductionJob 0 条。先用 pg_dump custom 备份并用 pg_restore --list 检查清单（文件权限 0600），再仅应用本任务四项前向迁移。修改后 179 项迁移、ProductionJob 与 ProductionFactReview 均为 0；没有需要在此库人工恢复的生产记录。备份及日志保留在任务临时目录（print_shop_erp-before-production-facts.dump / local-forward-migrations.log），未进入 Git，也未写入测试订单。

`pnpm dev --hostname 127.0.0.1 --port 3000` 已启动，/login HTTP 200。启动时 Next 提示清理既有 Turbopack 错误缓存，首次编译后页面正常返回。用户实际账号会话及真实生产环境未作为自动化写入目标。

冻结候选的全量覆盖率：statements 86.15%、branches 80.15%、functions 91.43%、lines 88.54%；所有既有阈值及新增 completion-wage.ts 的四项 100% 门禁通过。唯一测试失败仍为基线 drafts.test.ts:74，旧定价迁移超时和完成通知失败均未在最终整批复现。

最终文案复查：将历史包含失败时“其他情况请核定额外生产”改为“资料不匹配时请保留核对，不能把同一批产量重复登记”，避免跨日同批实物被引导为双薪。发生于全量/Claude 定向复核后，仅调整该错误文案；另跑 38 条 PostgreSQL 恢复回归与 UI 文案门禁，结果分别见 final-copy-pg-38.log、final-ui-copy.log。


收尾结果：最终六视口 6/6 通过（4.8 分钟）；38 条 PostgreSQL 文案后复验通过（59.91 秒），UI 文案/token 门禁无新增违例。隔离库共享大量追加 fixture 的一次浏览器运行在发布等待处超时（当时 1 通过、1 失败、4 未运行），trace 显示提交仍在处理；切换独立浏览器库、保持相同代码及全部断言后六项通过，未加 sleep、force click 或放宽任何断言。最后运行日志无 JWTSessionError；历史开发会话关闭后异常没有复现。

普通开发库恢复命令的只读执行已通过，清单为 unreleasedRework=[]、jobs=[]；没有自动恢复、删除或改写业务工资。文档 173 个本地路径及本地锚点检查通过，git diff --check 通过。最终仅本任务 84 个明确路径进入提交；无关文档、旧浏览器记录、环境文件、备份及生成物保留在索引之外。

主要纯文本验证证据另复制到忽略目录 `output/production-remediation/evidence/`；本地备份仍留在权限受限的任务临时目录。
