-- durable 通知重试的幂等依据。deliveryKey 取 BackgroundJob.dedupeKey：同一条
-- 逻辑投递在多次 attempt 之间稳定不变，worker 据此跳过已经推成功的 channel。
--
-- 纯加列、可空、无默认值，不重写表、不需要回填：历史行留 NULL，老代码路径
-- （inline 模式 / owner 测试发送）继续写 NULL，行为完全不变。
-- 唯一索引拆到下一个迁移里建（CONCURRENTLY 不能和别的 DDL 同处一个事务块）。

ALTER TABLE "NotificationLog" ADD COLUMN "deliveryKey" TEXT;
