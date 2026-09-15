# 批量打印修复验收（2026-09-13）

起始提交：`39908a2`。本次工作区增量仅涉及批量打印、打印页眉/图稿地址、测试样例及对应测试文档。原有四个未跟踪截图目录保留，不提交。

## 修复范围

- 后端区分 queued/rendering/merging；两分钟后客户端每十秒继续查询，不丢失完成入口。
- 同账号、同有序内容复用进行中的任务，同一十五分钟时间窗复用有效成品；失败或文件缺失可重新生成。
- 单张 PDF 使用账号及内容快照键缓存一小时。缓存命中仍复核权限、源内容，合并发布及下载前后保留完整校验。
- 超过 64 字符的工单编号限定宽度换行，普通编号保持原布局；模板版本升至 5，旧缓存失效。
- 相对图稿地址按公开站点地址解析；批量任务遇到已上传图稿加载失败时不发布或缓存占位 PDF。
- 新销售测试样例使用可读名称和有效内嵌图片，历史业务数据不批量改写。
- 本轮为按需生成和缓存复用；生产下发后的自动预生成仍是后续性能优化，不改动生产状态流程。

## 真实开发环境验收

`localhost:3000`，正常开发数据库及真实 HEAVY worker；仅创建打印任务和文件，没有修改工单内容或生产状态。

- 相同二十单重复提交复用同一任务 ID。
- 十九单重叠批次复用缓存，后台合并耗时 2671 ms（任务 `cmtzfhhnw000gdw0reoz94j3i`）。
- 原二十单 PDF 由 29 页变为 21 页，移除八张长编号工单的多余续页，保留一个实际地址附页。
- 最终版本任务 `cmtzfqjmk000idw0r9z809ama` 成功，21 页，下载 200。图稿加载失败提示消失；长编号单款页经渲染检查，没有裁切或挤出第二页。
- 等待超过两分钟后进度继续自动更新至完成，显示下载及打开入口。

## 自动验证

- `pnpm exec vitest run --maxWorkers=2`：605 文件通过、3 文件跳过；6492 测试通过、55 跳过。
- `pnpm typecheck`：通过。
- `pnpm lint`：0 错误，2 条既有 `no-location-assign-relative-destination` 警告；UI 文案和令牌门禁通过。
- `pnpm exec vitest run --config vitest.browser.config.ts components/business/order/__tests__/BatchPrintControls.browser.spec.tsx`：13 通过，包含六视口/明暗主题、队列提示、超两分钟继续查询和下载入口。
- `pnpm exec playwright test tests/e2e/sales-functional-review.spec.ts --project=chromium`（与视觉文件一起运行）：14 用例首次通过，管理员保存同步用例单独重跑通过，覆盖新样例名称和图稿补正流程。
- `pnpm exec playwright test tests/visual/order-print.spec.ts --project=chromium`：27 通过、1 既有截图差异；另行对起始提交复测确认同样差异，见下节。没有更新基线。
- E2E 使用 `E2E_DURABLE_MODE=1` 隔离构建目录、`http://127.0.0.1:3100` 与独立数据库；普通后台作业仍是测试配置的 inline 模式，真实 HEAVY 验证另见上一节。
- `git diff --check`：通过。

## 既有基线差异与环境处理

独立 E2E 数据库 `erp_e2e_portable_20260911` 补齐已有 `20260911110000_shipment_registration` 迁移，未修改迁移文件或日常数据库。

打印截图“三款工单的款式、多地址与打印分页稳定”存在旧提示文案基线差异。使用起始提交的隔离工作树复测，同样失败；其实际 PNG 与最终代码生成的 PNG 完全相同，SHA-256 均为 `72e67c5ced457661d1d7a515d1e31bb2ad25ceed554284feb53fa748e1e70baa`。隔离工作树只为访问复用的依赖设置了 Turbopack root，未改动应用业务代码或模板。未更新任何基准截图。

高并发验证时出现无关五秒超时，停止重叠运行后按较低并发复测；未放宽超时、断言或覆盖率。管理员保存同步用例单独复测通过。

临时日志：`/tmp/print-fix-visual-last.log`、`/tmp/print-fix-e2e-final.log`、`/tmp/print-fix-baseline2.log`；最终验证日志前缀 `/tmp/print-fix-final-`。
