# Codex Prompt：复审 2026-08-23 代码质量审查，成立的问题再改

把下面整段（从「角色」到文末）原样交给 Codex。不要先改代码再复审。

工作区是脏的：审查对象就是**当前未提交改动**（相对 `main` @ `357a084`），不是某个 PR。

```
角色
你是 print-shop-erp 的 Codex。先独立复审一份结构审查，再只改仍然成立的问题。
你不是原审查作者。原审查可能有误判、过时或修法写错。以当前代码为准。

强制阅读（按顺序）
1. CLAUDE.md
2. docs/代码质量审查-2026-08-23.md（初判全文 + 文末「Codex 复审结论」空表）
3. 本文件剩余部分
4. 涉及数据库时 prisma/schema.prisma
5. 涉及已有模块时，先读该模块 __tests__/
6. HANDOFF.md 里与通知重试、登录限流、盘点有关的条目（旧修法可能已经作废）

工作区
- 仓库：print-shop-erp
- 分支：main（脏工作树，不要切新分支，不要 git stash，不要 git reset，不要 git checkout --）
- 审查范围：git status 里所有已修改 + 未跟踪文件
- 生产未授权：禁止连生产、禁止发真企业微信、禁止 migrate 生产库

两阶段，顺序不能反
────────────────────────────────
阶段 A — 只读复审（写任何业务代码之前完成）
────────────────────────────────
对 docs/代码质量审查-2026-08-23.md 的 B1–B6、S1–S7 逐条：
1. 读初判引用的源文件，不要只信报告里的行号（行号可能已漂）。
2. 用当前代码判定：成立 / 不成立 / 部分成立。
3. 「不成立」必须写清：哪一段代码已经覆盖、或初判把有意设计当成缺陷。
4. 「部分成立」拆成：哪一段仍要改、哪一段不要动。
5. 把结论填进该审查文档文末的「Codex 复审结论」表，并写 2–4 句摘要。
6. 此阶段只允许改这一份审查文档的复审表。禁止改 lib/、actions/、app/、prisma/。

复审时特别核这几条易误判的点
- B5：HANDOFF 旧文写「RETRYING → FAILED」。新状态机下这是错的。claimDurableDelivery
  只回收 RETRYING；FAILED 单调。成立的问题是业主可见契约（告警条 / 徽章 / 未解决队列），
  不是把行焊成 FAILED。
- B4：先查 prisma migrate status / _prisma_migrations。三项 query-index migration
  若从未 apply，才允许压成一个文件；若已 apply，禁止改写 migration 历史。
- B1：确认 claimNextBackgroundJob 是否仍在每次空转 poll 里跑通知/CDR/导出清扫。
- B2：确认 notify 与 replayDurableNotificationLogs 是否仍复制发送循环，以及
  停用频道 / 版本冲突的 retryable 是否已经分叉。
- S5：成功登录也消耗 GCRA 令牌是刻意设计（非法表单也算尝试）。厂区 NAT 误伤是业主拍板项，
  不要改成「只在 bcrypt 失败后扣令牌」。最多锁 SQL 形状。
- S7：本仓库 schema 没有 @@check。不要开 Prisma check preview。最多在 schema 注释里
  写明 DB CHECK 已存在。
- 「不要动」清单见审查文档第四节。复审时若仍成立，禁止当问题修。

────────────────────────────────
阶段 B — 只改成立 / 部分成立的项
────────────────────────────────
按这个顺序，能独立提交的就按小任务拆（本仓库纪律：小步 commit）：

1. B5 业主可见契约（告警条 / 徽章 / 测试夹具与 webhook 分类对齐）
2. B2 合并发送/finalize 循环 + 重放冲突不再当成传输重试
3. B1 把终态清扫从 claim 热路径拆出；UNKNOWN 拒绝复活集中一处
4. B3 拆文件（daily.ts 回到 1000 行以下；UNKNOWN resolve 离开 admin.ts）
5. B6 删除 findUncoveredOutsourceItems
6. B4 仅当阶段 A 确认 migration 从未 apply
7. 成立的 S1–S7

每个成立项必须按审查文档里的「规定修法」做。不要另发明第三种状态、新队列、新依赖。

禁止
- 把 RETRYING 在 job DEAD 时改成 FAILED
- 重写 SENDING / RETRYING / UNKNOWN / FAILED 状态机
- 把 5xx / 超时 / 网络从 UNKNOWN 改回自动重试（企业微信无幂等键）
- 把外协覆盖从 max 改成 sum
- 把 ExecutionFence 折叠进 ClaimedBackgroundJob
- 「修」useActionState 箭头包裹（CLAUDE.md §15.8）
- 把 IntentPrefetchScheduler 改成 hook（除非同时把策略从 AppSidebar 抽出——本次不要做）
- 改登录「成功也消耗令牌」
- 往 lib/order.ts、lib/production.ts 继续堆逻辑
- 引入 Docker / Redis / 新消息队列 / 新 npm 依赖
- git stash / reset / 丢弃与本任务无关的未提交改动
- 部署、生产操作

测试
改哪测哪，另外必须：
- 补 B5：最后一次 attempt + 429/45009 → job DEAD + log 仍 RETRYING + 告警条/UI 能看见
- 修正 notify 测试里把 http 500 当成 RETRYING 的夹具（生产 sendWebhook 把 500 标 unknown）
- B1 若拆清扫：claim 的空转路径不再承担领域断言；清扫有自己的测试
- B2：notify 与 replay 共用 helper 后，停用频道语义用参数表达，两边各有测试
- S6 若改健康查询：salary DEAD + 大量 notification DEAD 时 dead-jobs-last-24h 仍亮

完成前命令（必须实跑，禁止只说会绿）
pnpm exec prisma validate
pnpm typecheck
pnpm lint
pnpm test run

若改了 App Router 页面、被页面使用的组件、Prisma schema 或 migration，再跑：
pnpm build

覆盖率：动到 lib/salary/** 或状态机时，相关文件不能把 vitest.config.ts 里的阈值打穿。
不要为了覆盖率去测 UI 样式。

提交
- 每完成一个逻辑小块就 commit，禁止一个巨型 commit
- 格式：type(scope): subject
- 引用本审查 ID，例如：
  refactor(jobs): extract lease reaper from claim (review B1)
  fix(notification): surface RETRYING+DEAD on owner banner (review B5)
  refactor(notification): share claimed-channel delivery helper (review B2)
- 三份记忆文档若更新，单独 docs(memory): ...
- 不要 commit .env、不要 commit console.log
- 不要 force push
- 不要开 PR（工作树本就在 main 的未提交批次上；你是在这批里收口结构，不是另开功能分支）

收尾
1. 审查文档「Codex 复审结论」表填完，摘要写清改了什么、证伪了什么。
2. 重写 HANDOFF.md 的「当前任务 / 下一步」（历史节只追加一行）：
   - 2026-08-23：Codex 复审代码质量审查；成立项已改；列出未做/证伪项。
3. 若有阶段性进展，更新 PROGRESS.md「下一步」第一条为本收口状态。
4. 不要为这次结构收口新增 DECISIONS，除非你改变了投递/外协/登录的对外语义——那必须停下来写进审查结论，等业主，不准擅自拍板。

完成定义
- 阶段 A 的表已填
- 所有「成立」项已按指定修法落地，或在结论里写明被什么挡住（例如 B4 已 apply 不能压）
- 门禁命令实跑全绿
- 没有违反「禁止」清单
- 工作树里与本审查无关的未提交文件仍在（你没有把它们 revert 掉）
```

---

## 给操作者的调用示例

在仓库根目录、确认工作树就是这批未提交改动之后：

```bash
# 把 prompt 交给 Codex（模型与 sandbox 按你现有习惯；需要写文件 + 跑测试）
codex exec -m gpt-5.4 --sandbox workspace-write \
  "$(cat docs/codex-prompt-代码质量审查修复-2026-08-23.md)"
```

若 Codex 界面是对话而不是 `exec`：新建一轮，把上框「角色」到「完成定义」整段贴进去，并明确「先填复审表，再改代码」。
