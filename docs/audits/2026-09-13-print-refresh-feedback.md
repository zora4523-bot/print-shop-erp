# 批量打印刷新反馈修复

起始 SHA：8ffc372；本记录对应其后的当前任务提交。已有四处未跟踪截图目录保留，不纳入任务。

用户反馈“查看进度”没有作用。核对时实际页面已完成 20/20 单，存在 PDF 链接；
代码显示原按钮会查询同一个任务，但没有刷新中的状态及完成反馈，进度不变时无法感知点击结果。
服务不可用与查询失败还会停止轮询，恢复后依赖手工操作。

修复范围：打印控件、两份浏览器组件测试及 UI-SYSTEM.md。
按钮改为“刷新进度”，增加加载禁用、完成及失败反馈、15 秒请求超时。
不可用时显示等待服务恢复；不可用或网络失败后每 10 秒自动重试，保留原任务。
明确失败的任务不再显示刷新按钮，保留原重新打印入口与工单错误详情。
不改变生成任务、权限或 PDF 内容。

验证（Chromium 组件模式，action/status 使用 mock，不写入数据库）：

- `pnpm test:browser components/business/order/__tests__/BatchPrintControls.browser.spec.tsx components/business/order/__tests__/AdminOrderBatchActions.browser.spec.tsx`：41 通过，无失败/跳过。
- 新增：进度相同仍反馈、刷新中禁用、不重复提交生成任务、服务恢复自动取得 PDF、刷新失败后可重试、请求超时释放加载状态。
- 完整操作栏：六标准视口 × 明暗主题，增加服务不可用状态的几何、触控、overflow、axe 验证。
- `pnpm typecheck` 通过；`pnpm lint` 无错误，global-error.tsx 和 OrderForm.tsx 两处既有导航警告。
- 日志：`/tmp/print-refresh-browser.log`、`/tmp/print-refresh-type.log`、`/tmp/print-refresh-lint.log`。
