---
status: active-baseline
captured_at: 2026-09-02
timezone: Asia/Shanghai
branch: codex/gogndan
baseline_commit: f04a5c041a7acec23ea8ac55f9532764b02c1c98
node: v24.15.0
pnpm: 10.33.1
---

# 管理端工单列表与月度账单基线

## 基线边界

- 基线提交：`f04a5c0 docs: pin admin work-order planning sources`。
- 基线开始及结束时，除被 Git 忽略的测试产物外，工作树相对该提交无源码改动。
- 所有会写数据库的门禁均使用本轮专用 PostgreSQL 数据库，没有使用开发库：
  - `print_shop_erp_admin_list_baseline_20260902_01`
  - `print_shop_erp_admin_list_baseline_20260902_fresh`
  - `print_shop_erp_admin_list_baseline_20260902_e2e`
- 三个临时数据库在结果记录完成后已用精确名称删除，并验证残留数为 `0`。
- 本轮只记录基线问题，不修复任何既有红项。

## 正式门禁与结果

| 门禁 | 结果 |
|---|---|
| `prisma generate` | 通过 |
| `prisma validate` | 通过 |
| fresh migration chain | 通过，`123/123` migrations |
| `check:architecture` | 通过；649 modules、2,377 dependencies、33 个 long-function debt |
| `lint` | 通过 |
| `typecheck` | 通过 |
| `check:dead-code` | 通过；证据报告含 110 个 knip issue groups、616 个 ts-prune candidates、0 cycles；候选不代表可删除 |
| isolated `prisma migrate deploy` + `db:seed` | 通过 |
| `audit:review-data` | 通过，见下表 |
| Node Vitest + coverage | 通过；437/437 files、4,279/4,279 tests |
| Vitest browser | 通过；2/2 files、2/2 tests |
| Playwright 全量（独立 E2E 库、单 worker、端口 3100） | **基线红**；104 通过、1 失败、11 跳过，共 116 项，12.4 分钟 |
| `next build` | 通过；Next.js 16.2.4，57/57 static pages generated |

覆盖率：statements `86.74%`、branches `78.97%`、functions `93.36%`、lines `88.60%`。

## 数据审计

| 检查项 | 数量 |
|---|---:|
| paid payrolls | 0 |
| paid payrolls with attendance mismatch | 0 |
| materials with quantity facts | 0 |
| materials with blank unit | 0 |
| duplicate bill order items | 0 |
| bill items with ownership mismatch | 0 |

## 唯一基线失败

`tests/e2e/notification-cron.spec.ts:137`：`/api/cron/order-overdue → ORDER_OVERDUE NotificationLog`。

- 断言固定期待：`已逾期：5 天`。
- 2026-09-02 基线运行实际输出：`已逾期：6 天`，承诺交期为 `2026/08/28`。
- 通知已成功生成，中文状态和其他模板断言均已通过；失败点仅为固定天数与运行日期不一致。
- 该问题在任何本任务实现前已经存在。本任务各 PR 的回归门禁允许保留这一条同签名失败，但不得新增失败；不得通过放宽无关断言来消除它。

Playwright 视觉导航期间 Next 开发服务器偶有 `ECONNRESET / aborted` 日志，但对应测试通过，未计为红项。

## 后续比较规则

1. 每个功能 PR 至少运行其定向 PostgreSQL 测试、Vitest、browser tests、Playwright 相关项目和 production build。
2. 每波结束运行与本基线同口径的完整门禁；允许的 Playwright 失败集合严格等于上述一条，直至它被独立修复任务关闭。
3. 迁移测试必须继续使用独立空库；E2E 必须继续使用独立数据库，避免 append-only 报工用例误跳过或污染开发数据。
4. 任何删除须遵守仓库 `AGENTS.md`：全仓 `rg` 取证、单条删除后分别 build/test/typecheck、清理 commit 与功能 commit 分离。
