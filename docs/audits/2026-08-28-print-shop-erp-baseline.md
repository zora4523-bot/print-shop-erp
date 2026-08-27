---
status: archived
captured_at: 2026-08-28
timezone: Asia/Shanghai
baseline_commit: fcbf001866586be630eab2a798a7609d14fc51e4
---

# print-shop-erp 全面审查基线

## 环境

- 分支：`Review`
- 基线 HEAD：`fcbf001866586be630eab2a798a7609d14fc51e4`
- Node / pnpm：仓库当前本地环境
- Next.js：`16.2.4`
- Playwright：109 项，单 worker
- 工作树：审查开始前已有大量用户修改、删除与未跟踪文件；基线代表该工作树快照，不是纯 HEAD checkout。

## 正式命令与结果

| 命令 | 结果 |
|---|---|
| `pnpm lint` | 通过 |
| `pnpm typecheck` | 通过 |
| `pnpm test --run` | 393 个测试文件、4,202 项全部通过，约 11.7 秒 |
| `pnpm exec playwright test --reporter=dot` | 67 通过、37 失败、5 跳过，约 26.7 分钟 |

首次尝试在隔离端口启动另一个 Next.js dev server 时，被既有 `.next/dev/lock` 阻止。正式 Playwright 基线复用已经运行的 `http://localhost:3000`；该端口锁事件不是测试失败。

## Playwright 基线失败

### Chromium 功能流程（12）

| 测试 | 失败摘要 |
|---|---|
| `tests/e2e/bill-flow.spec.ts:30` | 删除测试工单时触发 `OrderPricingRevision_orderId_fkey` |
| `tests/e2e/cdr-bundle.spec.ts:21` | fixture 删除工单时触发同一外键 |
| `tests/e2e/cs-accumulate.spec.ts:31` | 重置账单 fixture 时触发同一外键 |
| `tests/e2e/manual-production-flow.spec.ts:13` | 等待 `input[name="items.0.quantity"]` 超时 |
| `tests/e2e/notification-cron.spec.ts:137` | 清理 cron 工单 fixture 时触发同一外键 |
| `tests/e2e/notification-urgent.spec.ts:24` | 等待 quantity 输入框超时 |
| `tests/e2e/order-create.spec.ts:15` | 等待 quantity 输入框超时 |
| `tests/e2e/owner-dashboard.spec.ts:33` | 清理 dashboard fixture 时触发同一外键 |
| `tests/e2e/owner-notifications.spec.ts:29` | “新建群” strict locator 命中两个链接 |
| `tests/e2e/owner-settings.spec.ts:23` | `.factory-name` 不存在 |
| `tests/e2e/production-flow.spec.ts:22` | 等待设计文件输入控件超时 |
| `tests/e2e/smoke.spec.ts:301` | 测试写入缺少非空 `pricingRoute` |

### Worker 响应式（1）

| 项目 / 测试 | 失败摘要 |
|---|---|
| `[worker-1024x768] tests/visual/worker-responsive.spec.ts:41` | dark-token axe 颜色对比门禁失败；后续复测偶发转绿 |

### Admin / sales 响应式矩阵（24）

以下 4 个测试分别在 6 个视口失败，共 24 项：

| 测试 | 主题 / 工作台 | 视口 |
|---|---|---|
| `tests/visual/admin-responsive.spec.ts:47` | administrator light | 375×667、393×852、768×1024、1024×768、1280×800、1920×1080 |
| `tests/visual/admin-responsive.spec.ts:51` | administrator dark | 同上 |
| `tests/visual/admin-responsive.spec.ts:194` | sales light | 同上 |
| `tests/visual/admin-responsive.spec.ts:198` | sales dark | 同上 |

主要可观察现象：

- administrator 工单详情 fixture 期待“印刷面=双面”，当前页面找不到该定义；
- sales 新建工单等待“非标定制（自定义尺寸）”控件超时；
- 部分尺寸出现表格/页面 overflow；
- worker dark 基线有颜色对比波动。

## 基线处置规则

- 上述 37 项均在任何审查修改前已经失败，不属于本审查引入的回归。
- 本审查不顺手修改这些测试或对应业务实现。
- 后续每个自主修改批次均以“失败用例集合不得新增”为门禁。
- 首批及之后所有复测均为 68 通过、36 失败、5 跳过；唯一减少的是未触及路径的 worker dark-token 波动项，不记为已修。
