-- 工单号从 YYYYMMDD-XXXX 调整为更易识别、口头核对的 GD-YYMMDD-XXX。
-- Order.orderNo 是普通 TEXT；历史工单号必须原样保留，只同步格式说明。
UPDATE "Setting"
SET
  "value" = '{"format":"GD-YYMMDD-XXX"}'::jsonb,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "key" = 'order_no_prefix';
