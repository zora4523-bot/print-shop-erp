# PR #50 合并门禁依赖修复

2026-10-06：推送死代码清理与开发文档同步后，[首轮 Quality](https://github.com/zora4523-bot/print-shop-erp/actions/runs/37431198173) 的 static 被现有生产间接依赖安全审计阻断：1 项 high、6 项 moderate。本轮组件清理没有引入这些依赖。

## 修复范围

- `@sentry/nextjs` 从 10.49.0 更新至同主版本 10.76.0；新依赖树移除受 [GHSA-qqmp-wf37-98f9](https://github.com/advisories/GHSA-qqmp-wf37-98f9) 影响的六个数据库 instrumentation 包。
- 通过限定旧版本的 pnpm override 将 `source-map-js` 更新为 1.2.2，修复 [GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q)，同时覆盖构建工具的消费路径。
- 同步锁文件的 Sentry 与关联间接依赖解析；Next、Prisma、Auth.js 精确版本不变。没有修改业务实现、数据库、迁移、安全门禁或漏洞忽略列表。

## 实际验证

- `pnpm install --frozen-lockfile`：通过，锁文件一致。
- `pnpm audit --prod`：通过，No known vulnerabilities found。
- `pnpm typecheck`：通过。
- `pnpm test run lib/observability/__tests__/sentry-scrub.test.ts`：12 项通过。
- Node 24 下真实导入 Sentry、禁用传输后初始化、检查 `captureRequestError` 导出：通过。初次临时 smoke 误调用 Next SDK 未导出的 `close`，修正验证脚本后通过；应用代码不调用该 API。
- 全量构建、单测覆盖率、浏览器与 E2E 以 [PR #50](https://github.com/zora4523-bot/print-shop-erp/pull/50) 最新提交的 checks 为准；此记录写入时尚待新提交 CI，不将旧提交结果记为新提交通过。

未验证真实 Sentry 服务端接收；本任务不配置 DSN、不部署生产。
