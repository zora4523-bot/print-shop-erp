-- Persist the exact request-time monthly-bill export projection. The worker
-- consumes only these immutable rows, so queue delay cannot change membership,
-- status, totals, children, or receipts.
CREATE TABLE "AgentMonthlyBillExportSnapshot" (
  "id" TEXT NOT NULL,
  "exportId" TEXT NOT NULL,
  "billId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "payload" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AgentMonthlyBillExportSnapshot_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AgentMonthlyBillExportSnapshot_sequence_check"
    CHECK ("sequence" >= 0),
  CONSTRAINT "AgentMonthlyBillExportSnapshot_payload_check"
    CHECK (jsonb_typeof("payload") = 'object')
);

CREATE UNIQUE INDEX "AgentMonthlyBillExportSnapshot_exportId_billId_key"
  ON "AgentMonthlyBillExportSnapshot"("exportId", "billId");
CREATE UNIQUE INDEX "AgentMonthlyBillExportSnapshot_exportId_sequence_key"
  ON "AgentMonthlyBillExportSnapshot"("exportId", "sequence");
CREATE INDEX "AgentMonthlyBillExportSnapshot_billId_idx"
  ON "AgentMonthlyBillExportSnapshot"("billId");

ALTER TABLE "AgentMonthlyBillExportSnapshot"
  ADD CONSTRAINT "AgentMonthlyBillExportSnapshot_exportId_fkey"
  FOREIGN KEY ("exportId") REFERENCES "AgentMonthlyBillExport"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TRIGGER "AgentMonthlyBillExportSnapshot_immutable"
BEFORE UPDATE OR DELETE ON "AgentMonthlyBillExportSnapshot"
FOR EACH ROW
EXECUTE FUNCTION prevent_admin_ledger_mutation();

-- A direct SQL settlement update racing DRAFT -> CONFIRMED previously could
-- observe the last committed DRAFT state and pass Order_protect_billed_settlement
-- while the confirmation trigger read an unlocked Order row. Lock every member
-- Order in stable id order before revalidating. The concurrent settlement writer
-- then waits until confirmation commits and is rejected by the existing guard.
CREATE OR REPLACE FUNCTION validate_agent_monthly_bill_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  member_total DECIMAL(12,2);
  adjustment_total DECIMAL(12,2);
  receipt_row "AgentMonthlyBillReceipt"%ROWTYPE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'DRAFT'::"AgentMonthlyBillStatus" THEN
      RAISE EXCEPTION 'Agent monthly bills must start in DRAFT';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD."status" = 'PAID'::"AgentMonthlyBillStatus" THEN
    RAISE EXCEPTION 'Paid agent monthly bills are immutable';
  END IF;

  IF OLD."status" = 'CONFIRMED'::"AgentMonthlyBillStatus" THEN
    IF NEW."status" <> 'PAID'::"AgentMonthlyBillStatus"
      OR NEW."agentUserId" <> OLD."agentUserId"
      OR NEW."period" <> OLD."period"
      OR NEW."agentUsernameSnapshot" <> OLD."agentUsernameSnapshot"
      OR NEW."agentDisplayNameSnapshot" <> OLD."agentDisplayNameSnapshot"
      OR NEW."memberSubtotal" <> OLD."memberSubtotal"
      OR NEW."adjustmentAmount" <> OLD."adjustmentAmount"
      OR NEW."totalAmount" <> OLD."totalAmount"
      OR NEW."confirmedById" <> OLD."confirmedById"
      OR NEW."confirmedAt" <> OLD."confirmedAt"
    THEN
      RAISE EXCEPTION 'Confirmed agent monthly bills only transition to PAID';
    END IF;

    SELECT * INTO receipt_row
    FROM "AgentMonthlyBillReceipt"
    WHERE "billId" = OLD."id"
    FOR SHARE;

    IF NOT FOUND
      OR receipt_row."amount" <> OLD."totalAmount"
      OR NEW."paidById" <> receipt_row."recordedById"
      OR NEW."paidAt" <> receipt_row."receivedAt"
    THEN
      RAISE EXCEPTION 'PAID transition requires the matching immutable full receipt';
    END IF;

    RETURN NEW;
  END IF;

  IF OLD."status" <> 'DRAFT'::"AgentMonthlyBillStatus"
    OR NEW."status" NOT IN (
      'DRAFT'::"AgentMonthlyBillStatus",
      'CONFIRMED'::"AgentMonthlyBillStatus"
    )
  THEN
    RAISE EXCEPTION 'Invalid agent monthly bill status transition';
  END IF;

  IF NEW."status" = 'CONFIRMED'::"AgentMonthlyBillStatus" THEN
    PERFORM 1
    FROM "Order" order_row
    JOIN "AgentMonthlyBillItem" item ON item."orderId" = order_row."id"
    WHERE item."billId" = NEW."id"
    ORDER BY order_row."id"
    FOR SHARE OF order_row;

    SELECT COALESCE(sum("settledFeeSnapshot"), 0)
    INTO member_total
    FROM "AgentMonthlyBillItem"
    WHERE "billId" = NEW."id";

    SELECT COALESCE(sum("amount"), 0)
    INTO adjustment_total
    FROM "AgentMonthlyBillAdjustment"
    WHERE "billId" = NEW."id";

    IF NEW."memberSubtotal" <> member_total
      OR NEW."adjustmentAmount" <> adjustment_total
      OR NEW."totalAmount" <> member_total + adjustment_total
      OR NEW."totalAmount" < 0
    THEN
      RAISE EXCEPTION 'Agent monthly bill totals do not match frozen members and allocations';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM "AgentMonthlyBillItem" item
      JOIN "Order" order_row ON order_row."id" = item."orderId"
      WHERE item."billId" = NEW."id"
        AND (
          order_row."submitterId" <> NEW."agentUserId"
          OR order_row."settlementType" <> 'EXTERNAL_SALES'::"OrderSettlementType"
          OR order_row."billingMode" <> 'CHARGE'::"OrderBillingMode"
          OR order_row."status" NOT IN (
            'SETTLED'::"OrderStatus",
            'CANCELLED'::"OrderStatus"
          )
          OR order_row."settledFee" IS NULL
          OR order_row."settledAt" IS NULL
          OR to_char(
            order_row."settledAt" AT TIME ZONE 'Asia/Shanghai',
            'YYYY-MM'
          ) <> NEW."period"
          OR item."orderNoSnapshot" <> order_row."orderNo"
          OR item."workOrderVersionSnapshot" <> order_row."workOrderVersion"
          OR item."orderStatusSnapshot" <> order_row."status"::TEXT
          OR item."customerRefSnapshot" IS DISTINCT FROM order_row."customerRef"
          OR item."settledFeeSnapshot" <> order_row."settledFee"
          OR item."settledAtSnapshot" <> order_row."settledAt"
        )
    ) THEN
      RAISE EXCEPTION 'Agent monthly bill contains stale order snapshots';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
