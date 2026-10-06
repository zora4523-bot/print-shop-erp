# 项目约束

- 完整开发规范见 [CLAUDE.md](./CLAUDE.md)；AGENTS.md / CONTRIBUTING.md 与 CLAUDE.md 冲突时先指出冲突，不自行择一。
- 涉及 Next.js 版本敏感的 API、路由或构建行为时，核对当前安装版 `node_modules/next/dist/docs/` 中的对应文档。
- 服务端授权、资源所有权、金额精度、历史快照及数据库迁移约束见 [CONTRIBUTING.md](./CONTRIBUTING.md) 对应章节；这些业务与安全边界不因流程精简而改变。

## 删除、验证与提交

- 删除依据应包含实际引用、消费方或调用链证据；检查受影响的配置、构建脚本、SQL、Prisma schema 与迁移，不以静态搜索无命中单独判定可删。
- 动态加载、注册表、i18n、生产专用入口和公开 API 需确认运行时或外部消费方；依赖不明时保留并说明待确认项。已应用的迁移不修改或删除。
- 按 [测试要求](./CONTRIBUTING.md#测试要求) 对完整变更批次做与风险相称的验证，不要求每条删除重复全量检查。失败时区分本次回归、既存问题和环境故障；修复或撤销本次回归，不覆盖无关改动。
- 无关清理单独提交；完成当前功能所必需的重构可与该功能一起审查、验证和提交。

## 文档与代码同步

- 开始前：文档与代码冲突时以代码和 `prisma/schema.prisma` 为准（业务规则以 `SPEC-v1.2.md` 为准），并在最终回复里指出冲突的文档位置；引用文档里的路径、函数、命令前先确认它存在。
- 完成后：检查本次改动是否影响 CLAUDE.md、CONTRIBUTING.md、ARCHITECTURE.md、API.md、DATABASE.md、DEVELOPMENT.md、docs/ui-规范.md 中的陈述（改了目录结构、权限 key、枚举、命令、路由、环境变量、门禁时必查），受影响的在同一个 commit 里更新。
- 删除功能时：搜索该功能的名称，把文档里的对应描述一并删除或标注已退役。
- 最终回复包含一行「文档影响：无 / 已更新 <文件>」；提交前运行 `pnpm check:docs`。

## 任务完成后自动提交

- 修改任务开始时读取并使用项目技能 [erp-task-commit](./.agents/skills/erp-task-commit/SKILL.md)，记录已有改动；完成实现和必要验证后，在最终回复前自动创建该任务的本地 commit。
- 用户已授权这个项目的任务完成后自动提交，无需重复询问是否 commit；用户明确要求暂不提交时遵从。此授权不包含 push、发布或改写已有提交。
- 提交只包含当前任务及其必要测试、文档；不得夹带其他任务的改动。无实际变更不创建空提交；确有验证或改动归属障碍时，按技能处理并说明具体未完成项。

## 用户可见文案

所有 UI 任务遵循 [文案与确认](./docs/ui-规范.md#文案与确认)。出现与旧页面、原型或组件默认文案不一致时，以该章节为准；不得因此跳过权限、金额、版本与审计校验。

## UI / UX 质量与完成条件

所有用户可见 UI 任务执行 [UI / UX Quality Standard](./docs/ui-规范.md#11-ui--ux-quality-standard)：开始前固定任务范围与功能不变量，完成后按顺序执行十项 Design QA，修复范围内问题并复验，记录实际证据后才判断完成。共享组件变更须检查受影响消费者。

遵守该节的设计原则、检查清单、验收条件和停止条件。不得为追求获奖级视觉改变已确认的产品结构、业务流程或 Design System；未执行或被环境阻断的检查不得记为通过。现有自动门禁为九视口，包含 320/390/430px；PR 只运行两个代表视口，main 运行完整九视口。不得把配置中的覆盖范围当作本次实际执行证据。

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
