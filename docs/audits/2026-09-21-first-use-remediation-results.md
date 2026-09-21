# 首次真实使用就绪整改执行记录

## 范围与起点

- 作业书：[整改指令](2026-09-21-first-use-remediation-brief.md)；配套[审查](2026-09-21-first-use-readiness.md)。
- 起点 `1021a604`，分支 `codex/maindev`；比较基线只用 `origin/main`（`ef6fa012`）。
- 起始工作区只有上述两份未跟踪文档；它们不属于本次新增内容，保留原样。
- 未连接生产、未 SSH、未推送、未部署、未运行业务 seed 脚本、未在业务库发布价格或工价。测试夹具仅写入隔离测试库。

## 批次进度

### 批次 1：漏算摘要

- 三个任务返回新增 `failed` 和去重字符串数组 `errorCodes`，保留 `errorCount`；日薪成功返回增加 `failed: 0`。
- 领域返回的 errors 只有 message 和业务标识，没有细分 code。因此使用任务级类别码，避免将人员/客户信息或错误正文写进公开 cron 响应。
- 新增三条回归：每批两条错误时，运维摘要必须非 null、包含 `failed=2`，旧计数仍为 2，错误码只有一个。
- 先红：`pnpm test run lib/cron/__tests__/partial-batch.test.ts`，3 失败 / 5 通过；三条均为 `expected null not to be null`。原始日志 `/tmp/first-use-b1-red.log`。
- 同步更新路由精确响应断言及 API 契约；未将 `toEqual` 降成宽松断言。
- 转绿：`pnpm test run lib/cron app/api/cron lib/background-jobs/__tests__/result-summary.test.ts`，8 文件 / 57 项通过、0 失败。日志 `/tmp/first-use-b1-green.log`。
- 状态：用户授权直接在当前分支继续后，完整门禁通过，批次 1 已具备提交条件。

### 批次 1 门禁与环境阻碍

| 检查 | 实测结果 | 证据 |
|---|---|---|
| `pnpm check:architecture` | tsx 启动器创建 IPC 管道被拒，`listen EPERM` | 当前执行沙箱限制 |
| 同一检查 `node --import tsx scripts/check-architecture.ts --check` | 通过；1,022 模块、4,121 内部依赖、25 项既有超长函数债务 | `/tmp/first-use-b1-architecture.log` |
| `pnpm test:backup` | 23 通过、0 失败 / 跳过 | `/tmp/first-use-b1-backup.log` |
| `pnpm lint` | 0 错误、3 条既有警告；文案和令牌门禁通过 | `/tmp/first-use-b1-lint.log` |
| `pnpm typecheck` | 通过 | `/tmp/first-use-b1-types.log` |
| 全量 `pnpm test run` | 尚未输出 RUN / 用例计数；确认数据库连接被沙箱拒绝后主动停止，退出 130，不能算通过或用例失败 | `/tmp/first-use-b1-full.log` |
| 本机数据库只读连接检查 | `pg.Client` 连接阶段 `EPERM`，嵌套 IPv4/IPv6 均为 `EPERM`，未能执行 `SELECT 1` | 工具执行记录；未输出凭证 |

全量命令只从 `.env` 提取 DATABASE_URL 并去掉单双引号，没有 source `.env`，
没有导出 BACKGROUND_JOBS_MODE；先确认地址为 localhost 后才尝试连接。
本批不涉及 UI 或迁移，因此未运行浏览器、六视口或迁移链检查。
依照作业书 §10“每次 commit 前必须全绿”，保留改动，停止后续批次；没有以跳过 PostgreSQL 测试替代全量通过。

### 当前分支直接续做（2026-09-21）

用户明确授权在当前 `codex/maindev` 分支直接修复，接续起点 `1021a604`。接手前差异保存在 `/tmp/first-use-direct/initial.patch`；上面的沙箱失败是前一次执行记录，未改写。

本次完整门禁：`pnpm check:architecture` 原命令通过；`pnpm test:backup` 23/23；`pnpm lint` 0 错误/3 既有警告；`pnpm typecheck` 通过；全量 `pnpm test run` **684 文件通过/4 既有条件跳过，7,487 项通过/54 既有跳过，0 失败**。仅用 dotenv 解析本地 `.env` 的 DATABASE_URL，未 source 整份环境，并确认 localhost 后运行；日志在 `/tmp/first-use-direct/b1-{architecture,backup,lint,types,unit}.log`。相对作业书 7,484 基线，新增的三条回归全部通过。

### 历史暂停记录（已由下文继续执行记录取代）

当时尚未修改。预读批次 4.1 发现下述实质前提冲突，按作业书 §1.6、§11 停止后续实现；先独立提交已经完整验证的批次 1。B 类选项维持下文，不改相关业务代码。

## 与作业书事实不同的发现

**批次 4.1：无计件进度没有可照搬的车道过滤。**

- `lib/production/operation-portal.ts:526` 明确写着所有在职 worker 可见无计件进度、没有分配限制；列表的 `assertActiveProgressReporter` 只核验在职 WORKER，查询没有 operationType / worker / capability 谓词。
- 同文件 `:603` 的详情注释明确为无 worker、capability、machine 谓词。`lib/production/__tests__/operation-portal.test.ts:104` 允许 cleaner 读取无计件进度，并在 `:118` 断言没有上述过滤；详情在 `:154` 允许 packer 读取 GLUING，并在 `:169` 保留同样的负向断言。
- 计件工序详情则已经调用 `getReporterOperationType`；没有固定计件岗位的账号会被拒绝。作业书“任何 WORKER 含无车道 CLEANER/COOK”不能一概套到这条计件读取路径。
- 两个详情缺少列表同款工单状态限制仍然成立，但“无计件详情补车道过滤”会改变现有明确行为，需要先确定采用“保持所有在职 WORKER 可见、只补状态”还是建立无计件工艺的岗位映射。未擅自改测试或新增岗位规则。

另有编号冲突：§1.4 指定唯一迁移在“批次 6”，详细授权实际在批次 5.3；后续仅按 5.3 的范围实施并验证。

## B 类选项（仅供业主决定，未改代码）

### B1：老板首页财务卡片

- 选项 A：改读 v2，按 CONFIRMED / PAID 展示整单未收与已收；不支持部分收款。
- 选项 B：先设计付款流水与部分收款，再接财务卡片；需要额外模型、迁移和对账验收。
- 影响：A 成本小但必须明确整单口径；B 可表达真实分次收款。决策前可另行决定是否撤掉旧卡，避免零值误导。

### B2：同车道报他人的活

- 选项 A：保留“谁报谁得”，在 SPEC 和师傅操作说明写明换班接力口径。
- 选项 B：跨认领人报工增加复核标记与可申诉路径。
- 影响：A 操作快但依赖现场管理；B 增加复核工作，需要决定复核前是否计薪，不能只加人员过滤。

### B3：师傅打印页个人信息

- 选项 A：确认车间需要打印快递资料，保留现有信息可见性。
- 选项 B：按岗位/用途拆分车间工单与物流打印权限，非物流用途隐藏收货信息。
- 影响：A 方便贴单；B 减少接触个人信息，但需要确定谁负责贴单及异常代班权限。

### B4：直营与内部销售应收

- 选项 A：维持仅外部销售进入代理商应收，内部/直营继续按现有流程管理。
- 选项 B：建立内部/直营的应收与收款入口，并决定与代理商账单如何区分。
- 影响：A 不扩展财务范围；B 能显示内部欠款但涉及业务归属、付款人及 B1 卡片口径，不能仅伪装成外部销售。

### B5：缺少加班倍率

- 选项 A：缺 OT_MULTIPLIER 时拒绝结算，要求管理员补齐生效规则。
- 选项 B：明确批准 1.0 为第二个兜底例外，并在规则说明和测试中登记。
- 影响：A 防止默认值影响工资但可能阻塞月结；B 连续可用但意味着业主认可缺规则时不加成。

### B6：CDR 下载凭证

- 选项 A：接受当前链接即凭证、24 小时过期且不能吊销的模型，本轮只更正注释。
- 选项 B：另立迁移加入密码学随机 token，并设计吊销、旧链接兼容及限流。
- 影响：A 无迁移但保留已知风险；B 提升凭证强度和处置能力，需要额外 schema 与交互验收。

### B7：客服可选全部客户

- 选项 A：认可跨客服选客户是建单需要，保留当前资料目录可见性。
- 选项 B：限定客户归属或拆分“最小可选信息”和“完整资料读取”权限。
- 影响：A 支持共享客户服务；B 减少信息暴露，但要处理客户交接、重复建档与新客户分配。

### B8：取消单入账（存疑）

- 选项 A：允许已结算后取消的工单保留应收，明确何时冲销及冲销依据。
- 选项 B：取消单不进入新账单，历史已入账项另走冲销流程。
- 影响：目前未构造反例；应先确认取消是否代表免除债务，不能直接删除 CANCELLED 谓词导致漏收。

### B9：总额含运费/耗材口径（存疑）

- 选项 A：统一使用 includesShipmentCharges 条件口径。
- 选项 B：明确 totalAmount 包括全部相关流水，并调整其他入口及展示口径。
- 影响：需先复现真实入口并明确对客应收与成本分账含义，再统一函数；不同选择会影响对账，不能凭代码简洁程度决定。

### B10：四个兼容状态

- 选项 A：保留历史读取与转换兼容，注明当前不再生成这些状态。
- 选项 B：另行制定历史状态映射与收缩计划，再删除转换及 UI 分支。
- 影响：A 维护成本较高但保障历史行；B 简化运行时，需要历史数据盘点、迁移和公开入口兼容验证。

### B11：历史实现与孤儿组件

- 选项 A：保留 archive archaeology 实现，明确不作为现行规则参考。
- 选项 B：确认归档价值已由 Git 历史或专门文档承接后，再独立清理。
- 影响：A 保留考古上下文但容易误读；B 降低维护负担，须按引用、运行时消费方及测试证据审查，不能只依据 grep 无命中。

## 继续执行记录

业主要求继续直到修复完成：批次 4.1 按前述建议保留无计件进度对所有在职 WORKER 的可见性，只补状态限制；迁移范围按具体的批次 5.3 执行，编号笔误不扩展授权。B 类不变。

### 批次 2

已更正八项文档/注释事实：生产 ef6fa012 / 160 迁移、10 个 cron、旧 TaskStatus 与新运行时区别、当前生产禁止 update.sh 且 check-applied 已无法防误用、CDR cuid 与预签名安全模型、09-11 前置清单的历史属性。HANDOFF 当前任务小节逐字保留，未操作生产。

验证：架构、备份 23/23、lint（3 既有警告）、类型通过；完整单测 7,487 通过/54 既有跳过，0 失败（`/tmp/first-use-direct/b2-*.log`）。本批只改事实描述，无业务行为变化，不适用红绿测试。

### 批次 4

- 4.1：详情遗漏列表状态谓词；有计件/无计件详情补相同状态范围，保留无计件对所有在职 WORKER 的既有可见性（前提差异见上文）。
- 4.2：归属检查顺序泄露他人状态；移到所有业务状态检查之前。
- 4.3/4.5：删除零调用的跨销售申请列表导出及 material:issue 空授权；调用链搜索仅找到定义/字典与基线或测试，无运行时注册消费者；同步死代码基线。
- 4.4：计件详情的可选 reporterId 能绕过行过滤；改为必填 actor，WORKER 强制 own-only、ADMIN 明确全量，缺 actor/其他角色先拒绝。
- 4.6：资料事务与 action 审计分离；将 before/after 与审计移入 updateParty 的同一事务。原实现已有资料事务，不是作业书所述的单条隐式事务，但审计缺口成立。
- 4.7：CDR handler 与任务失败处理器重复写失败态；统一在租约校验后的任务事务内处理，终态拒绝执行，上传落库限定 PENDING，防迟到结果复活 FAILED。
- 4.8：15 张 sheet 的逐行读取走全局池；改为同一个 RepeatableRead tx，成员 manifest 与所有 sheet 读取同快照，沿用月账单导出的事务预算。现有 workbook 测试覆盖全部 sheet 与输出；尚不将测试 fixture 的耗时当作生产大批量容量证明。
- 4.9：9 处适配层补实际授权函数注释，CLAUDE 登记第 4 类模块。

红绿证据：原实现下 4 个新增断言失败（`b4-red.log`）；目标集 548 项通过。真实 PostgreSQL 独立 schema 制造 BusinessAuditLog CHECK 失败，确认触发 reject_test_audit 且 Party 名称回滚；schema 最终删除。全量并发时首次该集成测试 5s 预算不足，改为包含建表/清理的 30s 独立预算，未削弱断言。两个 worker 调用断言同步必填 actor 契约。最终架构、备份 23/23、lint、类型全绿；完整单测 7,497 通过 / 54 条既有跳过 / 0 失败，25.61s（`/tmp/first-use-direct/b4-final-*.log`）。

### 批次 3

smoke 增加只读全库无效索引检查，拒绝任何无效索引，额外标记通知去重依赖；cron runner 严格解析 created/requeued 区分 queued 与 skipped，畸形响应失败；月结改 00:10，账单保留 00:40。同步部署指南。

红绿：旧调度新增断言 1 失败/20 通过（b3-red.log）；脚本目标 40/40。真实本地 PostgreSQL 无效索引查询 8ms，通过。全量架构、备份 23/23、lint、类型通过；7,504 单测通过/54 既有跳过/0 失败，29.20s（b3-final-*.log）。未跑生产 smoke、未调用真实 cron。8 个 cron 应用时钟改数据库时钟仍按授权留 TODO。

### 批次 7

分项先舍入、费率先求和造成 -0.01 固定费，使有效报价失效。保持分项总额为准，仅在固定费为负时反推向下保留四位单价，再用两位固定费补足；页面 DTO、保存快照与库小计相同，导出沿用库的 unitPrice/fixedFee/subtotal。示例 122.00 保存为 0.1207 × 1010（按分舍入 121.91）+ 0.09。原始费率和分项快照保持 0.1004 / 0.0204 / 101.40 / 20.60。不完整报价追加款式、数量、单价、小计与差额诊断，建单空原因有兜底。

红绿：真实纯引擎套用反例，旧实现 1 失败/8 通过（b7-red.log），修复后的报价/导出目标 756 通过/1 条环境依赖跳过。既有 PARTIAL_BLANK 0.13 × 1000 + 40 = 170 用例不变。架构、备份 23/23、lint、类型通过；最终全量 7,506 通过/54 既有跳过/0 失败，59.45s（b7-final-unit.log）。类型检查发现测试修改只读 fixture，已用不可变构造修复，未改生产 DTO 的 readonly 约束。

### 批次 6

v2 候选读取缺少守恒检查、旧 cron 适配器又固定返回 errors=[]；现用 Decimal 核对加工费＋逐项收费＝总额＝settledFee，非法/缺失金额拒绝。按工单号记录错误，整张问题销售的当月账单不创建、不删改成员，其他销售可继续；手动确认调用同一读取器也先失败，不会删草稿成员。内部 errors 经旧契约 salesUserId 映射流向 failed/errorCount，手动生成不再报纯成功。未改取消单准入、费用口径、旧实现或历史冻结金额。生成器原本是一笔整体事务，不是逐代理商独立事务，保留现有边界。

红绿：旧实现下 5 条新增断言失败/5 通过（b6-red.log）。修复后账单/cron/action 82 项通过，追加隔离销售与手动确认两项通过。全量首次发现 mockResolvedValueOnce 队列跨测试残留（异常用例提前拒绝不消费原 mock）；修正测试重置后，全量 7,514 通过/54 既有跳过/0 失败，40.24s。架构、备份 23/23、lint、类型通过（b6-*.log、b6-final-unit.log）。

### 批次 5

- 5.1：默认池与事务等待预算隐含、心跳另借连接可能耗尽池；显式 web 25 / worker 5、连接等待 10s、事务 maxWait 15s / timeout 20s，环境覆盖优先于 URL。worker 启动检查容量至少为并发两倍；保留独立心跳与现有锁粒度。建单、报工及扫码认领在授权查询和业务写入阶段识别 P2024/P2028，只返回繁忙信息，不吞权限错误。数值是工程默认值，生产连接 URL / 并发配置仍须业主复核。
- 5.2：每次 SSR randomUUID 导致刷新失去幂等性；服务端依据工序、会话人员、数量（含工单件数进度）、上海日期和显式批次序号派生 SHA-256。URL 中 reportBatch 保持刷新一致；“再报一批”递增序号并重新挂载表单。保留旧客户端键兼容、确认步骤与权限检查。
- 5.3：两个报工表缺数据库代次保护；唯一新迁移先取得同款 order-cascade 锁，再核对父工序与工单代次。新 REPORT 受保护，历史 REVERSAL/ADJUSTMENT 继续由原有锚点、管理员及结算触发器约束；一刀切拒绝旧代次会阻断现有工资核定，是审查中新发现的前提差异。
- 5.4：动画快照与布局采样时机不稳定；等待字体、当前有限动画及连续两帧几何稳定后测量。SalesWorkbench fixture 使用真实 admin-viewport 并设置系统减少动态效果；44px 门槛不变、无 force click。全量首次 807 通过 / 1 失败：17 场景单用例在并行 UI 编译时触及原 15s 预算，已按类别拆分，所有场景和断言保留，预算未提高。

迁移证据：一次性库 `first_use_test_20260921_1789983546084` 完成 158→161、161 条全部 applied；新增 SQL 再执行两次成功；库已 DROP。真实 PostgreSQL 回归在无触发器时旧代次插入成功导致断言红，安装触发器后拒绝旧代次、允许当前代次与合法历史财务入口；隔离 schema 清理完成。

UI 环境为本地数据复制出的独立可丢弃库，未执行 seed 命令或发布受保护规则。首次服务器受到已有 :3000 开发锁阻挡；独立运行后 Turbopack 恢复旧缓存发生 Rust panic，隔离缓存重新执行。不能将这两次失败记为页面通过。计薪端到端用例因隔离库没有当前有效计件工价而缺前置；本轮禁止发布工价，故保留用例并明确跳过，不宣称已完成工资端到端验收。


批次 5 红绿补充：池预算回归在旧实现下 1 失败 / 3 通过（`b5-red.log`）；触发器回归见 `b5-migration-red.log`；修复后核心集 128 项通过。新增授权阶段繁忙测试与原 action 集共 114 项通过。真实页面无计薪报工验证：首次 1 条 → 刷新重提仍 1 条 → “再报一批”后 2 条，1 项通过 / 1 项计薪前置缺失跳过（`b5-refresh-e2e.log`，51.9s）。

管理端全六视口：首轮 112 通过 / 4 超时 / 10 限定视口跳过，18.6 分钟；缓存就绪并停止并发单测后，4 个失败项使用原断言和原 360s 预算重跑全部通过，1.4 分钟。合计 116 项验证通过，10 项分别为仅 1280 执行的容器几何用例和仅 393 执行的移动筛选用例在其他视口的有意跳过。保留首轮日志，未更新截图基线或放宽断言。

## 提交序列与文件清单

顺序按作业书执行；全部为当前分支的本地提交，未推送。

### 批次 1 · `899fd8ed`

fix(cron): 显示结算批次漏算数量（SPEC §3.7 / §3.9 / §J.1）

- `API.md`
- `app/api/cron/__tests__/notification-wire.test.ts`
- `docs/audits/2026-09-21-first-use-remediation-results.md`
- `lib/cron/__tests__/partial-batch.test.ts`
- `lib/cron/tasks.ts`

### 批次 2 · `2daf64ab`

docs(readiness): 更正生产与安全模型说明（SPEC §3.5）

- `CLAUDE.md`
- `DEPLOYMENT.md`
- `HANDOFF.md`
- `app/api/cdr/bundles/[id]/route.ts`
- `docs/audits/2026-09-21-first-use-remediation-results.md`
- `docs/上线前置操作清单.md`
- `docs/部署指南.md`
- `lib/cron-auth.ts`
- `lib/production/status-machine.ts`
- `scripts/check-env.mjs`

### 批次 4 · `b99202ba`

fix(security): 收紧详情读取与审计导出边界（SPEC §3.5 / §3.9）

- `CLAUDE.md`
- `actions/__tests__/owner-parties.test.ts`
- `actions/admin-order-edit.ts`
- `actions/owner-materials.ts`
- `actions/owner-parties.ts`
- `app/(admin)/owner/salary/piecework/[id]/page.tsx`
- `config/dead-code-baseline.json`
- `docs/audits/2026-09-21-first-use-remediation-results.md`
- `lib/__tests__/order-design.test.ts`
- `lib/__tests__/party-audit.postgres.test.ts`
- `lib/__tests__/party.test.ts`
- `lib/__tests__/worker-portal.test.ts`
- `lib/auth/__tests__/permissions.test.ts`
- `lib/auth/permissions-dict.ts`
- `lib/background-jobs/__tests__/repository.test.ts`
- `lib/background-jobs/cdr.ts`
- `lib/background-jobs/repository.ts`
- `lib/cdr/__tests__/bundle.test.ts`
- `lib/cdr/bundle.ts`
- `lib/order-design.ts`
- `lib/order/__tests__/export.test.ts`
- `lib/order/change-request.ts`
- `lib/order/export.ts`
- `lib/party.ts`
- `lib/production/__tests__/operation-portal.test.ts`
- `lib/production/operation-portal.ts`
- `lib/salary/__tests__/piecework-settlement.test.ts`
- `lib/salary/piecework-settlement.ts`
- `lib/worker-portal.ts`

### 批次 3 · `07d07b9a`

fix(deploy): 阻断无效索引并识别重复调度（SPEC §3.7 / §J.1）

- `deploy/crontab.example`
- `deploy/run-cron.sh`
- `docs/audits/2026-09-21-first-use-remediation-results.md`
- `docs/部署指南.md`
- `lib/__tests__/cron-deployment-config.test.ts`
- `scripts/__tests__/deploy-index-gate.test.ts`
- `scripts/deploy-smoke.mjs`

### 批次 7 · `c6ccff2a`

fix(pricing): 保留分项舍入总额并消除负固定费（SPEC §8）

- `docs/audits/2026-09-21-first-use-remediation-results.md`
- `lib/order.ts`
- `lib/order/__tests__/create-order-quote-presentation.test.ts`
- `lib/order/create-order-quote-presentation.ts`

### 批次 6 · `86603e71`

fix(billing): 月账单入账前核对金额并报告漏算（SPEC §J.1）

- `API.md`
- `actions/__tests__/agent-monthly-bill.test.ts`
- `actions/agent-monthly-bill.ts`
- `docs/audits/2026-09-21-first-use-remediation-results.md`
- `lib/agent-monthly-billing/__tests__/cron-cutover.test.ts`
- `lib/agent-monthly-billing/__tests__/generation.test.ts`
- `lib/agent-monthly-billing/generation.ts`
- `lib/agent-monthly-billing/types.ts`
- `lib/bill.ts`

### 批次 5 · 本报告所在提交

- `.env.example`
- `API.md`
- `DATABASE.md`
- `actions/__tests__/order.test.ts`
- `actions/__tests__/production-operations.test.ts`
- `actions/order.ts`
- `actions/owner-parties.ts`
- `actions/production-operations.ts`
- `app/(worker)/__tests__/worker-task-legacy-dispute.test.tsx`
- `app/(worker)/worker/tasks/[id]/page.tsx`
- `components/business/order/__tests__/ReworkOrderForm.browser.spec.tsx`
- `components/business/production/OperationReportForm.tsx`
- `components/business/production/__tests__/OperationReportForm.browser.spec.tsx`
- `components/business/workbench/__tests__/SalesWorkbench.browser.spec.tsx`
- `docs/audits/2026-09-21-first-use-remediation-results.md`
- `docs/部署指南.md`
- `lib/__tests__/database-session.test.ts`
- `lib/database-errors.ts`
- `lib/database-session.ts`
- `lib/db.ts`
- `lib/production/__tests__/report-generation.postgres.test.ts`
- `lib/production/__tests__/report-idempotency.test.ts`
- `lib/production/report-idempotency.ts`
- `prisma/migrations/20260921100000_production_report_generation_guard/migration.sql`
- `prisma/schema.prisma`
- `scripts/__tests__/background-worker-runtime.test.ts`
- `scripts/background-worker-runtime.ts`
- `scripts/background-worker.ts`
- `tests/browser/wait-for-layout.ts`
- `tests/e2e/production-operation.spec.ts`
- `vitest.browser.config.ts`


## 最终验收结果

候选为 `86603e71` 加上本报告列出的批次 5 增量，分支 `codex/maindev`。批次 1→2→4→3→7→6→5 的授权代码修复均已实现；B 类 11 条未改，选项见上文。计薪真实报工 E2E 缺生效工价，不能声称全部端到端验收清零。

| 门禁 | 最终结果 | 证据（本机） |
|---|---|---|
| architecture / backup / lint / typecheck | 全部通过；备份 23 项，lint 3 条既有警告 | `/tmp/first-use-direct/b5-complete-{architecture,backup,lint,types}.log` |
| 完整单测与覆盖率 | 688 文件、7,539 项通过；4 文件/54 项既有跳过；0 失败，33.87s | `b5-isolated-unit.log` |
| 覆盖率 | statements 86.15%、branches 80.24%、functions 91.82%、lines 88.10%；全部水位门禁通过 | `b5-isolated-unit.log` |
| 全量浏览器组件 | 51 文件、813 项全部通过，52.01s | `b5-isolated-browser.log` |
| 管理端六视口 | 116 项通过；10 项原有视口限定跳过；4 个冷编译超时项原样重跑通过 | `b5-admin-ui.log`、`b5-admin-ui-retry.log` |
| 师傅端六视口 | 12 项全部通过，1.1 分钟 | `b5-worker-ui.log` |
| 刷新报工真实页面 | 不计薪 1 项通过；计薪 1 项缺工价前置跳过 | `b5-refresh-e2e.log` |
| 增量迁移 | 隔离库 158→161、重复执行通过，库已删除 | `b5-migrate-158.log`、`b5-migrate-161.log` |

并行负载下全量单测曾出现 4 项超时（7,535 通过），串行重跑全量并开启覆盖率后 7,539 全部通过，未提高原有预算。新增端到端夹具曾遗漏 foilTechnique、scheduledAt 及 UTC 会话，已按真实约束补齐；未修改应用校验来迁就夹具。测试采用 next dev、mock 通知及 inline jobs，只证明本地指定链路，不代表生产构建、真实推送和 durable worker 发布验收。

隔离 UI 库 `first_use_ui_test_20260921_1789983657118` 已 DROP，包含测试生成的不可变报工事实；真实业务库未写入这些夹具。开发服务器已恢复 :3000，`/orders` 未登录响应 307。未 push、未部署、未改生产配置；导出大批量容量尚无生产规模实测，连接池工程默认值须在发布前复核。
