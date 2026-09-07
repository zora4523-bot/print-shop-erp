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
| 管理端/师傅端布局 | 六视口、明暗主题、overflow、touch 与 axe 门禁 |
| 发布候选 | typecheck、lint、全量单测、build、关键 E2E、部署 smoke |

常用命令见 [DEVELOPMENT.md](./DEVELOPMENT.md)。视觉门禁通过只证明已定义的几何、可访问性和基线契约，不自动证明每一页都与设计稿逐像素一致。

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

## 评审清单

- [ ] 改动范围单一，未覆盖无关脏工作区内容。
- [ ] 权限、输入、状态转换和失败路径已验证。
- [ ] 没有敏感信息、调试输出或静默降级。
- [ ] 金额与历史快照规则未退化。
- [ ] 响应式、键盘、焦点、明暗主题和 reduced-motion 已按风险验证。
- [ ] 数据库变更只向前，SQL 已人工审查。
- [ ] 所需测试、构建和文档检查已运行，并准确记录结果。
- [ ] 没有用更新截图、放宽 axe、降低覆盖率或删除断言来掩盖失败。

## 产品发布记录策略

当前 [`CHANGELOG.md`](./CHANGELOG.md) 是 SPEC 历史，不是产品发布日志。在建立正式发布日志前：

- 不根据未提交工作区、计划或测试结果伪造版本条目；
- 已部署版本以受控 release SHA、部署记录和数据库迁移状态共同确认；
- 将来新增产品发布日志时，每条至少记录发布日期、release SHA、迁移范围、用户可见变化、破坏性或不可逆步骤、验证和回退约束；
- “Unreleased” 内容只能描述已合入默认分支但尚未发布的事实，并明确未发布。
