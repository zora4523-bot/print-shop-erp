-- Expand-only foundations for the 11-state work-order workflow, versioned
-- printing, personal stars, and the parallel agent-monthly receivable ledger.
-- Legacy lifecycle values and Bill/BillItem/BillPayment remain untouched.

-- PostgreSQL enum values must commit before later statements can reference
-- them in constraints. Retrying this first phase is safe because every add is
-- guarded with IF NOT EXISTS.
BEGIN;

ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'REJECTED';
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'CONFIRMED';
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'ON_HOLD';
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'RELEASED';
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'FOILING';
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'PACKING';
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'SETTLED';

ALTER TYPE "OrderChangeRequestStatus" ADD VALUE IF NOT EXISTS 'DENIED';
ALTER TYPE "OrderChangeRequestStatus" ADD VALUE IF NOT EXISTS 'WITHDRAWN';

COMMIT;

BEGIN;

CREATE TYPE "OrderChangeRequestType" AS ENUM ('MODIFY', 'CANCEL');
CREATE TYPE "OrderChangeModifyKind" AS ENUM (
  'QTY',
  'DUE_DATE',
  'ADDRESS',
  'CRAFT_PAPER',
  'OTHER'
);
CREATE TYPE "OrderPrintKind" AS ENUM ('INITIAL', 'REPRINT');
CREATE TYPE "OrderPrintJobState" AS ENUM ('PENDING', 'PRINTED');
CREATE TYPE "OrderWorkflowAction" AS ENUM ('REJECT', 'HOLD', 'RESUME');
CREATE TYPE "OrderWorkflowReasonCode" AS ENUM (
  'PAPER_OUT',
  'DESIGN_ERROR',
  'PRICE_PENDING'
);
CREATE TYPE "AgentMonthlyBillStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'PAID');

ALTER TABLE "Order"
  ADD COLUMN "settledAt" TIMESTAMPTZ(3),
  ADD COLUMN "settlementContractVersion" INTEGER,
  ADD COLUMN "workOrderVersion" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "Order"
  ADD CONSTRAINT "Order_workOrderVersion_positive_check"
    CHECK ("workOrderVersion" >= 1) NOT VALID,
  ADD CONSTRAINT "Order_explicit_settlement_shape_check"
    CHECK (
      (
        "settlementContractVersion" IS NULL
        AND "status" <> 'SETTLED'::"OrderStatus"
      )
      OR (
        "settlementContractVersion" >= 2
        AND "settledFee" IS NOT NULL
        AND "settledFee" >= 0
        AND "settledAt" IS NOT NULL
        AND "status" IN (
          'SETTLED'::"OrderStatus",
          'CANCELLED'::"OrderStatus"
        )
      )
    ) NOT VALID;

ALTER TABLE "Order"
  VALIDATE CONSTRAINT "Order_workOrderVersion_positive_check";
ALTER TABLE "Order"
  VALIDATE CONSTRAINT "Order_explicit_settlement_shape_check";

ALTER TABLE "OrderChangeRequest"
  ADD COLUMN "type" "OrderChangeRequestType" NOT NULL DEFAULT 'MODIFY',
  ADD COLUMN "modifyKind" "OrderChangeModifyKind",
  ADD COLUMN "denyReason" TEXT,
  ADD COLUMN "producedQty" INTEGER,
  ADD COLUMN "settleFee" DECIMAL(12,2),
  ADD COLUMN "workOrderVersionAfter" INTEGER;

ALTER TABLE "OrderChangeRequest"
  ADD CONSTRAINT "OrderChangeRequest_quantity_fee_version_check"
    CHECK (
      ("producedQty" IS NULL OR "producedQty" >= 0)
      AND ("settleFee" IS NULL OR "settleFee" >= 0)
      AND (
        "workOrderVersionAfter" IS NULL
        OR "workOrderVersionAfter" >= 1
      )
    ),
  ADD CONSTRAINT "OrderChangeRequest_type_shape_check"
    CHECK (
      (
        "type" = 'MODIFY'::"OrderChangeRequestType"
        AND "producedQty" IS NULL
        AND "settleFee" IS NULL
      )
      OR (
        "type" = 'CANCEL'::"OrderChangeRequestType"
        AND "modifyKind" IS NULL
      )
    ),
  ADD CONSTRAINT "OrderChangeRequest_denial_shape_check"
    CHECK (
      "status" <> 'DENIED'::"OrderChangeRequestStatus"
      OR (
        "denyReason" IS NOT NULL
        AND length(btrim("denyReason")) BETWEEN 1 AND 500
        AND "reviewedById" IS NOT NULL
        AND "reviewedAt" IS NOT NULL
      )
    ),
  ADD CONSTRAINT "OrderChangeRequest_cancel_approval_shape_check"
    CHECK (
      "type" <> 'CANCEL'::"OrderChangeRequestType"
      OR "status" <> 'APPROVED'::"OrderChangeRequestStatus"
      OR (
        "producedQty" IS NOT NULL
        AND "settleFee" IS NOT NULL
        AND "reviewedById" IS NOT NULL
        AND "reviewedAt" IS NOT NULL
      )
    );

CREATE TABLE "UserOrderStar" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "UserOrderStar_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OrderPrintJob" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "workOrderVersion" INTEGER NOT NULL,
  "printKind" "OrderPrintKind" NOT NULL,
  "reason" VARCHAR(64) NOT NULL,
  "state" "OrderPrintJobState" NOT NULL DEFAULT 'PENDING',
  "requestJobId" TEXT,
  "idempotencyKey" VARCHAR(128) NOT NULL,
  "createdById" TEXT,
  "printedById" TEXT,
  "printedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "OrderPrintJob_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OrderPrintJob_workOrderVersion_positive_check"
    CHECK ("workOrderVersion" >= 1),
  CONSTRAINT "OrderPrintJob_reason_check"
    CHECK (length(btrim("reason")) BETWEEN 1 AND 64),
  CONSTRAINT "OrderPrintJob_idempotency_key_check"
    CHECK (length(btrim("idempotencyKey")) BETWEEN 1 AND 128),
  CONSTRAINT "OrderPrintJob_state_shape_check"
    CHECK (
      (
        "state" = 'PENDING'::"OrderPrintJobState"
        AND "requestJobId" IS NULL
        AND "printedById" IS NULL
        AND "printedAt" IS NULL
      )
      OR (
        "state" = 'PRINTED'::"OrderPrintJobState"
        AND "requestJobId" IS NOT NULL
        AND "printedById" IS NOT NULL
        AND "printedAt" IS NOT NULL
      )
  )
);

CREATE TABLE "OrderWorkflowDecision" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "fromStatus" "OrderStatus" NOT NULL,
  "toStatus" "OrderStatus" NOT NULL,
  "action" "OrderWorkflowAction" NOT NULL,
  "reasonCode" "OrderWorkflowReasonCode",
  "reasonNote" VARCHAR(500),
  "affectedFigs" JSONB,
  "recoveryEvidence" JSONB,
  "actorId" TEXT NOT NULL,
  "idempotencyKey" VARCHAR(128) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "OrderWorkflowDecision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OrderWorkflowDecision_idempotency_key_check"
    CHECK (length(btrim("idempotencyKey")) BETWEEN 1 AND 128),
  CONSTRAINT "OrderWorkflowDecision_reason_note_check"
    CHECK (
      "reasonNote" IS NULL
      OR length(btrim("reasonNote")) BETWEEN 1 AND 500
    ),
  CONSTRAINT "OrderWorkflowDecision_affected_figs_check"
    CHECK (
      "affectedFigs" IS NULL
      OR jsonb_typeof("affectedFigs") = 'array'
    ),
  CONSTRAINT "OrderWorkflowDecision_action_shape_check"
    CHECK (
      (
        "action" = 'REJECT'::"OrderWorkflowAction"
        AND "fromStatus" = 'PENDING_FACTORY'::"OrderStatus"
        AND "toStatus" = 'REJECTED'::"OrderStatus"
        AND "reasonCode" IS NOT NULL
        AND "reasonNote" IS NOT NULL
        AND "recoveryEvidence" IS NULL
      )
      OR (
        "action" = 'HOLD'::"OrderWorkflowAction"
        AND "fromStatus" IN (
          'CONFIRMED'::"OrderStatus",
          'RELEASED'::"OrderStatus",
          'FOILING'::"OrderStatus",
          'PACKING'::"OrderStatus"
        )
        AND "toStatus" = 'ON_HOLD'::"OrderStatus"
        AND "reasonCode" IS NOT NULL
        AND "reasonNote" IS NOT NULL
        AND "recoveryEvidence" IS NULL
      )
      OR (
        "action" = 'RESUME'::"OrderWorkflowAction"
        AND "fromStatus" = 'ON_HOLD'::"OrderStatus"
        AND "toStatus" IN (
          'CONFIRMED'::"OrderStatus",
          'RELEASED'::"OrderStatus",
          'FOILING'::"OrderStatus",
          'PACKING'::"OrderStatus"
        )
        AND "reasonCode" IS NULL
        AND "recoveryEvidence" IS NOT NULL
        AND jsonb_typeof("recoveryEvidence") = 'object'
        AND "recoveryEvidence" <> '{}'::jsonb
      )
    )
);

CREATE TABLE "OrderExportSelection" (
  "id" TEXT NOT NULL,
  "exportId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "OrderExportSelection_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OrderExportSelection_sequence_nonnegative_check"
    CHECK ("sequence" >= 0)
);

CREATE TABLE "AgentMonthlyBill" (
  "id" TEXT NOT NULL,
  "agentUserId" TEXT NOT NULL,
  "period" VARCHAR(7) NOT NULL,
  "agentUsernameSnapshot" TEXT NOT NULL,
  "agentDisplayNameSnapshot" TEXT NOT NULL,
  "memberSubtotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "adjustmentAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "totalAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "status" "AgentMonthlyBillStatus" NOT NULL DEFAULT 'DRAFT',
  "confirmedById" TEXT,
  "confirmedAt" TIMESTAMPTZ(3),
  "paidById" TEXT,
  "paidAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "AgentMonthlyBill_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AgentMonthlyBill_period_check"
    CHECK ("period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  CONSTRAINT "AgentMonthlyBill_snapshot_check"
    CHECK (
      length(btrim("agentUsernameSnapshot")) > 0
      AND length(btrim("agentDisplayNameSnapshot")) > 0
    ),
  CONSTRAINT "AgentMonthlyBill_amount_check"
    CHECK (
      "memberSubtotal" >= 0
      AND "adjustmentAmount" <= 0
      AND "totalAmount" = "memberSubtotal" + "adjustmentAmount"
      AND (
        "status" = 'DRAFT'::"AgentMonthlyBillStatus"
        OR "totalAmount" >= 0
      )
    ),
  CONSTRAINT "AgentMonthlyBill_status_shape_check"
    CHECK (
      (
        "status" = 'DRAFT'::"AgentMonthlyBillStatus"
        AND "confirmedById" IS NULL
        AND "confirmedAt" IS NULL
        AND "paidById" IS NULL
        AND "paidAt" IS NULL
      )
      OR (
        "status" = 'CONFIRMED'::"AgentMonthlyBillStatus"
        AND "confirmedById" IS NOT NULL
        AND "confirmedAt" IS NOT NULL
        AND "paidById" IS NULL
        AND "paidAt" IS NULL
      )
      OR (
        "status" = 'PAID'::"AgentMonthlyBillStatus"
        AND "confirmedById" IS NOT NULL
        AND "confirmedAt" IS NOT NULL
        AND "paidById" IS NOT NULL
        AND "paidAt" IS NOT NULL
      )
    )
);

CREATE TABLE "AgentMonthlyBillItem" (
  "id" TEXT NOT NULL,
  "billId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "orderNoSnapshot" TEXT NOT NULL,
  "workOrderVersionSnapshot" INTEGER NOT NULL,
  "orderStatusSnapshot" VARCHAR(32) NOT NULL,
  "customerRefSnapshot" TEXT,
  "settledFeeSnapshot" DECIMAL(12,2) NOT NULL,
  "settledAtSnapshot" TIMESTAMPTZ(3) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "AgentMonthlyBillItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AgentMonthlyBillItem_snapshot_check"
    CHECK (
      length(btrim("orderNoSnapshot")) > 0
      AND length(btrim("orderStatusSnapshot")) > 0
      AND "workOrderVersionSnapshot" >= 1
      AND "settledFeeSnapshot" >= 0
    )
);

CREATE TABLE "AgentMonthlyBillCredit" (
  "id" TEXT NOT NULL,
  "sourceItemId" TEXT NOT NULL,
  "requestedAmount" DECIMAL(12,2) NOT NULL,
  "reason" TEXT NOT NULL,
  "idempotencyKey" VARCHAR(128) NOT NULL,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AgentMonthlyBillCredit_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AgentMonthlyBillCredit_amount_reason_check"
    CHECK (
      "requestedAmount" < 0
      AND length(btrim("reason")) BETWEEN 1 AND 500
      AND length(btrim("idempotencyKey")) BETWEEN 1 AND 128
    )
);

CREATE TABLE "AgentMonthlyBillAdjustment" (
  "id" TEXT NOT NULL,
  "billId" TEXT NOT NULL,
  "creditId" TEXT NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AgentMonthlyBillAdjustment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AgentMonthlyBillAdjustment_amount_check"
    CHECK ("amount" < 0)
);

CREATE TABLE "AgentMonthlyBillReceipt" (
  "id" TEXT NOT NULL,
  "billId" TEXT NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "receivedAt" TIMESTAMPTZ(3) NOT NULL,
  "paymentMethod" TEXT,
  "referenceNo" TEXT,
  "idempotencyKey" VARCHAR(128) NOT NULL,
  "recordedById" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AgentMonthlyBillReceipt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AgentMonthlyBillReceipt_amount_key_check"
    CHECK (
      "amount" >= 0
      AND length(btrim("idempotencyKey")) BETWEEN 1 AND 128
    )
);

CREATE UNIQUE INDEX "UserOrderStar_userId_orderId_key"
  ON "UserOrderStar"("userId", "orderId");
CREATE INDEX "UserOrderStar_orderId_idx"
  ON "UserOrderStar"("orderId");

CREATE UNIQUE INDEX "OrderPrintJob_requestJobId_key"
  ON "OrderPrintJob"("requestJobId");
CREATE UNIQUE INDEX "OrderPrintJob_idempotencyKey_key"
  ON "OrderPrintJob"("idempotencyKey");
CREATE INDEX "OrderPrintJob_orderId_state_createdAt_idx"
  ON "OrderPrintJob"("orderId", "state", "createdAt" DESC);
CREATE INDEX "OrderPrintJob_printedById_printedAt_idx"
  ON "OrderPrintJob"("printedById", "printedAt");

CREATE UNIQUE INDEX "OrderWorkflowDecision_idempotencyKey_key"
  ON "OrderWorkflowDecision"("idempotencyKey");
CREATE INDEX "OrderWorkflowDecision_orderId_createdAt_idx"
  ON "OrderWorkflowDecision"("orderId", "createdAt" DESC);
CREATE INDEX "OrderWorkflowDecision_actorId_createdAt_idx"
  ON "OrderWorkflowDecision"("actorId", "createdAt" DESC);
CREATE INDEX "OrderWorkflowDecision_action_createdAt_idx"
  ON "OrderWorkflowDecision"("action", "createdAt" DESC);

CREATE UNIQUE INDEX "OrderExportSelection_exportId_orderId_key"
  ON "OrderExportSelection"("exportId", "orderId");
CREATE UNIQUE INDEX "OrderExportSelection_exportId_sequence_key"
  ON "OrderExportSelection"("exportId", "sequence");
CREATE INDEX "OrderExportSelection_orderId_idx"
  ON "OrderExportSelection"("orderId");

CREATE INDEX "OrderChangeRequest_type_status_createdAt_idx"
  ON "OrderChangeRequest"("type", "status", "createdAt");

CREATE UNIQUE INDEX "AgentMonthlyBill_agentUserId_period_key"
  ON "AgentMonthlyBill"("agentUserId", "period");
CREATE INDEX "AgentMonthlyBill_period_status_idx"
  ON "AgentMonthlyBill"("period", "status");
CREATE INDEX "AgentMonthlyBill_status_createdAt_idx"
  ON "AgentMonthlyBill"("status", "createdAt" DESC);
CREATE INDEX "AgentMonthlyBill_confirmedById_idx"
  ON "AgentMonthlyBill"("confirmedById");
CREATE INDEX "AgentMonthlyBill_paidById_idx"
  ON "AgentMonthlyBill"("paidById");

CREATE UNIQUE INDEX "AgentMonthlyBillItem_orderId_key"
  ON "AgentMonthlyBillItem"("orderId");
CREATE UNIQUE INDEX "AgentMonthlyBillItem_billId_orderId_key"
  ON "AgentMonthlyBillItem"("billId", "orderId");
CREATE INDEX "AgentMonthlyBillItem_billId_settledAtSnapshot_idx"
  ON "AgentMonthlyBillItem"("billId", "settledAtSnapshot");

CREATE UNIQUE INDEX "AgentMonthlyBillCredit_idempotencyKey_key"
  ON "AgentMonthlyBillCredit"("idempotencyKey");
CREATE INDEX "AgentMonthlyBillCredit_sourceItemId_createdAt_idx"
  ON "AgentMonthlyBillCredit"("sourceItemId", "createdAt");
CREATE INDEX "AgentMonthlyBillCredit_createdById_createdAt_idx"
  ON "AgentMonthlyBillCredit"("createdById", "createdAt");

CREATE UNIQUE INDEX "AgentMonthlyBillAdjustment_creditId_billId_key"
  ON "AgentMonthlyBillAdjustment"("creditId", "billId");
CREATE INDEX "AgentMonthlyBillAdjustment_billId_createdAt_idx"
  ON "AgentMonthlyBillAdjustment"("billId", "createdAt");

CREATE UNIQUE INDEX "AgentMonthlyBillReceipt_billId_key"
  ON "AgentMonthlyBillReceipt"("billId");
CREATE UNIQUE INDEX "AgentMonthlyBillReceipt_idempotencyKey_key"
  ON "AgentMonthlyBillReceipt"("idempotencyKey");
CREATE INDEX "AgentMonthlyBillReceipt_recordedById_receivedAt_idx"
  ON "AgentMonthlyBillReceipt"("recordedById", "receivedAt");

ALTER TABLE "UserOrderStar"
  ADD CONSTRAINT "UserOrderStar_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserOrderStar"
  ADD CONSTRAINT "UserOrderStar_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OrderPrintJob"
  ADD CONSTRAINT "OrderPrintJob_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderPrintJob"
  ADD CONSTRAINT "OrderPrintJob_requestJobId_fkey"
  FOREIGN KEY ("requestJobId") REFERENCES "OrderPrintJob"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderPrintJob"
  ADD CONSTRAINT "OrderPrintJob_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderPrintJob"
  ADD CONSTRAINT "OrderPrintJob_printedById_fkey"
  FOREIGN KEY ("printedById") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OrderWorkflowDecision"
  ADD CONSTRAINT "OrderWorkflowDecision_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderWorkflowDecision"
  ADD CONSTRAINT "OrderWorkflowDecision_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OrderExportSelection"
  ADD CONSTRAINT "OrderExportSelection_exportId_fkey"
  FOREIGN KEY ("exportId") REFERENCES "OrderExport"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderExportSelection"
  ADD CONSTRAINT "OrderExportSelection_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AgentMonthlyBill"
  ADD CONSTRAINT "AgentMonthlyBill_agentUserId_fkey"
  FOREIGN KEY ("agentUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AgentMonthlyBill"
  ADD CONSTRAINT "AgentMonthlyBill_confirmedById_fkey"
  FOREIGN KEY ("confirmedById") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AgentMonthlyBill"
  ADD CONSTRAINT "AgentMonthlyBill_paidById_fkey"
  FOREIGN KEY ("paidById") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AgentMonthlyBillItem"
  ADD CONSTRAINT "AgentMonthlyBillItem_billId_fkey"
  FOREIGN KEY ("billId") REFERENCES "AgentMonthlyBill"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AgentMonthlyBillItem"
  ADD CONSTRAINT "AgentMonthlyBillItem_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AgentMonthlyBillCredit"
  ADD CONSTRAINT "AgentMonthlyBillCredit_sourceItemId_fkey"
  FOREIGN KEY ("sourceItemId") REFERENCES "AgentMonthlyBillItem"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AgentMonthlyBillCredit"
  ADD CONSTRAINT "AgentMonthlyBillCredit_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AgentMonthlyBillAdjustment"
  ADD CONSTRAINT "AgentMonthlyBillAdjustment_billId_fkey"
  FOREIGN KEY ("billId") REFERENCES "AgentMonthlyBill"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AgentMonthlyBillAdjustment"
  ADD CONSTRAINT "AgentMonthlyBillAdjustment_creditId_fkey"
  FOREIGN KEY ("creditId") REFERENCES "AgentMonthlyBillCredit"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AgentMonthlyBillReceipt"
  ADD CONSTRAINT "AgentMonthlyBillReceipt_billId_fkey"
  FOREIGN KEY ("billId") REFERENCES "AgentMonthlyBill"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AgentMonthlyBillReceipt"
  ADD CONSTRAINT "AgentMonthlyBillReceipt_recordedById_fkey"
  FOREIGN KEY ("recordedById") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- A printed acknowledgement is a second immutable row that must resolve the
-- matching pending request for the same order/version/kind/reason.
CREATE OR REPLACE FUNCTION validate_order_print_job_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  request_row "OrderPrintJob"%ROWTYPE;
BEGIN
  IF NEW."state" = 'PENDING'::"OrderPrintJobState" THEN
    RETURN NEW;
  END IF;

  SELECT * INTO request_row
  FROM "OrderPrintJob"
  WHERE "id" = NEW."requestJobId"
  FOR SHARE;

  IF NOT FOUND
    OR request_row."state" <> 'PENDING'::"OrderPrintJobState"
    OR request_row."orderId" <> NEW."orderId"
    OR request_row."workOrderVersion" <> NEW."workOrderVersion"
    OR request_row."printKind" <> NEW."printKind"
    OR request_row."reason" <> NEW."reason"
  THEN
    RAISE EXCEPTION 'Printed OrderPrintJob must resolve its matching pending request';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "OrderPrintJob_validate_insert"
BEFORE INSERT ON "OrderPrintJob"
FOR EACH ROW
EXECUTE FUNCTION validate_order_print_job_insert();

CREATE OR REPLACE FUNCTION prevent_admin_ledger_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% rows are append-only', TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER "OrderPrintJob_immutable"
BEFORE UPDATE OR DELETE ON "OrderPrintJob"
FOR EACH ROW
EXECUTE FUNCTION prevent_admin_ledger_mutation();
CREATE TRIGGER "OrderWorkflowDecision_immutable"
BEFORE UPDATE OR DELETE ON "OrderWorkflowDecision"
FOR EACH ROW
EXECUTE FUNCTION prevent_admin_ledger_mutation();
CREATE TRIGGER "AgentMonthlyBillCredit_immutable"
BEFORE UPDATE OR DELETE ON "AgentMonthlyBillCredit"
FOR EACH ROW
EXECUTE FUNCTION prevent_admin_ledger_mutation();
CREATE TRIGGER "AgentMonthlyBillReceipt_immutable"
BEFORE UPDATE OR DELETE ON "AgentMonthlyBillReceipt"
FOR EACH ROW
EXECUTE FUNCTION prevent_admin_ledger_mutation();

-- Members are exact snapshots of settled external-sales orders. The Shanghai
-- settlement month, agent attribution and all frozen values are rechecked at
-- the database boundary instead of trusting a client payload.
CREATE OR REPLACE FUNCTION validate_agent_monthly_bill_item()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  bill_row "AgentMonthlyBill"%ROWTYPE;
  order_row "Order"%ROWTYPE;
BEGIN
  SELECT * INTO bill_row
  FROM "AgentMonthlyBill"
  WHERE "id" = NEW."billId"
  FOR UPDATE;

  IF NOT FOUND OR bill_row."status" <> 'DRAFT'::"AgentMonthlyBillStatus" THEN
    RAISE EXCEPTION 'Agent monthly bill members can only target a DRAFT bill';
  END IF;

  SELECT * INTO order_row
  FROM "Order"
  WHERE "id" = NEW."orderId"
  FOR SHARE;

  IF NOT FOUND
    OR order_row."settlementType" <> 'EXTERNAL_SALES'::"OrderSettlementType"
    OR order_row."billingMode" <> 'CHARGE'::"OrderBillingMode"
    OR order_row."submitterId" <> bill_row."agentUserId"
    OR order_row."status" NOT IN (
      'SETTLED'::"OrderStatus",
      'CANCELLED'::"OrderStatus"
    )
    OR order_row."settledFee" IS NULL
    OR order_row."settledAt" IS NULL
    OR to_char(
      order_row."settledAt" AT TIME ZONE 'Asia/Shanghai',
      'YYYY-MM'
    ) <> bill_row."period"
    OR NEW."orderNoSnapshot" <> order_row."orderNo"
    OR NEW."workOrderVersionSnapshot" <> order_row."workOrderVersion"
    OR NEW."orderStatusSnapshot" <> order_row."status"::TEXT
    OR NEW."customerRefSnapshot" IS DISTINCT FROM order_row."customerRef"
    OR NEW."settledFeeSnapshot" <> order_row."settledFee"
    OR NEW."settledAtSnapshot" <> order_row."settledAt"
  THEN
    RAISE EXCEPTION 'Agent monthly bill item does not match its settled order facts';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "AgentMonthlyBillItem_validate_snapshot"
BEFORE INSERT OR UPDATE ON "AgentMonthlyBillItem"
FOR EACH ROW
EXECUTE FUNCTION validate_agent_monthly_bill_item();

CREATE OR REPLACE FUNCTION guard_agent_monthly_bill_child_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  old_status "AgentMonthlyBillStatus";
  new_status "AgentMonthlyBillStatus";
BEGIN
  IF TG_OP <> 'INSERT' THEN
    SELECT "status" INTO old_status
    FROM "AgentMonthlyBill"
    WHERE "id" = OLD."billId"
    FOR UPDATE;
    IF old_status <> 'DRAFT'::"AgentMonthlyBillStatus" THEN
      RAISE EXCEPTION 'Confirmed agent monthly bill children are immutable';
    END IF;
  END IF;

  IF TG_OP <> 'DELETE' THEN
    SELECT "status" INTO new_status
    FROM "AgentMonthlyBill"
    WHERE "id" = NEW."billId"
    FOR UPDATE;
    IF new_status <> 'DRAFT'::"AgentMonthlyBillStatus" THEN
      RAISE EXCEPTION 'Agent monthly bill children can only target a DRAFT bill';
    END IF;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER "AgentMonthlyBillItem_parent_draft_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "AgentMonthlyBillItem"
FOR EACH ROW
EXECUTE FUNCTION guard_agent_monthly_bill_child_mutation();
CREATE TRIGGER "AgentMonthlyBillAdjustment_parent_draft_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "AgentMonthlyBillAdjustment"
FOR EACH ROW
EXECUTE FUNCTION guard_agent_monthly_bill_child_mutation();

-- Credit is the immutable correction fact. Locking its source item serializes
-- concurrent requests and prevents total requested credit from exceeding the
-- source member snapshot.
CREATE OR REPLACE FUNCTION validate_agent_monthly_bill_credit()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  source_fee DECIMAL(12,2);
  source_status "AgentMonthlyBillStatus";
  requested_total DECIMAL(12,2);
BEGIN
  SELECT item."settledFeeSnapshot", bill."status"
  INTO source_fee, source_status
  FROM "AgentMonthlyBillItem" item
  JOIN "AgentMonthlyBill" bill ON bill."id" = item."billId"
  WHERE item."id" = NEW."sourceItemId"
  FOR UPDATE OF item;

  IF NOT FOUND
    OR source_status NOT IN (
      'CONFIRMED'::"AgentMonthlyBillStatus",
      'PAID'::"AgentMonthlyBillStatus"
    )
  THEN
    RAISE EXCEPTION 'Credit requires a frozen source bill item';
  END IF;

  SELECT COALESCE(sum("requestedAmount"), 0) + NEW."requestedAmount"
  INTO requested_total
  FROM "AgentMonthlyBillCredit"
  WHERE "sourceItemId" = NEW."sourceItemId";

  IF requested_total < -source_fee THEN
    RAISE EXCEPTION 'Requested credit exceeds its source member amount';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "AgentMonthlyBillCredit_validate_insert"
BEFORE INSERT ON "AgentMonthlyBillCredit"
FOR EACH ROW
EXECUTE FUNCTION validate_agent_monthly_bill_credit();

-- Adjustments allocate a credit into later DRAFT months. No remaining balance
-- is stored: requestedAmount - SUM(allocation) is derived under a credit lock.
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

  SELECT COALESCE(sum("amount"), 0) + NEW."amount"
  INTO allocated_total
  FROM "AgentMonthlyBillAdjustment"
  WHERE "creditId" = NEW."creditId"
    AND "id" <> NEW."id";

  IF allocated_total < credit_amount OR allocated_total >= 0 THEN
    RAISE EXCEPTION 'Credit allocation exceeds the requested amount';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "AgentMonthlyBillAdjustment_validate_allocation"
BEFORE INSERT OR UPDATE ON "AgentMonthlyBillAdjustment"
FOR EACH ROW
EXECUTE FUNCTION validate_agent_monthly_bill_adjustment();

CREATE OR REPLACE FUNCTION validate_agent_monthly_bill_receipt()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  bill_row "AgentMonthlyBill"%ROWTYPE;
BEGIN
  SELECT * INTO bill_row
  FROM "AgentMonthlyBill"
  WHERE "id" = NEW."billId"
  FOR UPDATE;

  IF NOT FOUND
    OR bill_row."status" <> 'CONFIRMED'::"AgentMonthlyBillStatus"
    OR NEW."amount" <> bill_row."totalAmount"
  THEN
    RAISE EXCEPTION 'Receipt must equal the full total of a CONFIRMED bill';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "AgentMonthlyBillReceipt_validate_insert"
BEFORE INSERT ON "AgentMonthlyBillReceipt"
FOR EACH ROW
EXECUTE FUNCTION validate_agent_monthly_bill_receipt();

-- The bill row is mutable only while DRAFT. Confirmation revalidates every
-- cached total and member snapshot; payment requires the immutable full receipt.
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

CREATE TRIGGER "AgentMonthlyBill_validate_transition"
BEFORE INSERT OR UPDATE ON "AgentMonthlyBill"
FOR EACH ROW
EXECUTE FUNCTION validate_agent_monthly_bill_transition();

CREATE OR REPLACE FUNCTION protect_agent_monthly_bill_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."status" <> 'DRAFT'::"AgentMonthlyBillStatus" THEN
    RAISE EXCEPTION 'Confirmed and paid agent monthly bills are immutable';
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER "AgentMonthlyBill_protect_delete"
BEFORE DELETE ON "AgentMonthlyBill"
FOR EACH ROW
EXECUTE FUNCTION protect_agent_monthly_bill_delete();

-- Once an order belongs to a frozen V2 bill, its settlement identity and
-- amount/time facts cannot be rewritten through direct SQL.
CREATE OR REPLACE FUNCTION protect_billed_order_settlement()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (
    NEW."settledFee" IS DISTINCT FROM OLD."settledFee"
    OR NEW."settledAt" IS DISTINCT FROM OLD."settledAt"
    OR NEW."settlementContractVersion" IS DISTINCT FROM OLD."settlementContractVersion"
    OR NEW."submitterId" IS DISTINCT FROM OLD."submitterId"
    OR NEW."settlementType" IS DISTINCT FROM OLD."settlementType"
    OR NEW."billingMode" IS DISTINCT FROM OLD."billingMode"
  ) AND EXISTS (
    SELECT 1
    FROM "AgentMonthlyBillItem" item
    JOIN "AgentMonthlyBill" bill ON bill."id" = item."billId"
    WHERE item."orderId" = OLD."id"
      AND bill."status" IN (
        'CONFIRMED'::"AgentMonthlyBillStatus",
        'PAID'::"AgentMonthlyBillStatus"
      )
  ) THEN
    RAISE EXCEPTION 'Settlement facts are frozen by an agent monthly bill';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "Order_protect_billed_settlement"
BEFORE UPDATE OF
  "settledFee",
  "settledAt",
  "settlementContractVersion",
  "submitterId",
  "settlementType",
  "billingMode"
ON "Order"
FOR EACH ROW
EXECUTE FUNCTION protect_billed_order_settlement();

-- Production-safe defaults. New notification rules start inactive with no
-- channel binding: deploy never guesses which enterprise-WeChat group owns a
-- new event. The owner can explicitly bind and enable them afterwards.
INSERT INTO "NotificationRule" (
  "id", "eventType", "channelIds", "messageTemplate", "isActive",
  "createdAt", "updatedAt"
)
VALUES
  (
    'seed-admin-order-change-requested-v2',
    'ORDER_CHANGE_REQUESTED', ARRAY[]::TEXT[],
    '**工单变更/取消申请**\n工单号：{orderNo}\n{summary}\n{deepLink}',
    FALSE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'seed-production-progress-anomaly-v2',
    'PRODUCTION_PROGRESS_ANOMALY', ARRAY[]::TEXT[],
    '⚠️ **报工进度异常**\n工单号：{orderNo}\n{summary}\n{deepLink}',
    FALSE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'seed-production-stagnant-v2',
    'PRODUCTION_STAGNANT', ARRAY[]::TEXT[],
    '⏳ **生产停滞**\n工单号：{orderNo}\n{summary}\n{deepLink}',
    FALSE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'seed-pending-factory-backlog-v2',
    'PENDING_FACTORY_BACKLOG', ARRAY[]::TEXT[],
    '📋 **待确认积压**\n工单号：{orderNo}\n{summary}\n{deepLink}',
    FALSE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  )
ON CONFLICT ("eventType") DO NOTHING;

-- ORDER_SUBMITTED now has a deliberately narrow payload contract
-- (orderNo + summary + deep link). Rewrite every existing template so an old
-- custom placeholder such as submitterName/customerRef/totalAmount cannot be
-- left raw after runtime sanitization or reintroduce forbidden business data.
UPDATE "NotificationRule"
SET
  "messageTemplate" = '**新工单提交**\n工单号：{orderNo}\n{summary}\n{deepLink}',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "eventType" = 'ORDER_SUBMITTED';

INSERT INTO "Setting" ("id", "key", "value", "remark", "updatedAt")
VALUES
  (
    'seed-production-stagnation-days-v2',
    'production_stagnation_days', '{"days":2}'::JSONB,
    '生产下发后无人扫码认领的停滞阈值', CURRENT_TIMESTAMP
  ),
  (
    'seed-pending-factory-backlog-threshold-v2',
    'pending_factory_backlog_threshold', '{"count":5}'::JSONB,
    '待工厂确认工单积压提醒阈值', CURRENT_TIMESTAMP
  ),
  (
    'seed-production-alert-scan-batch-size-v2',
    'production_alert_scan_batch_size', '{"count":200}'::JSONB,
    '生产异常与停滞扫描批量', CURRENT_TIMESTAMP
  ),
  (
    'seed-notify-order-submitted-enabled-v2',
    'notify_order_submitted_enabled', '{"enabled":true}'::JSONB,
    '新单提交通知开关', CURRENT_TIMESTAMP
  ),
  (
    'seed-notify-order-change-enabled-v2',
    'notify_order_change_enabled', '{"enabled":true}'::JSONB,
    '工单变更与取消申请通知开关', CURRENT_TIMESTAMP
  ),
  (
    'seed-notify-production-anomaly-enabled-v2',
    'notify_production_anomaly_enabled', '{"enabled":true}'::JSONB,
    '报工进度异常通知开关', CURRENT_TIMESTAMP
  ),
  (
    'seed-notify-production-stagnation-enabled-v2',
    'notify_production_stagnation_enabled', '{"enabled":true}'::JSONB,
    '生产停滞通知开关', CURRENT_TIMESTAMP
  ),
  (
    'seed-notify-pending-factory-backlog-enabled-v2',
    'notify_pending_factory_backlog_enabled', '{"enabled":true}'::JSONB,
    '待确认积压通知开关', CURRENT_TIMESTAMP
  )
ON CONFLICT ("key") DO NOTHING;

COMMIT;
