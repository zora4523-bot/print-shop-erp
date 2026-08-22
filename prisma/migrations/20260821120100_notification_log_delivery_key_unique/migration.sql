-- (deliveryKey, channelId) 唯一 —— 一次逻辑投递对一个 channel 只留一行，重试
-- 时 upsert 就地翻转状态，而不是层层堆 FAILED 行。索引前缀同时服务
-- 「查这次投递已成功的 channel」这条读路径。
--
-- 存量行 deliveryKey 全是 NULL，PG 唯一索引默认 NULLS DISTINCT（多条 NULL
-- 互不冲突），所以建索引不会因历史数据失败。
--
-- CONCURRENTLY 是为了不阻塞线上通知写入；注意本文件**不要**加 BEGIN，
-- CONCURRENTLY 不能跑在事务块里（仓库既有的 CONCURRENTLY 迁移同样没有）。
-- 索引名必须与 Prisma 对 @@unique([deliveryKey, channelId]) 的默认命名一致，
-- 否则 prisma migrate diff 会报 drift。
--
-- **先 DROP 再 CREATE，且刻意不写 IF NOT EXISTS**：CONCURRENTLY 建索引中途
-- 失败（死锁 / 连接断开 / 迁移被 Ctrl-C）会在库里留下 indisvalid=false 的
-- INVALID 索引。带 IF NOT EXISTS 重跑会静默跳过它，索引永远无效 —— 而
-- PostgreSQL 不会拿 INVALID 索引当 ON CONFLICT 的 arbiter，于是 notify 的
-- upsert 每次都报错进 catch，幂等凭证全丢、重试对所有群重复推送。这跟仓库
-- 里其它「失败只是少个优化」的 CONCURRENTLY 索引不同，这一条是正确性依赖。
-- 部署后请验收：
--   SELECT indisvalid FROM pg_index
--    WHERE indexrelid = '"NotificationLog_deliveryKey_channelId_key"'::regclass;

DROP INDEX IF EXISTS "NotificationLog_deliveryKey_channelId_key";

CREATE UNIQUE INDEX CONCURRENTLY "NotificationLog_deliveryKey_channelId_key"
  ON "NotificationLog"("deliveryKey", "channelId");
