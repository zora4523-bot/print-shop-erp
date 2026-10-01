---
status: maintained
owner: project-maintainers
last_verified: 2026-08-24
applies_to: repository source at last_verified
---

# 贡献指南

本文规定对当前仓库提交代码、迁移和文档的最低要求。环境搭建见
[DEVELOPMENT.md](./DEVELOPMENT.md)，系统边界见
[ARCHITECTURE.md](./ARCHITECTURE.md)。

## 开始前

1. 阅读 [`AGENTS.md`](./AGENTS.md)、业务规格
   [`SPEC-v1.2.md`](./SPEC-v1.2.md) 和与改动相关的
   [`DECISIONS.md`](./DECISIONS.md) 条目。
2. 检查 `git status --short`。工作区可能已有他人改动；只修改任务范围内文件，不重置、不覆盖无关内容。
3. 涉及 Next.js 版本敏感的 API、路由或构建行为时，核对当前安装版本
   `node_modules/next/dist/docs/` 中对应文档；具体版本以 `package.json` 与安装结果为准。
4. 先写清业务不变量、权限、失败方式和验证范围，再开始实现。
5. 编码细则见 [编码规范](./docs/编码规范.md)。处理发布审查项时，从
   [整改任务台账](./docs/release-remediation-2026-09-10.md) 领取明确范围，记录开始 SHA；
   历史审查通过记录不能替代当前候选的验证。

## 分支与提交

- 分支使用清晰的小写短名；自动化代理默认使用 `codex/` 前缀。
- 一个提交只表达一个可审查目的，不把格式化、迁移、重构和功能扩展无边界混在一起。
- 不提交 `.env`、生产地址中的密钥、临时导出、测试报告、`.next` 或生成的 Prisma Client。
- 不改写他人提交历史，不使用破坏性 reset 清理共享工作区。
- 提交信息说明结果和范围，不写无法验证的“全部完成”“生产已验证”等结论。

## 编码约束

### TypeScript 与模块

- 保持 `strict` 类型检查通过；避免 `any`、非必要断言和吞掉错误。
- 使用 `@/` 根别名；领域代码放在对应 `lib/<domain>/`，不要形成新的万能 `utils`。
- 仅供服务端使用的模块保持在服务端边界；不要把 Prisma、密钥或 Node-only 依赖带入客户端 bundle。
- 不手改 `generated/prisma/`，通过 `pnpm exec prisma generate` 生成。

### Server Actions 与 Route Handlers

- 写操作第一道门是 `requirePermission(...)` 或等价的 session permission 检查。
- 使用已有 Zod schema 校验不可信输入；字段错误返回结构化结果，不能只靠浏览器校验。
- 资源所有权、状态机和金额不变量必须在领域层再次验证。
- 成功写入后只失效必要路径；外部契约变化同步更新 [API.md](./API.md) 和测试。
- 不向客户端、日志或错误响应暴露连接串、Webhook、Bearer secret、内部任务 payload 或堆栈。

### 金额、日期与历史记录

- 金额、单价、比例、工时和库存数量沿用 Prisma `Decimal` / decimal.js 语义，不用 JavaScript 浮点数做最终财务计算。
- 日期必须明确是 UTC 时间戳、数据库 `date`，还是上海业务日历；cron 默认日期不能依赖服务器本地时区猜测。
- 历史价格、薪资和生产记录继续保存规则快照。修改当前规则不得重写已结算历史。
- 批处理必须可安全重试；已有幂等键、唯一索引或任务 scope 不得被绕开。

### UI

- 遵守 [UI-SYSTEM.md](./UI-SYSTEM.md) 的组件分层、五态、语义颜色、响应式和可访问性规范。
- UI 规则以 [`docs/ui-规范.md`](./docs/ui-规范.md) 为准；UI 任务执行其 [§11 质量标准](./docs/ui-规范.md#11-ui--ux-quality-standard)，按任务影响完成 Design QA、修复复验及证据记录。文档修改本身不等于页面验收。
- 业务页面不新增 Tailwind 调色板字面量；ESLint 已在 `app/`、`components/business/` 和 `components/ui-business/` 建立门禁。
- 不新增 `window.alert` / `window.confirm`，不为同一种状态再造局部 Badge、空态或 loading。
- 交互只隐藏或禁用按钮不算授权；服务端约束仍必须存在。

## 数据库迁移

1. 先修改 [`prisma/schema.prisma`](./prisma/schema.prisma)。
2. 在指向专用开发数据库的 `DATABASE_URL` 下运行：

   ```bash
   pnpm db:migrate -- --name <descriptive_name>
   pnpm exec prisma generate
   ```

3. 审查生成的 SQL、锁表风险、数据回填和失败原子性。
4. 添加领域测试，并在可丢弃的 fresh database 验证完整迁移链。
5. 不编辑已在任何共享或生产环境应用过的 migration；新增前向 migration 修正。

禁止对生产或共享开发数据库运行 `prisma migrate reset`、`prisma db push` 或未审查的手写清理语句。完整规则见 [DATABASE.md](./DATABASE.md)。

## 测试要求

按改动风险选择最小但充分的验证；高风险改动不能只跑目标测试。

| 改动 | 至少验证 |
|---|---|
| Markdown 文档 | 本地链接与路径存在、`git diff --check` |
| UI 原子件/状态组件 | 目标单测、`pnpm lint`、`pnpm typecheck`、相关视觉门禁 |
| 普通领域逻辑 | 目标 Vitest、`pnpm test --run`、类型与 lint |
| 状态机、薪资、定价、库存、账单 | 目标边界测试、全量 Vitest、相关 E2E；覆盖率门禁不得降低 |
| Server Action / 权限 | action 测试、越权失败用例、相关 E2E |
| Route Handler | 状态码/响应体/认证测试，并更新 API 文档 |
| Prisma migration | 开发库状态、fresh DB 完整迁移链、数据前后置检查 |
| 打印布局 | `tests/visual/order-print.spec.ts` 像素基线；未经确认不更新基线 |
| 管理端/师傅端布局 | 九视口、明暗主题、overflow、touch 与 axe 门禁，并按 [Design QA](./docs/ui-规范.md#11-ui--ux-quality-standard) 实屏复核 |
| 发布候选 | 架构、typecheck、完整 lint、全量单测与覆盖率、依赖安全审计、fresh DB、build、浏览器组件、关键 E2E、适用视觉门禁、目标环境 smoke |

常用命令见 [DEVELOPMENT.md](./DEVELOPMENT.md)。视觉门禁通过只证明已定义的几何、可访问性和基线契约，不自动证明每一页都与设计稿逐像素一致。

### 缺陷修复与发布防回归

- 对已确认的行为缺陷，先保留能触发原问题的回归证据，再修复并运行同一断言。
  表单/路由/认证缺陷须经过真实框架边界；仅调用 action 函数不能替代浏览器提交。
- 当前规范变化导致旧断言失效时，引用已批准决策或现行文案，再同步测试；
  不把确认流程、权限或金额检查删除来让测试变绿。稳定的组件 mock 应保留实际使用的导出。
- `playwright --list` 仅证明用例可收集。默认 `next dev`、mock 通知和 inline jobs
  不能证明生产构建、真实通知和 durable worker 正常。现行 CI 覆盖范围见
  [开发指南](./DEVELOPMENT.md#当前-ci-与发布验证缺口)。
- 写入型测试使用独立可丢弃数据库，并显式准备工价、用户与业务数据。
  缺前置导致的 skip、导入失败或零用例均不能计作验收通过；有意限定视口的专项跳过须说明覆盖归属。
- 测试结果记录候选 SHA、工作区增量、运行模式、数据库隔离方式、实际命令、通过/失败/跳过数量和证据位置。
  失败区分本次回归、旧断言、前置缺失、环境异常和待定位；多路由测试中未执行的后续步骤不得写通过。
- 不用增加任意 sleep、force click、吞掉 pageerror、禁用 axe、降低覆盖率或自动更新基线掩盖失败。
  修复点击/主题问题须实际触发弹层、tooltip、键盘和触控状态。
- 发布前由指定负责人核对同一 release SHA 的门禁和生产前置证据。
  未修复的安全、授权、账单/金额/历史数据问题不得以“CI 绿”替代验收。

## 文档要求

变更以下事实时，必须在同一任务更新对应文档：

| 变化 | 文档 |
|---|---|
| 系统边界、进程、分层、授权入口 | [ARCHITECTURE.md](./ARCHITECTURE.md) |
| Route Handler 或 Server Action 公共契约 | [API.md](./API.md) |
| Schema、迁移、seed 或扩展 | [DATABASE.md](./DATABASE.md) |
| 本地安装、脚本、测试方式 | [DEVELOPMENT.md](./DEVELOPMENT.md) |
| 部署或运维步骤 | [DEPLOYMENT.md](./DEPLOYMENT.md) 指向的 canonical runbook |
| UI token、共享组件、页面壳或视觉门禁 | [UI-SYSTEM.md](./UI-SYSTEM.md) |
| 新故障模式与恢复步骤 | [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) |

文档头部的 `last_verified` 只在实际重新核对对应代码或配置后更新。

### 文档保持现行

每个修改任务在开始时列出受影响的事实源，完成时同步实现、回归测试、操作文档和任务状态。
现行规则在本节与 [编码规范](./docs/编码规范.md)，测试命令在 [DEVELOPMENT.md](./DEVELOPMENT.md)，
部署命令只维护 [部署指南](./docs/部署指南.md)。其他入口和 PR 模板引用它们，避免复制多套门禁。

- 计划和要求标明“待实现”；运行过的证据标明 SHA、日期、范围和结果；不把日期更新当作复验。
- 审查报告保留当时快照，修复结论追加到现行任务台账，不能把历史红灯改写为从未发生。
- 接口、环境变量、脚本、用户文案或 fixture 改动时，检查其调用方、测试和文档引用；
  取代旧规则要给出明确范围与新入口，保留已应用迁移和历史证据。
- 对局部核对的文档只标注对应章节与核对来源，不刷新整份文档的 `last_verified`。
- “已验收”必须有修复 commit、实际验证结果、文档更新位置和复核人；纯规划只更新任务规格。

## 评审清单

- [ ] 改动范围单一，未覆盖无关脏工作区内容。
- [ ] 权限、输入、状态转换和失败路径已验证。
- [ ] 没有敏感信息、调试输出或静默降级。
- [ ] 金额与历史快照规则未退化。
- [ ] 响应式、键盘、焦点、明暗主题和 reduced-motion 已按风险验证。
- [ ] 数据库变更只向前，SQL 已人工审查。
- [ ] 所需测试、构建和文档检查已运行，并准确记录结果。
- [ ] 缺陷回归已覆盖原触发条件；测试模式、跳过项和未验证范围已说明。
- [ ] 对应事实源与任务台账已同步，未把计划写成已实现或已部署。
- [ ] 没有用更新截图、放宽 axe、降低覆盖率或删除断言来掩盖失败。

## 产品发布记录策略

当前 [`CHANGELOG.md`](./CHANGELOG.md) 是 SPEC 历史，不是产品发布日志。在建立正式发布日志前：

- 不根据未提交工作区、计划或测试结果伪造版本条目；
- 已部署版本以受控 release SHA、部署记录和数据库迁移状态共同确认；
- 将来新增产品发布日志时，每条至少记录发布日期、release SHA、迁移范围、用户可见变化、破坏性或不可逆步骤、验证和回退约束；
- “Unreleased” 内容只能描述已合入默认分支但尚未发布的事实，并明确未发布。
