# 新建工单一直待重新核价：空文本一致性修复

基线 `f84f7712`，分支 `codex/maindev`；开始时工作区与暂存区干净。范围仅为前端报价事实标识、回归测试与任务记录；不修改价格引擎、授权、数据库或提交校验。

## 原因与修复

在用户当前 `/orders/new` 页面只读调试确认：`useWatch` 中 `manualQuoteReason` 为 null，而 DOM 注册后 `getValues()` 为字符串空值。页面产生的 factsKey 与发请求前现取的 factsKey 不同，500ms 定时回调直接返回，没有发出新请求，但 `internalQuoteNeedsRefresh` 持续锁住按钮，纸箱/快递显示待重新核价。此处不是服务端一直计算。

`quoteFactsKey` 对 `manualQuoteReason` 和 `artworkVersion` 按现有 `optionalTrimmedText` schema 先 trim，再将空值统一为 null。两端复用该函数；非空真实修改仍改变标识，保留过期响应防护。

浏览器还保留过旧的 product.ts 编译错误；当前源码无该错误，类型检查通过，新页面无 console error。本轮未改 product.ts，也未将旧错误误当作核价根因。

## 验证

- 修复前两条新增断言失败（2 失败、4 通过），日志 `/tmp/quote-empty-before.log`。
- 修复后统一报价、物流、移除款式目标测试 25 通过；随后完整 OrderForm 文件筛选 6 文件 68 项通过、0 失败/跳过，包含 null/空字符串/空白字符同标识及真实文本变化异标识。日志 `/tmp/quote-empty-form-tests.log`。
- `pnpm typecheck` 通过；`pnpm lint` 退出 0，3 个既有 warning、0 error，UI 文案与令牌门禁通过。日志 `/tmp/quote-empty-types.log`、`/tmp/quote-empty-lint.log`。
- 真实 Next 开发页面：新开页恢复用户已保存本地草稿，未创建或提交工单。1000 个时加工 190.00、入袋 10.00、纸箱 3.00、快递 11.80，合计 214.80，按钮恢复；将数量改为 1200 后自动更新至 259.80，再恢复原 1000 个，合计回到 214.80，console error 为空。
- 旧标签页刷新未实际重载（timeOrigin 未改变），因此保留旧标签，另保留恢复草稿后的验证页面供用户继续；未清除存储或绕过离开保护。

边界：这是开发模式的真实核价读取验证，不包含新建落库、发布构建、生产环境或外部销售登录会话验收。外部销售复用的标识函数由回归测试覆盖。未改布局，不追加视觉基线；本轮未重复全量数据库测试。未推送、未部署。
