-- 业主 2026-10-01：月账单确认后发现少收，除原有「抵扣」（负数）外允许录「补收」（正数）。
-- 两者共用 AgentMonthlyBillCredit / AgentMonthlyBillAdjustment：requestedAmount 与分摊
-- amount 的符号即方向。来源工单的净额仍不能为负（validate_agent_monthly_bill_credit 的
-- 累计 >= -结算金额 规则对两种方向原样成立，无需改动）。
BEGIN;

ALTER TABLE "AgentMonthlyBillCredit"
  DROP CONSTRAINT "AgentMonthlyBillCredit_amount_reason_check";
ALTER TABLE "AgentMonthlyBillCredit"
  ADD CONSTRAINT "AgentMonthlyBillCredit_amount_reason_check"
    CHECK (
      "requestedAmount" <> 0
      AND length(btrim("reason")) BETWEEN 1 AND 500
      AND length(btrim("idempotencyKey")) BETWEEN 1 AND 128
    );

ALTER TABLE "AgentMonthlyBillAdjustment"
  DROP CONSTRAINT "AgentMonthlyBillAdjustment_amount_check";
ALTER TABLE "AgentMonthlyBillAdjustment"
  ADD CONSTRAINT "AgentMonthlyBillAdjustment_amount_check"
    CHECK ("amount" <> 0);

-- 补收会让本月调整为正数；账单合计仍等于工单合计加调整，已确认账单合计不能为负。
ALTER TABLE "AgentMonthlyBill"
  DROP CONSTRAINT "AgentMonthlyBill_amount_check";
ALTER TABLE "AgentMonthlyBill"
  ADD CONSTRAINT "AgentMonthlyBill_amount_check"
    CHECK (
      "memberSubtotal" >= 0
      AND "totalAmount" = "memberSubtotal" + "adjustmentAmount"
      AND (
        "status" = 'DRAFT'::"AgentMonthlyBillStatus"
        OR "totalAmount" >= 0
      )
    );

-- 分摊与来源同号，且同一来源的分摊累计不超过录入金额（按绝对值）。
CREATE OR REPLACE FUNCTION validate_agent_monthly_bill_adjustment()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  credit_amount DECIMAL(12,2);
  source_agent_id TEXT;
  source_period VARCHAR(7);
  target_agent_id TEXT;
  target_period VARCHAR(7);
  target_status "AgentMonthlyBillStatus";
  allocated_total DECIMAL(12,2);
BEGIN
  SELECT
    credit."requestedAmount",
    source_bill."agentUserId",
    source_bill."period"
  INTO credit_amount, source_agent_id, source_period
  FROM "AgentMonthlyBillCredit" credit
  JOIN "AgentMonthlyBillItem" source_item
    ON source_item."id" = credit."sourceItemId"
  JOIN "AgentMonthlyBill" source_bill
    ON source_bill."id" = source_item."billId"
  WHERE credit."id" = NEW."creditId"
  FOR UPDATE OF credit;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Adjustment credit does not exist';
  END IF;

  SELECT "agentUserId", "period", "status"
  INTO target_agent_id, target_period, target_status
  FROM "AgentMonthlyBill"
  WHERE "id" = NEW."billId"
  FOR UPDATE;

  IF NOT FOUND
    OR target_status <> 'DRAFT'::"AgentMonthlyBillStatus"
    OR target_agent_id <> source_agent_id
    OR target_period <= source_period
  THEN
    RAISE EXCEPTION 'Credit allocations require a later DRAFT bill for the same agent';
  END IF;

  IF sign(NEW."amount") <> sign(credit_amount) THEN
    RAISE EXCEPTION 'Credit allocation must have the same direction as its credit';
  END IF;

  SELECT COALESCE(sum("amount"), 0) + NEW."amount"
  INTO allocated_total
  FROM "AgentMonthlyBillAdjustment"
  WHERE "creditId" = NEW."creditId"
    AND "id" <> NEW."id";

  IF abs(allocated_total) > abs(credit_amount) THEN
    RAISE EXCEPTION 'Credit allocation exceeds the requested amount';
  END IF;

  RETURN NEW;
END;
$$;

COMMIT;
