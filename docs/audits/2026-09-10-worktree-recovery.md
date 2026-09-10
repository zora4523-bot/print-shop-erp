# 临时工作树残留复核

复核基线：`origin/main` / `43b8cf3`。此次只回收可独立采用的产品校验提取，不恢复旧页面或临时运行配置。

## 判定方法与边界

先保存每个工作树的补丁，再将文件内容与主分支可达历史对象比较，最后对未匹配文件检查语义。文件存在历史匹配只能证明曾进入主分支，不能据此恢复被后续修改的旧版本；函数名称不同也不代表功能未合并。

本机原始补丁与分类清单保存在 `/tmp/erp-recover-worktrees/`，临时目录可能由系统清理；所有来源工作树本次均未删除或修改。命名分支已推送/合并的结论不等于这些临时工作树没有未提交文件。

## merge.IsG26y 七文件裁决

| 文件 | 旧改动 | 裁决 |
| --- | --- | --- |
| `lib/order.ts` | 提取 `assertCreateOrderProductsInTx` | 回收：保留同一事务、批量查询、去重、按输入顺序报错和停用校验，行为不变。 |
| `lib/inventory-count-posting.ts` | 提取库存通知 helper | 不回收：主分支已有 `enqueueInventoryCountStockAlerts`，保留现有实现。 |
| `lib/order/pricing-review.ts` | 提取核价提交校验 | 不回收：主分支已有 `validateFinalPricingSubmissions`，且包含进一步的运费身份校验。 |
| `app/(admin)/orders/[id]/page.tsx` | 提取修改日志组件 | 保留为可选重构：主分支仍渲染日志并执行金额可见性判断，未缺功能；旧布局已变化，不恢复旧 JSX。 |
| `components/business/order/SalesOrderDetailView.tsx` | 提取标题组件 | 保留为可选重构：标题和状态仍存在，主分支已有其他组件拆分；未发现遗漏功能。 |
| `components/business/order/ExternalSalesOrderFormRail.tsx` | 提取报价款式列表 | 保留为可选重构：主分支仍渲染报价款式，并已拆分内部结算侧栏；不恢复旧字号/金额格式。 |
| `components/business/order/OrderPricingReviewForm.tsx` | 提取提交载荷构造 | 保留为可选重构：当前提交仍包含工单/价格版本、款式、包装、费用和配送字段；另有阻塞和提交中保护，不替换成旧提交处理。 |

这四项可选重构仍未采用，不能宣称七文件全部合并；它们不构成缺失的业务功能。

## 未匹配的验证配置

- `order-detail-v2-jgwdg4im/candidate/vitest.browser.detail-validation.config.ts`：个人绝对路径及独立缓存目录，仅供当时浏览器验证。
- `order-neutral-colors-vsaomq7j/isolated/vitest.browser.config.ts`：个人路径、独立缓存、固定远程调试端口 9227；不进入共享配置。
- `order-single-qr-07yjggk5/visual-worktree/package.json`、`remove-task-print-ruwsfavv/verify-worktree/package.json`：仅将开发命令切到 webpack；隔离验证的环境调整，不据此改变项目默认构建器。

## 工作树清单

下列“历史匹配”统计包含跟踪及相关未跟踪文件，不等于本次新增功能数量；测试产物另行排除。

| 来源工作树 | 历史匹配文件数 | 未匹配文件数 |
| --- | ---: | ---: |
| `/private/tmp/print-shop-erp-merge.IsG26y` | 0 | 7 |
| `/private/var/folders/1m/qlr1bwhj2h7ck5qbntt0xdcm0000gn/T/erp-workbench-commit-fuhs64zz/candidate` | 59 | 0 |
| `/private/var/folders/1m/qlr1bwhj2h7ck5qbntt0xdcm0000gn/T/grok-29ab47e-an6qo30x/review` | 0 | 0 |
| `/private/var/folders/1m/qlr1bwhj2h7ck5qbntt0xdcm0000gn/T/grok-29ab47e-an6qo30x/verify` | 7 | 0 |
| `/private/var/folders/1m/qlr1bwhj2h7ck5qbntt0xdcm0000gn/T/order-detail-v2-jgwdg4im/candidate` | 12 | 1 |
| `/private/var/folders/1m/qlr1bwhj2h7ck5qbntt0xdcm0000gn/T/order-edit-design-w05om40r/verify` | 18 | 0 |
| `/private/var/folders/1m/qlr1bwhj2h7ck5qbntt0xdcm0000gn/T/order-external-sales-ys6p3sud/verify` | 17 | 0 |
| `/private/var/folders/1m/qlr1bwhj2h7ck5qbntt0xdcm0000gn/T/order-flow-1da73gyk/verify-worktree` | 51 | 0 |
| `/private/var/folders/1m/qlr1bwhj2h7ck5qbntt0xdcm0000gn/T/order-flow-plate-_ulx8626/verify` | 69 | 0 |
| `/private/var/folders/1m/qlr1bwhj2h7ck5qbntt0xdcm0000gn/T/order-flow-unit-9j6fkyq7/verify-worktree` | 2 | 0 |
| `/private/var/folders/1m/qlr1bwhj2h7ck5qbntt0xdcm0000gn/T/order-header-a4g80cvv/verify` | 15 | 0 |
| `/private/var/folders/1m/qlr1bwhj2h7ck5qbntt0xdcm0000gn/T/order-list-name-t7vr7q2g/verify-worktree` | 6 | 0 |
| `/private/var/folders/1m/qlr1bwhj2h7ck5qbntt0xdcm0000gn/T/order-list-signals-m46jlw4m/verify-worktree` | 9 | 0 |
| `/private/var/folders/1m/qlr1bwhj2h7ck5qbntt0xdcm0000gn/T/order-neutral-colors-vsaomq7j/isolated` | 5 | 1 |
| `/private/var/folders/1m/qlr1bwhj2h7ck5qbntt0xdcm0000gn/T/order-no-drawer-3r6c807x/verify` | 24 | 0 |
| `/private/var/folders/1m/qlr1bwhj2h7ck5qbntt0xdcm0000gn/T/order-scenarios-tj3fzswj/verify-worktree` | 18 | 0 |
| `/private/var/folders/1m/qlr1bwhj2h7ck5qbntt0xdcm0000gn/T/order-single-qr-07yjggk5/visual-worktree` | 53 | 1 |
| `/private/var/folders/1m/qlr1bwhj2h7ck5qbntt0xdcm0000gn/T/orders-architecture-audit-3kxt87n0/verify` | 34 | 0 |
| `/private/var/folders/1m/qlr1bwhj2h7ck5qbntt0xdcm0000gn/T/orders-background-task-31p3c8_y/verify` | 3 | 0 |
| `/private/var/folders/1m/qlr1bwhj2h7ck5qbntt0xdcm0000gn/T/orders-card-fill-task-4kesofwz/verify` | 2 | 0 |
| `/private/var/folders/1m/qlr1bwhj2h7ck5qbntt0xdcm0000gn/T/orders-layout-task-_57ait81/verify` | 6 | 0 |
| `/private/var/folders/1m/qlr1bwhj2h7ck5qbntt0xdcm0000gn/T/remove-task-print-ruwsfavv/verify-worktree` | 24 | 1 |

## 验证

- 全量 Vitest：567 个文件通过，5881 项通过、43 项跳过（5924 项）；使用已迁移并种子的隔离数据库 `erp_pr_workspace_20260910`，未使用业务开发库。
- `pnpm typecheck`：通过。
- `pnpm lint`：通过；原有两个未使用变量警告保持不变，UI 文案和令牌无新增违规。
- `pnpm check:architecture`：仍失败于基线的 13 项超长函数，名单及行数与主分支前次验证相同；未放宽阈值。见 [集成记录](2026-09-10-workspace-pr-integration.md)。
- `git diff --check`：通过。
- 日志：本机 `/tmp/erp-recover-worktrees/{unit,types,lint,architecture}.log`。

仅代码块提取，不涉及 UI、路由、数据库结构或金额计算公式，未重复执行视觉或打印检查。既有测试未修改。本次验证不宣称架构门禁全绿。
