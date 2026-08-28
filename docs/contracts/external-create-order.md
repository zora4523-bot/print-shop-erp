# 外部销售创建工单业务契约

本契约只描述外部销售建单的业务事实。浏览器不得提交任何最终价格、价表版本、费用快照或工单状态。

## 款式事实

- `fig`：正整数、单调递增、删除不回收。
- `craft`：`PARTIAL | FULL | PRINT`。
- 纸张：`paperType + weight`；自定义值允许进入人工核价，不允许取最近配置兜底。
- 烫金：只存 `frontColors[] / backColors[]`；过版次数为两个数组长度之和。
- `pack`：nullable 正整数。为 null 时包数、入袋金额为未知，不得归零。
- 专版烫金只能正面；彩印叠加专版也只能正面；彩印叠加局部可有反面。

## 报价事实

- 报价由无 IO 纯函数根据业务事实和不可变价表快照生成。
- 款级费用与订单级费用分层；纸箱、快递、制版费整单只计算一次。
- 自动价与人工核价使用判别联合；人工核价款金额为 null，并从已知合计排除。
- `priceVersion` 是 PROCESSING、LOGISTICS 两个独立版本组成的 bundle，不是单一整数。
- 制版费状态为 `PENDING_AMOUNT`，金额为 null；UI 显示“待定”，不显示 ¥0。

## 提交事实

- 流程为校验 → 复核 → 确认。
- 最终确认时服务端在同一事务重新校验缺货态和当前双价表、调用同一纯函数、追加不可变快照、只写 `quotedFee`，并转为 `PENDING_FACTORY`。
- `confirmedFee`、`settledFee` 不得从 `quotedFee` 推导或覆盖。
- `clientSubmissionId` 负责幂等；复核后事实或价表变化时返回 `QUOTE_CHANGED`，不得静默提交。
