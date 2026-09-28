# 建单设计款删除修复

日期：2026-09-27。基线：`f90b211c28d328466ad05fcb5f8ffaeaf1652de3`。分支：`codex/design-removal`。

状态：实现、必要验证和 Claude Code Opus 5.5 三轮审查均已完成，未遗留确定的阻断问题。

## 任务边界

用户授权修复建单设计款删除，并在完成后使用 Claude Code 的 Opus 5.5 对抗审查。
开始时无已跟踪文件改动；两份既有未跟踪文档 `2026-09-21-first-use-readiness.md`、
`2026-09-21-first-use-remediation-brief.md` 保留，不纳入本任务。

本批限于未创建工单的设计款/规格操作、草稿状态、关联测试及规范。既有工单、服务端授权、
计价规则、历史快照、数据库 schema 与迁移不变。

## 实施任务与验收

1. **设计款删除入口**：在设计款标签前的独立操作行并列“增加设计款”“删除设计款”。
   只剩一个设计款时不提供整款删除；规格区只提供“移除当前规格”，且同款至少保留一个规格。
   按钮作用于当前设计款，不把业务数据删除称为仅关闭面板，不把按钮嵌进 tab 按钮。
2. **整组删除**：从操作前的完整数据计算一次删除集合，同时处理非连续规格行、包装、分货、
   文件选择及报价失效；不循环调用带持久化副作用的单行删除。保留未删除明细的身份与数值。
3. **选中项及焦点**：移除规格后优先保留同设计款；删除整款后选择邻近设计款。
   两类删除分别恢复各自操作按钮的焦点；按钮消失时转到相应选中标签，报价/错误被动更新不抢焦点。
4. **历史草稿名称**：删除前重映射无分组键设计款的手工命名记录，再执行单款跟随名称规则。
   手工填写的名称（包括与工单名相同的名称）不得因数组下标变化被覆盖，清空后的跟随行为保留。
5. **回归与文档**：先复现整组删除缺位、跨款跳转、历史名称串用；覆盖管理员/外部销售，
   一款多规格、非连续组、首/中/末删除、混装、额外地址和共享文件。当前分层 UI 的六视口、
   明暗主题、44px 触控、overflow、键盘焦点与 axe 均需验证。

## 验证安排

- 定向单测、真实 OrderForm 浏览器组件回归、相关建单 E2E（独立可丢弃数据库）。
- 完整 Vitest、`pnpm lint`、`pnpm typecheck`；记录既存失败、环境故障和未执行范围。
- 同工作区的全量单测/E2E 与日常开发服务按 DEVELOPMENT.md 错开；结束后恢复开发服务。
- `git diff --check`；核对最终文件清单及未跟踪文档边界。

## Claude Code 对抗审查

代码与首轮验证完成后调用本机 Claude Code，明确指定 Opus 5.5，不静默切换模型。
提供基线、完整任务 diff、测试结果及以下挑战：非连续删除是否错位、最后一款保护是否有漏洞、
报价晚响应是否复活已删数据、包装/分货/文件是否串款、历史命名标记是否错位、焦点是否跨层。
审查只读。对发现逐条复现与处置；属实问题修复后复跑相关验证并请同模型复审，保留未解决项。
全部必要验证与审查收口后，仅提交本批文件到本地，不 push 或部署。

## 执行结果

- 原问题证据：`OrderFormDesignName.browser.spec.tsx` 新增两角色的三个回归，旧实现 **6 失败**；分别确认无整款删除入口、删 A1 后跳 B、历史手工名称被工单名称覆盖。日志 `/tmp/design-removal-red.log`。
- 完成实现：新增纯函数计划一次删除集合及选择目标，单次投影分货/包装、移除 RHF 行、保留剩余文件并使报价失效；历史命名标记先重映射。两层 UI 使用各自按钮/标签焦点。
- 定向单测 3 文件 **35 通过**；完整 Vitest（包含 PostgreSQL 测试）**706 文件通过 / 2 文件跳过，7593 项通过 / 44 项既有跳过，0 失败**。命令 `pnpm exec vitest run --maxWorkers=2`。日志 `/tmp/design-removal-unit-all.log`。
- 真实 OrderForm 浏览器组件首轮 **35 通过**，审查后补测 **40 通过**，包含六视口明暗的布局/44px/overflow/axe/焦点、两角色删除、非连续组与分货/混装/文件/人工价保持、包装人工价失效提示、旧报价晚返回、历史命名边界；另外 `OrderFormBNavigation` 与 `OrderFormLocalDraft` **77 通过**。最终合计 **117 通过**。最终日志 `/tmp/design-removal-browser-accepted.log`、`/tmp/design-removal-browser-all.log`（后者保留初轮触控高度失败及其他两文件通过记录，触控高度已修为 44px 并重跑通过）。
- Chromium 建单 E2E：`order-delete-navigation`、`order-creation-groups`、`order-entry-stability` 三文件 **17 通过**。日志 `/tmp/design-removal-e2e.log`，结果 `/tmp/design-removal-e2e-result.json`。
- 真实管理端页面 `admin-responsive` 的 `design and specification tabs` 专项：六视口 × 管理员/销售 **12 通过**，最终按钮颜色复跑仍 **12 通过**；每例包含明暗主题、触控、键盘、overflow 与 axe，未更新像素基线。日志 `/tmp/design-removal-viewports-final.log`。
- `pnpm typecheck`、`pnpm lint` 通过；lint 保留 `app/global-error.tsx` 和 `OrderForm.tsx` 两条既有导航警告，UI 文案与令牌均 0 违例。
- 数据库验证使用本次创建的本机独立库，单测与 E2E 各一库；均通过全部迁移并 seed，E2E 经 `test:e2e:prepare` 准备。通知/CDR 为 mock，后台任务 inline。日常开发库未执行本批测试写入。结束后核对连接数为 0，删除两份独立测试库及临时连接配置。
- Claude Code 从 2.1.241 更新至 **2.1.283**，实际首轮输出 `canonicalModel=claude-opus-5-5`、`subtype=success`、权限拒绝 0；只开放 Read/Glob/Grep，未启用 MCP、子代理或模型降级。完整审查输入与原始输出位于 `/tmp/design-removal-review/`。
- 首轮结论“未发现阻断问题”，确认 1 项 P3：DECISIONS 新条目缺少标准字段；已改为“决策 / 理由 / 影响 / 相关文档”，保留边界。人工价、晚返回、历史命名及规格层视口缺口已补行为断言。未分层入口目前没有生产调用，不扩大 API 改造；字段错误跟随仅有既有回归和 RHF 实现审查，未新增专门的错误重排用例。
- 第二轮无可确认 P1/P2/P3，确认首轮 P3 已解决及补测有效，但指出晚响应断言可能自动重试到恢复状态。随后改为 React `act` 排空旧回调后立即断言金额和仅两次请求，并恢复 reducedMotion 测试环境。实际负控临时去掉响应拦截：定向用例 **1 失败**，明确发现费用退回“待重新核价 / 已知合计——”；恢复保护后完整文件 **40 通过**，lint/typecheck 再次通过。日志 `/tmp/design-removal-late-quote-{green,negative}.log`、`/tmp/design-removal-browser-accepted.log`。负控结束自动恢复并核对源码 SHA256 一致，负控代码不纳入提交。
- 第三轮限范围复核确认三项处置有效：“未发现阻断问题”，没有新的确定缺陷。三轮输出均为 `subtype=success`、仅使用 `claude-opus-5-5`、权限拒绝 0；原始 JSON 与中文结论分别保留为 `/tmp/design-removal-review/round{1,2,3}.{json,md}`。Claude 只读审查，测试执行证据来自本批实际运行，不将模型阅读代码当作运行验证。
- 删除按钮使用 destructive 语义色。初次套用默认变体在深色背景对比度为 4.4，导致 6 项 axe 失败；已使用背景令牌和轻量 hover 背景修正，最终六视口明暗全部通过。审查补测首轮另有 1 项断言写错确认按钮名称（非产品失败），已按真实 UI 修正。失败日志 `/tmp/design-removal-browser-review.log` 保留，未放宽门禁。
- 日常 `pnpm dev` 已恢复，`http://localhost:3000/login` 返回 200；原浏览器草稿未操作。生产构建、生产数据库和真实通知不在本批验证范围。
- 提交范围：实现、必要测试和上述事实源共 13 个文件；排除两份任务开始时已有的未跟踪审计文档和全部测试产物。仅本地提交，不 push 或部署。

实际定向浏览器命令：`pnpm test:browser components/business/order/__tests__/OrderFormDesignName.browser.spec.tsx`。
E2E 使用隔离环境包装器 `node /tmp/design-removal-run.cjs e2e exec playwright test`，分别传入上述三个 E2E 文件与 `--project=chromium`，以及 `tests/visual/admin-responsive.spec.ts --grep 'design and specification tabs'` 和六个 `admin-<宽>x<高>` project（375×667、393×852、768×1024、1024×768、1280×800、1920×1080）。
