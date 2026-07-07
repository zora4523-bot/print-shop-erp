-- 承诺交期（对客户）：dashboard 交期预警 + 每日 cron 逾期推送按此列扫描。
ALTER TABLE "Order" ADD COLUMN "promisedDate" TIMESTAMP(3);

CREATE INDEX "Order_promisedDate_idx" ON "Order"("promisedDate");
