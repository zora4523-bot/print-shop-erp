---
status: integration-checks-in-progress
owner: project-maintainers
baseline_commit: 47820c4d
scope: PR 29 合并前验证
---

# PR 29 集成验证记录

用户已授权推送、创建 PR 并合并到 main。开始时 `codex/design-removal` 比 `origin/main` 多 30 个提交、无分叉，跟踪文件及暂存区均干净。保留 `.playwright-cli/` 与两份 2026-09-21 无关审查文档，不纳入提交。本批 PR 包含此前连续任务共 317 个文件及 13 条新增前向迁移；不是单独发布最后的导航提交。

## 草稿测试时钟修复

`lib/form-drafts/__tests__/drafts.test.ts` 在固定的 `now` 写入完成回执，却通过 `completedDraftIdentity` 的默认真实时钟读取。超过草稿有效期后该断言变红；这是本分支早期新增测试的时钟前置问题。此前生产任务记录为其开始前已有失败，不能据此认定 main 已有该失败或忽略整批 PR 门禁。

2026-09-29 在 `47820c4d` 运行 `pnpm exec vitest run lib/form-drafts/__tests__/drafts.test.ts --reporter=verbose`：8 通过、1 失败，失败值为完成回执身份 `null`。修复将存储测试组的时钟固定到 fixture 日期，每条用例后恢复；补充恰好有效期边界和过期 1ms 的身份读取断言。未改变草稿有效期、生产代码、原断言或覆盖率阈值。

同一命令修复后 10 通过、0 失败/跳过；`pnpm exec eslint lib/form-drafts/__tests__/drafts.test.ts` 和 `git diff --check` 通过。此次只提交该测试及本记录。任务边界与原文件备份保存在仓库外 `erp-pr-merge-aq_jc2mu` 临时目录。

## 集成检查边界

[PR #29](https://github.com/zora4523-bot/print-shop-erp/pull/29) 已创建，完整 CI 尚在运行，最终结果以该 PR 对应 HEAD 的 Checks 和合并记录为准。之前各批次的实际局部结果见相关审查记录；尚未完成的检查不得计为通过。合并不会运行线上部署、生产库恢复或真实付款。
