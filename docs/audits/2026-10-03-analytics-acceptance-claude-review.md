# Analytics 后续验收：Claude Code 对抗审查

本轮基线 `2850f39e`。CLI 2.1.288，实际模型 `claude-opus-5-5`；只读 Read/Grep/Glob，关闭 hooks、MCP、浏览器与写权限。用户要求 >9/10；首轮未达标不能放行。

## 第一轮：8.8/10，FAIL

`is_error=false`，`subtype=success`；178258ms，49 turns。源码清单为 acceptance 报告的第一轮九文件清单。以下为原文。

# 生产派工页资料不完整修复：对抗审查结论

## 评分：8.8 / 10，**FAIL**（未达到 >9）

核心修复是对的：
- 异常类型分得准确：页面只捕获资料不完整这一种错误，数据库等其他异常照常抛出，不会被当成空数据。
- 混合批次整批阻止，不会悄悄只发布其中一部分。
- 页面权限守卫没有改动，派工、工价、写入的计算也没有改动。

扣分的原因有一个：说明第 1 条写的"保留 error.message 以维持写调用方语义"不成立。message 字符串确实没变，但写入路径上的 action 判断"能不能把原因显示给用户"时看的是错误类型，不是 message，所以换成子类后，用户在写入时看到的提示变了。这个变化既没写进说明，也没有测试覆盖。

## 分级发现

**P0 / P1：无。** 我沿以下几条线逐一核对过，没有发现问题：
- **权限**：页面第 11–12 行的 `requirePermission('production:manage')` 和 ADMIN 判断原样保留；写入时 `dispatch.ts:33` 还会在事务里重新查库确认管理员身份。
- **事务原子性**：`publishProductionDispatch` 整批在一个 `$transaction` 里完成，`currentDispatchTargets` 在第 46 行先于任何写入执行。新错误抛出时整批回滚，不会只写进一部分。
- **数据与金额**：`dispatch-plan.ts:26` 之后的计算、指纹和快照都没有改动。
- **信息泄露**：页面上的 issues 只用固定中文文案，并只提取"款式 #N / 包装组 #N"作为前缀，不会显示工艺编码、CUID 或 "canonical"。原始诊断只留在 `error.message` 里。新增的单测和 E2E（`not.toContainText('canonical')`）都覆盖了这一点。

**P2-1：写入路径上用户看到的错误原因退化成通用提示，没有测试，也和说明不符**

- **位置**：`actions/production-dispatch.ts:29`。这里只有 `error.constructor === Error` 时才把 `error.message` 显示给用户。`DispatchPlanValidationError` 是子类，不满足这个条件，于是落到第 30 行的「本次未保存，请刷新核对后重试」。
- **会受影响的调用链**（都经过 `currentDispatchTargets → dispatchTargets`，这些 action 都用同一个 `failure()`）：
  - `recovery-projection.ts:9` 的 `reconcileResolvedHistoryInTx`。它被以下写入入口调用：
    - `completion-registration.ts:117`：历史任务驳回
    - `completion-registration.ts:171`：RECOVER 补登
    - `fact-review.ts:40`：INCLUDED_LATER
    - `fact-review.ts:65`：UNPRODUCED
  - `dispatch.ts:46`：发布排单。这一处在第 47 行 revision 校验之前执行。
- **触发条件**：当前版本的工单资料不再能生成计划。一个现实的例子是：工单下发后，管理员停用了它用到的工艺（`lib/craft.ts:177`，停用没有任何引用保护）。之后再做历史核对或补登时，就会走到这条路。
- **影响**：
  - 以前管理员会看到「款式 #2 引用的历史工艺 X 已停用，拒绝自动投产」。现在只看到「请刷新重试」，刷新也不会好，而且核对页不会给出原因。
  - 数据仍然安全，整个事务都会回滚。
  - 发布排单那条路影响较小：刷新后派工页会显示新的阻止说明。真正卡住的是历史核对和补登这几个入口。
- **测试缺口**：`actions/__tests__/production-dispatch.test.ts` 只测了 SQL 类普通 Error 会被转成通用提示，没有测新错误类型在 action 里的映射。
- **没有影响的路径**：
  - `planned-completion.ts:102` 也用同样的类型判断，但 BACKFILL 不会走到 reconcile（历史任务在 `completion-registration.ts:104` 已经提前抛出），所以没有退化。
  - `revision-jobs` 的两个入口在 `operation-materialization-service` 里，资料已经先校验过，这个错误实际上不会出现。

**P3（不阻断）：**
1. `dispatch-plan-error.ts:3` 的 `ISSUE_COPY` 用的是 `Record<string, string>`，编译期不会检查每个错误码都有文案。以后新增错误码会悄悄落到通用文案（这个行为有测试覆盖）。建议改成两个错误码类型的并集作为 key。
2. PACKAGING_QUANTITY_MISMATCH 中「款式 <CUID> 按每袋…」这种 message 不以「款式 #N」开头，所以显示时没有款式编号，用户不知道是哪一款。
3. 这是改动之前就有的问题：URL 里如果有已删除或不存在的工单 id，会抛普通 Error 导致整页报错。混合批次里只要有一个失效 id，就会出现这种情况。

## 最小必修项（要到 >9 分）

1. 在 `actions/production-dispatch.ts` 的 `failure()` 里，在第 29 行之前加一个分支，专门处理 `DispatchPlanValidationError`，例如返回 `` `${error.order.name}：${error.issues.join('；')}` ``。这样用的是安全的中文文案，比改动前直接显示原始 message 也更安全。
2. 在 `actions/__tests__/production-dispatch.test.ts` 里补一条用例：publish 抛出这个错误时，返回的提示包含工单名和对应中文原因，并且不包含工艺编码或 "canonical"。
3. 把说明第 1 条更正为写入路径的真实行为。

## 生产部署放行结论（独立判断）

- **本地候选的代码**：修完 P2-1 之后可以交付。目前这一项属于功能质量问题，不是安全问题，也不会造成数据损坏。
- **目标环境的前置条件**：
  - 以下几项都还没在目标环境验证：目标环境 smoke、系统 Chromium 和环境配置、备份恢复演练、真实通知和 CDR 的连通性。
  - 本地 mock 和隔离库的测试不能代替这些验证；发布负责人要拿实际的 release SHA 逐项核对。
  - 这些是外部前置条件，不算本轮代码的缺陷。
- **综合**：不能放行。先修 P2-1 并复审，再加上目标环境前置条件都满足之后，才能发布。

## 测试证据的可信范围

我读到的证据：
- `dispatch-red.log` 证实修复前抛的是普通 Error，message 与现在相同。
- `dispatch-target.log` 中 3 个文件 9 项通过；`coverage.log` 和 `unit.json` 显示 8640 通过、0 失败、46 跳过，覆盖率阈值没有失败。
- `dispatch-visual.log` 9 项通过，`dispatch-normal.log` 6 项通过。
- 两张截图都已检查：1280 深色和 320 浅色下，层级、长名称折行、聚焦边框都正常。

可信的部分：
- 领域层：真实调用 `dispatchTargets` 来验证资料校验错误的分类和文案脱敏，不是用 mock 自己证明自己。
- E2E：在生产构建、隔离库里用真实缺失数据跑过，验证了没有表单、没有发布按钮、链接能把用户带回详情页，九个视口明暗两种主题都过了 axe 和溢出检查。

覆盖不到的地方：
1. 页面单测和 `dispatch-page` 单测把 `currentDispatchTargets` mock 掉了，只能证明分支逻辑，真实路径要靠 E2E 补上。
2. E2E 断言「ProductionJob 为 0」时什么都还没提交，这个结果本来就成立，不能证明写入路径会拒绝混合批次。目前写入路径的拒绝是靠事务回滚在结构上保证的，没有针对混合批次的 postgres 写入测试。
3. 写入相关的 action 映射没有测试，也就是 P2-1。
4. 我没有执行命令，所以无法自己核对 `candidate.json` 里的 SHA256 是否和工作区一致。日志时间也只能说明顺序：单测 17:22、覆盖率 17:23，然后才是 E2E。

## 非阻断跟进

- 处理 P3-1 到 P3-3。
- 考虑在阻止页给出一个显式入口，例如「仅安排其余 N 张」，带上剩余的 id 跳转。这样不算静默局部发布，又能减少用户重新勾选。
- 补一条 postgres 写入测试：直接提交含资料不完整工单的 payload，断言整批回滚、返回的提示是安全的中文文案。


## 第二轮：9.3/10，PASS（最终）

实际模型 `claude-opus-5-5`，`is_error=false`、`subtype=success`；205088ms，51 turns。最终源码清单 SHA256 `61a35cefb9b015445cf16379a90cea8a25a25b14775e31e437da1b06d76a4b00`。以下为完整原文。

# 生产派工资料校验修复：终审结论

## 评分：9.3 / 10，**PASS**

我只用了 Read/Grep/Glob。没有执行任何命令，没有读 `.env`、`env.sh` 或数据库，也没有自己计算 SHA。分数按本轮读到的源码和日志重新打，没有沿用首轮的 8.8。

## P2-1 修复核对：已在所有受影响的 action 入口修复

**修复位置**：`actions/production-dispatch.ts:29`。新分支放在 `constructor === Error` 判断（第 31 行）之前，返回 `error.order.name：issues`。issues 是 `dispatch-plan-error.ts` 里 `ISSUE_COPY` 的固定中文文案，原始 message 不会出现在提示里。SQL 和未知错误仍然落到第 32 行的通用提示。

**入口覆盖**：我逐条追查了调用链。领域层（`completion-registration.ts`、`fact-review.ts`、`recovery-projection.ts`、`dispatch.ts`）里没有任何 `catch`，所以这个错误会原样传到 action，而这几个入口都用同一个 `failure()`：

| 写入入口 | 抛错位置 | action | 修复后 |
|---|---|---|---|
| 发布排单 | `dispatch.ts:46` | `publishProductionDispatchAction` | ✅ 有测试 |
| RECOVER 补登 | `completion-registration.ts:171` | `registerProductionCompletionAction` | ✅ 有测试 |
| 历史任务 REJECT | `completion-registration.ts:117` | 同上 | ✅ 和 RECOVER 共用映射，没有单独的用例 |
| UNPRODUCED / INCLUDED_LATER | `fact-review.ts:40/65` | `reviewProductionFactAction` | ✅ 测了 UNPRODUCED |

**师傅能否看到这条提示**：师傅的 COMPLETE 路径（权限 `task:report`）不会调用 reconcile，能走到这里的都需要 `production:manage`。所以工单名只会显示给管理员。

**其他同类判断都碰不到这个错误**：
- `planned-completion.ts:102` 不会调用 `currentDispatchTargets`。
- `revision-jobs` 的两个入口在 `activateProductionOperationsInTx` 之后才执行，这时计划已经用同一份事实校验过。
- `scripts/recover-production.ts:25` 是运维脚本，同样受物化前的校验保护。

**RED → GREEN 证据**：
- `action-red.log`：12 项里 3 失败 9 通过。失败原因正是收到了「本次未保存，请刷新核对后重试」，证明这 3 个用例确实能抓到原缺陷。
- `action-green.log`：2 个文件 14 项全部通过（12 项 action 测试 + 2 项错误分类测试）。

## 新 E2E 是否真实证明了批次原子性：是

我对照了 `dispatch.ts` 的执行顺序：
1. 服务端按 `id.localeCompare` 排序，测试用同样的方式排序，所以服务端先处理 `ids[0]`（有效单）。
2. `ids[0]` 是 CONFIRMED 状态，会在同一个事务里实际执行这些写入：
   - `releaseFactoryOrderInTx`：生成 ProductionOperation、改状态为 RELEASED、创建打印任务；
   - 创建 ProductionJob；
   - 更新 order 的 revision 和 simpleProduction；
   - 写 `PRODUCTION_ASSIGNED` 日志。
3. 之后处理 `ids[1]`，`currentDispatchTargets` 抛错。

测试断言两单的 status/revision/simpleProduction 和提交前完全一致，ProductionOperation、ProductionJob、`PRODUCTION_ASSIGNED` 都是 0。其中 ProductionOperation 只能由第一单的 release 产生，所以「为 0」只有在整个事务回滚时才成立。这弥补了首轮指出的「什么都还没写，断言当然成立」的问题。

**测到的是新代码**：`dispatch-write-selector-failed.log` 显示，selector 冲突那次失败里，alert 的可访问名称已经是安全中文原因。这说明生产构建里已经包含新的 action 分支。selector 失败是 Next 路由播报器 `__next-route-announcer__` 造成的严格模式冲突，不是业务失败；修正后断言内容没有放宽。

## 剩余发现

**P0 / P1 / P2：无。**

**P3（不阻断）：**
1. **两张测试单名称相同。** 两张 fixture 的 `customName` 都是「排单扫码验收」，所以提示文案本身证明不了失败的是第二张。「第一单已经写入后才回滚」要靠排序一致和代码顺序推出来，测试里没有直接观测。建议给两单不同的名称并断言第二单的名称；顺手可以加断言 OrderPrintJob 为 0、OrderLog 总数不变。
2. **action 提示只显示 `customName || orderNo`。** 同名工单之间无法区分，而派工页靠链接可以区分。可以考虑在提示里附上工单号。
3. **REJECT 和 INCLUDED_LATER 没有单独的 action 用例。** 映射与模式无关，风险很低。
4. **首轮 P3-1、P3-2 仍然存在**：`ISSUE_COPY` 仍是 `Record<string,string>`，PACKAGING_QUANTITY_MISMATCH 的提示仍没有款式编号。「仅安排其余 N 张」按钮按约定不在本次范围。
5. **流程**：工作区里 `docs/管理后台使用手册.md:145` 有改动，但不在 11 文件的 SHA 清单里，验收报告也没有提到。请确认是否属于本候选。

## 日志一致性：有三处需要说明，均不影响结论

- `typecheck-final.log` **失败了**（exit 2，报 `ProductionJobWhereInput` 不存在、隐式 any 等错误），而且涉及的都不是本次改动的文件。这和 E2E webServer 同时运行 `prisma generate` 造成的环境竞争一致。有效证据是 `typecheck-final2.log`，通过。
- `visual-lint-final.log` 是**空文件**。eslint 没有问题时就是零输出，所以和通过一致，但日志里没有退出码，我无法独立确认。
- E2E 日志中服务端多次出现 `The destination stream closed early`。首轮的 `dispatch-normal.log` 里也有，看起来是导航中断了流式响应，属于既有现象，不是本次引入的。但 Playwright 不会因为服务端错误判失败，建议以后单独确认。

其余日志都完整且互相一致：
- 覆盖率：779 个文件通过、3 个跳过，8643 项通过、46 项跳过，没有失败，也没有阈值报错。
- `unit-final.json`：`success:true`，失败数为 0。
- `release-build-final.log`：路由表完整，只有两条已知的 tracing 警告。
- E2E 结果：异常读取和复核后失效 18/18、正常派工 6/6、analytics/工作台/账单 10/10。
- lint 0 错误（2 条既有警告）；架构门禁通过。

`candidate-final.json` 和 `candidate.json` 对比：原有 8 个文件的指纹一致，spec 已更新，新增 2 个 action 文件，和描述相符。

## 证据范围与未执行项

- 这些检查**本轮没有重跑**：79 项浏览器组件测试、188 次空库迁移、依赖审计、23 项备份脚本测试、4 项真实 worker/PDF/导出恢复。它们仍然有效的前提是 action 映射没有碰这些模块，这一点在代码上成立。
- 我自己没有执行任何测试，也没有计算哈希；以上结论全部来自读源码和读日志。

## 目标生产部署前置（未完成，不属于代码缺陷）

这些都还没有在目标环境执行：
- 用实际 release SHA 构建；
- 目标环境的迁移、备份和配置核验；
- login/live/ready/jobs 探针，以及 cron 无效令牌返回 401；
- 系统 Chromium 和私有 PDF 存储；
- 经授权的真实通知和 CDR 连通性；
- 备份恢复演练。

本地 mock 和隔离库的结果不能代替这些项目。**9.3 分只代表本地候选的源码和功能质量，不代表生产已经验证。**
