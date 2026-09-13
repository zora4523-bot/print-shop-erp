# 批量操作栏布局修复

- 起始 SHA：18ede9f8ea4a633767e005cf3e663760dc9baa44；本记录对应其后的本任务提交。
- 范围：三个操作栏组件及完整操作栏浏览器回归；原有四处未跟踪截图目录不纳入提交。
- 缺陷证据：用户截图中打印说明使嵌套 flex 容器变高，下发生产及导出按钮垂直居中偏低。
- 修复：打印控件提供 action/result 布局组合，操作按钮和生成结果分行；已选数量与取消选择对齐首行。
- 首轮回归发现 768/1024px 下取消选择被结果内容挤到下一行，改中间区域 flex-basis 为 0 后通过。

验证采用 Chromium 组件模式、模拟打印 action/status，无数据库写入：

- `pnpm test:browser components/business/order/__tests__/AdminOrderBatchActions.browser.spec.tsx components/business/order/__tests__/BatchPrintControls.browser.spec.tsx`：37 通过，0 失败、0 跳过。六标准视口、明暗主题、四种状态，按钮几何/触控、overflow、axe。
- `pnpm test --run components/business/order/__tests__/OrderListBatchSelection.test.tsx`：7 通过。
- `pnpm typecheck`：通过。
- `pnpm lint`：0 错误；global-error.tsx 与 OrderForm.tsx 两处既有导航警告。文案与令牌检查通过。
- 日志：`/tmp/batch-layout-{browser,unit,type,lint}.log`。
- 本次未修改 PDF 模板、生成任务或业务授权；未更新截图基线。
- 实际开发页面 `/orders` 20 单生成完成后核验：下发生产、打印所选、导出所选、取消选择 top 均为 372px，高度均为 44px；两个 PDF 链接 top 均为 433px。已检查截图。
