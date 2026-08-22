-- /owner/salary 的三个「累计未发」聚合都以布尔列作唯一等值谓词，这三张表
-- 此前都没有能让它打头的索引。CONCURRENTLY 是为了在生产上加索引时不阻塞
-- 日薪/月结的写入；注意本文件**不要**加 BEGIN;，CONCURRENTLY 不能跑在
-- 事务块里（仓库既有的 CONCURRENTLY 迁移同样没有 BEGIN）。

CREATE INDEX CONCURRENTLY IF NOT EXISTS "DailyWorkerSalary_isPaid_date_idx"
  ON "DailyWorkerSalary"("isPaid", "date");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "HourlyWorkerPayroll_isPaid_month_idx"
  ON "HourlyWorkerPayroll"("isPaid", "month");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "CustomerServiceCommission_isFullyPaid_settledAt_idx"
  ON "CustomerServiceCommission"("isFullyPaid", "settledAt");
