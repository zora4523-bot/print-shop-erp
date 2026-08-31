BEGIN;

-- This domain is intentionally additive.  It must not alter, seed, or reuse
-- CustomerPriceBook / CustomerPriceRule, whose published snapshots remain the
-- external-pricing source of truth.
CREATE TYPE "PieceworkOperationType" AS ENUM ('PARTIAL', 'FULL', 'PACKING');
CREATE TYPE "PieceworkRateUnit" AS ENUM ('PER_PASS', 'PER_PIECE', 'PER_BAG');
CREATE TYPE "PieceworkPriceBookStatus" AS ENUM ('DRAFT', 'PUBLISHED');
CREATE TYPE "ProductionOperationStatus" AS ENUM (
  'PENDING',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED'
);
CREATE TYPE "ProductionOperationSourceType" AS ENUM (
  'ORDER_ITEM',
  'PACKAGING_GROUP'
);
CREATE TYPE "ProductionReportSource" AS ENUM ('LIVE', 'LEGACY_IMPORT');
CREATE TYPE "ProductionReportEntryType" AS ENUM ('REPORT', 'REVERSAL');
CREATE TYPE "PieceworkSettlementStatus" AS ENUM ('DRAFT', 'LOCKED', 'PAID');

CREATE TABLE "PieceworkPriceBook" (
  "id" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "status" "PieceworkPriceBookStatus" NOT NULL DEFAULT 'DRAFT',
  "effectiveFrom" TIMESTAMPTZ(3),
  "effectiveTo" TIMESTAMPTZ(3),
  "sourceName" TEXT,
  "sourceSha256" VARCHAR(64),
  "manifestSha256" VARCHAR(64),
  "ruleSetSha256" VARCHAR(64),
  "publishNote" TEXT,
  "publishedById" TEXT,
  "publishedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "PieceworkPriceBook_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PieceworkPriceBook_version_positive_check"
    CHECK ("version" >= 1),
  CONSTRAINT "PieceworkPriceBook_effective_window_check"
    CHECK ("effectiveTo" IS NULL OR "effectiveFrom" < "effectiveTo"),
  CONSTRAINT "PieceworkPriceBook_source_sha_check"
    CHECK ("sourceSha256" IS NULL OR "sourceSha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "PieceworkPriceBook_manifest_sha_check"
    CHECK ("manifestSha256" IS NULL OR "manifestSha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "PieceworkPriceBook_rule_set_sha_check"
    CHECK ("ruleSetSha256" IS NULL OR "ruleSetSha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "PieceworkPriceBook_publication_shape_check"
    CHECK (
      (
        "status" = 'DRAFT'
        AND "effectiveFrom" IS NULL
        AND "effectiveTo" IS NULL
        AND "publishedById" IS NULL
        AND "publishedAt" IS NULL
        AND "manifestSha256" IS NULL
        AND "ruleSetSha256" IS NULL
        AND "publishNote" IS NULL
      )
      OR (
        "status" = 'PUBLISHED'
        AND "effectiveFrom" IS NOT NULL
        AND "publishedById" IS NOT NULL
        AND "publishedAt" IS NOT NULL
        AND "sourceName" IS NOT NULL
        AND "sourceSha256" IS NOT NULL
        AND "manifestSha256" IS NOT NULL
        AND "ruleSetSha256" IS NOT NULL
        AND length(btrim("publishNote")) BETWEEN 2 AND 500
      )
    )
);

CREATE TABLE "PieceworkPriceRule" (
  "id" TEXT NOT NULL,
  "priceBookId" TEXT NOT NULL,
  "operationType" "PieceworkOperationType" NOT NULL,
  "unit" "PieceworkRateUnit" NOT NULL,
  "amount" DECIMAL(14,4),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "PieceworkPriceRule_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PieceworkPriceRule_amount_check"
    CHECK ("amount" IS NULL OR "amount" >= 0),
  CONSTRAINT "PieceworkPriceRule_operation_unit_check"
    CHECK (
      ("operationType" = 'PARTIAL' AND "unit" = 'PER_PASS')
      OR ("operationType" = 'FULL' AND "unit" = 'PER_PIECE')
      OR ("operationType" = 'PACKING' AND "unit" = 'PER_BAG')
    )
);

CREATE TABLE "ProductionOperation" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "operationType" "PieceworkOperationType" NOT NULL,
  "unit" "PieceworkRateUnit" NOT NULL,
  "status" "ProductionOperationStatus" NOT NULL DEFAULT 'PENDING',
  "plannedQty" DECIMAL(14,3) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "ProductionOperation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProductionOperation_planned_qty_check" CHECK ("plannedQty" > 0),
  CONSTRAINT "ProductionOperation_unit_check"
    CHECK (
      ("operationType" = 'PARTIAL' AND "unit" = 'PER_PASS')
      OR ("operationType" = 'FULL' AND "unit" = 'PER_PIECE')
      OR ("operationType" = 'PACKING' AND "unit" = 'PER_BAG')
    )
);

CREATE TABLE "ProductionOperationSource" (
  "id" TEXT NOT NULL,
  "operationId" TEXT NOT NULL,
  "sourceType" "ProductionOperationSourceType" NOT NULL,
  "orderItemId" TEXT,
  "packagingGroupId" TEXT,
  "sourceQty" DECIMAL(14,3) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ProductionOperationSource_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProductionOperationSource_quantity_check" CHECK ("sourceQty" > 0),
  CONSTRAINT "ProductionOperationSource_shape_check"
    CHECK (
      (
        "sourceType" = 'ORDER_ITEM'
        AND "orderItemId" IS NOT NULL
        AND "packagingGroupId" IS NULL
      )
      OR (
        "sourceType" = 'PACKAGING_GROUP'
        AND "orderItemId" IS NULL
        AND "packagingGroupId" IS NOT NULL
      )
    )
);

CREATE TABLE "ProductionReport" (
  "id" TEXT NOT NULL,
  "operationId" TEXT NOT NULL,
  "reporterId" TEXT NOT NULL,
  "entryType" "ProductionReportEntryType" NOT NULL DEFAULT 'REPORT',
  "source" "ProductionReportSource" NOT NULL DEFAULT 'LIVE',
  "reversalOfId" TEXT,
  "reportedCompletedQty" DECIMAL(14,3) NOT NULL,
  "defectQty" DECIMAL(14,3) NOT NULL DEFAULT 0,
  "reworkQty" DECIMAL(14,3) NOT NULL DEFAULT 0,
  "chargeableQty" DECIMAL(14,3) NOT NULL,
  "unit" "PieceworkRateUnit" NOT NULL,
  "rate" DECIMAL(14,4) NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL,
  "priceBookId" TEXT NOT NULL,
  "priceBookVersion" INTEGER NOT NULL,
  "ruleSetSha256" VARCHAR(64) NOT NULL,
  "snapshot" JSONB NOT NULL,
  "idempotencyKey" VARCHAR(128) NOT NULL,
  "reportedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ProductionReport_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProductionReport_rate_check" CHECK ("rate" >= 0),
  CONSTRAINT "ProductionReport_amount_check"
    CHECK ("amount" = round("chargeableQty" * "rate", 2)),
  CONSTRAINT "ProductionReport_price_book_version_check"
    CHECK ("priceBookVersion" >= 1),
  CONSTRAINT "ProductionReport_rule_set_sha_check"
    CHECK ("ruleSetSha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "ProductionReport_snapshot_object_check"
    CHECK (jsonb_typeof("snapshot") = 'object'),
  CONSTRAINT "ProductionReport_idempotency_key_check"
    CHECK (length(btrim("idempotencyKey")) > 0),
  CONSTRAINT "ProductionReport_entry_shape_check"
    CHECK (
      (
        "entryType" = 'REPORT'
        AND "reversalOfId" IS NULL
        AND "reportedCompletedQty" >= 0
        AND "defectQty" >= 0
        AND "reworkQty" >= 0
        AND "chargeableQty" >= 0
        AND "amount" >= 0
        AND ("reportedCompletedQty" + "defectQty" + "reworkQty") > 0
      )
      OR (
        "entryType" = 'REVERSAL'
        AND "reversalOfId" IS NOT NULL
        AND "reportedCompletedQty" <= 0
        AND "defectQty" <= 0
        AND "reworkQty" <= 0
        AND "chargeableQty" <= 0
        AND "amount" <= 0
        AND ("reportedCompletedQty" + "defectQty" + "reworkQty") < 0
      )
    )
);

CREATE TABLE "PieceworkSettlement" (
  "id" TEXT NOT NULL,
  "reporterId" TEXT NOT NULL,
  "workDate" DATE NOT NULL,
  "status" "PieceworkSettlementStatus" NOT NULL DEFAULT 'DRAFT',
  "reportAmount" DECIMAL(14,2) NOT NULL,
  "adjustmentAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "payableAmount" DECIMAL(14,2) NOT NULL,
  "snapshot" JSONB NOT NULL,
  "lockedAt" TIMESTAMPTZ(3),
  "paidAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "PieceworkSettlement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PieceworkSettlement_amount_check"
    CHECK ("payableAmount" = "reportAmount" + "adjustmentAmount"),
  CONSTRAINT "PieceworkSettlement_snapshot_object_check"
    CHECK (jsonb_typeof("snapshot") = 'object'),
  CONSTRAINT "PieceworkSettlement_status_shape_check"
    CHECK (
      ("status" = 'DRAFT' AND "lockedAt" IS NULL AND "paidAt" IS NULL)
      OR ("status" = 'LOCKED' AND "lockedAt" IS NOT NULL AND "paidAt" IS NULL)
      OR ("status" = 'PAID' AND "lockedAt" IS NOT NULL AND "paidAt" IS NOT NULL)
    )
);

CREATE TABLE "PieceworkSettlementItem" (
  "id" TEXT NOT NULL,
  "settlementId" TEXT NOT NULL,
  "reportId" TEXT NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL,
  "snapshot" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PieceworkSettlementItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PieceworkSettlementItem_snapshot_object_check"
    CHECK (jsonb_typeof("snapshot") = 'object')
);

CREATE UNIQUE INDEX "PieceworkPriceBook_version_key"
  ON "PieceworkPriceBook"("version");
CREATE UNIQUE INDEX "PieceworkPriceBook_single_draft_key"
  ON "PieceworkPriceBook"("status") WHERE "status" = 'DRAFT';
CREATE INDEX "PieceworkPriceBook_status_effectiveFrom_idx"
  ON "PieceworkPriceBook"("status", "effectiveFrom");
CREATE INDEX "PieceworkPriceBook_publishedById_idx"
  ON "PieceworkPriceBook"("publishedById");
CREATE INDEX "PieceworkPriceBook_sourceSha256_idx"
  ON "PieceworkPriceBook"("sourceSha256");

CREATE UNIQUE INDEX "PieceworkPriceRule_priceBookId_operationType_key"
  ON "PieceworkPriceRule"("priceBookId", "operationType");
CREATE INDEX "PieceworkPriceRule_operationType_idx"
  ON "PieceworkPriceRule"("operationType");

CREATE INDEX "ProductionOperation_orderId_status_idx"
  ON "ProductionOperation"("orderId", "status");
CREATE INDEX "ProductionOperation_operationType_status_idx"
  ON "ProductionOperation"("operationType", "status");

CREATE UNIQUE INDEX "ProductionOperationSource_operationId_orderItemId_key"
  ON "ProductionOperationSource"("operationId", "orderItemId");
CREATE UNIQUE INDEX "ProductionOperationSource_operationId_packagingGroupId_key"
  ON "ProductionOperationSource"("operationId", "packagingGroupId");
CREATE INDEX "ProductionOperationSource_orderItemId_idx"
  ON "ProductionOperationSource"("orderItemId");
CREATE INDEX "ProductionOperationSource_packagingGroupId_idx"
  ON "ProductionOperationSource"("packagingGroupId");

CREATE UNIQUE INDEX "ProductionReport_reversalOfId_key"
  ON "ProductionReport"("reversalOfId");
CREATE UNIQUE INDEX "ProductionReport_idempotencyKey_key"
  ON "ProductionReport"("idempotencyKey");
CREATE INDEX "ProductionReport_operationId_reportedAt_idx"
  ON "ProductionReport"("operationId", "reportedAt");
CREATE INDEX "ProductionReport_reporterId_reportedAt_idx"
  ON "ProductionReport"("reporterId", "reportedAt");
CREATE INDEX "ProductionReport_priceBookId_idx"
  ON "ProductionReport"("priceBookId");

CREATE UNIQUE INDEX "PieceworkSettlement_reporterId_workDate_key"
  ON "PieceworkSettlement"("reporterId", "workDate");
CREATE INDEX "PieceworkSettlement_status_workDate_idx"
  ON "PieceworkSettlement"("status", "workDate");
CREATE UNIQUE INDEX "PieceworkSettlementItem_reportId_key"
  ON "PieceworkSettlementItem"("reportId");
CREATE INDEX "PieceworkSettlementItem_settlementId_idx"
  ON "PieceworkSettlementItem"("settlementId");

ALTER TABLE "PieceworkPriceBook"
  ADD CONSTRAINT "PieceworkPriceBook_publishedById_fkey"
  FOREIGN KEY ("publishedById") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PieceworkPriceRule"
  ADD CONSTRAINT "PieceworkPriceRule_priceBookId_fkey"
  FOREIGN KEY ("priceBookId") REFERENCES "PieceworkPriceBook"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductionOperation"
  ADD CONSTRAINT "ProductionOperation_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductionOperationSource"
  ADD CONSTRAINT "ProductionOperationSource_operationId_fkey"
  FOREIGN KEY ("operationId") REFERENCES "ProductionOperation"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductionOperationSource"
  ADD CONSTRAINT "ProductionOperationSource_orderItemId_fkey"
  FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductionOperationSource"
  ADD CONSTRAINT "ProductionOperationSource_packagingGroupId_fkey"
  FOREIGN KEY ("packagingGroupId") REFERENCES "OrderPackagingGroup"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductionReport"
  ADD CONSTRAINT "ProductionReport_operationId_fkey"
  FOREIGN KEY ("operationId") REFERENCES "ProductionOperation"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductionReport"
  ADD CONSTRAINT "ProductionReport_reporterId_fkey"
  FOREIGN KEY ("reporterId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductionReport"
  ADD CONSTRAINT "ProductionReport_priceBookId_fkey"
  FOREIGN KEY ("priceBookId") REFERENCES "PieceworkPriceBook"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductionReport"
  ADD CONSTRAINT "ProductionReport_reversalOfId_fkey"
  FOREIGN KEY ("reversalOfId") REFERENCES "ProductionReport"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PieceworkSettlement"
  ADD CONSTRAINT "PieceworkSettlement_reporterId_fkey"
  FOREIGN KEY ("reporterId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PieceworkSettlementItem"
  ADD CONSTRAINT "PieceworkSettlementItem_settlementId_fkey"
  FOREIGN KEY ("settlementId") REFERENCES "PieceworkSettlement"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PieceworkSettlementItem"
  ADD CONSTRAINT "PieceworkSettlementItem_reportId_fkey"
  FOREIGN KEY ("reportId") REFERENCES "ProductionReport"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PieceworkPriceBook"
  ADD CONSTRAINT "PieceworkPriceBook_published_window_no_overlap"
  EXCLUDE USING gist (
    tstzrange(
      "effectiveFrom",
      COALESCE("effectiveTo", 'infinity'::timestamptz),
      '[)'
    ) WITH &&
  )
  WHERE ("status" = 'PUBLISHED');

CREATE OR REPLACE FUNCTION validate_piecework_price_book_publication()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."status" <> 'PUBLISHED' THEN
    RETURN NEW;
  END IF;

  IF (
    SELECT count(*)
    FROM "PieceworkPriceRule" rule
    WHERE rule."priceBookId" = NEW."id"
  ) <> 3 THEN
    RAISE EXCEPTION 'A published piecework price book requires exactly three rules';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "PieceworkPriceRule" rule
    WHERE rule."priceBookId" = NEW."id"
      AND rule."amount" IS NULL
  ) THEN
    RAISE EXCEPTION 'A published piecework price book cannot contain null rates';
  END IF;

  IF NOT EXISTS (
      SELECT 1 FROM "PieceworkPriceRule"
      WHERE "priceBookId" = NEW."id"
        AND "operationType" = 'PARTIAL' AND "unit" = 'PER_PASS'
    ) OR NOT EXISTS (
      SELECT 1 FROM "PieceworkPriceRule"
      WHERE "priceBookId" = NEW."id"
        AND "operationType" = 'FULL' AND "unit" = 'PER_PIECE'
    ) OR NOT EXISTS (
      SELECT 1 FROM "PieceworkPriceRule"
      WHERE "priceBookId" = NEW."id"
        AND "operationType" = 'PACKING' AND "unit" = 'PER_BAG'
    ) THEN
    RAISE EXCEPTION 'Piecework rule operation types and units are incomplete';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "PieceworkPriceBook_validate_publish"
BEFORE INSERT OR UPDATE OF "status" ON "PieceworkPriceBook"
FOR EACH ROW
EXECUTE FUNCTION validate_piecework_price_book_publication();

CREATE OR REPLACE FUNCTION protect_piecework_price_book_history()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD."status" = 'PUBLISHED' THEN
    RAISE EXCEPTION 'Published PieceworkPriceBook rows are immutable';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD."status" = 'PUBLISHED' THEN
      RAISE EXCEPTION 'Published PieceworkPriceBook rows are immutable';
    END IF;
    IF NEW."id" <> OLD."id" OR NEW."version" <> OLD."version" THEN
      RAISE EXCEPTION 'PieceworkPriceBook identity is immutable';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER "PieceworkPriceBook_protect_history"
BEFORE UPDATE OR DELETE ON "PieceworkPriceBook"
FOR EACH ROW
EXECUTE FUNCTION protect_piecework_price_book_history();

CREATE OR REPLACE FUNCTION protect_published_piecework_price_rule()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  owning_book_id TEXT;
BEGIN
  owning_book_id := CASE
    WHEN TG_OP = 'DELETE' THEN OLD."priceBookId"
    ELSE NEW."priceBookId"
  END;
  IF EXISTS (
    SELECT 1 FROM "PieceworkPriceBook"
    WHERE "id" = owning_book_id AND "status" = 'PUBLISHED'
  ) THEN
    RAISE EXCEPTION 'Published PieceworkPriceRule rows are immutable';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER "PieceworkPriceRule_protect_published"
BEFORE INSERT OR UPDATE OR DELETE ON "PieceworkPriceRule"
FOR EACH ROW
EXECUTE FUNCTION protect_published_piecework_price_rule();

CREATE OR REPLACE FUNCTION validate_production_report_price_snapshot()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  operation_record RECORD;
  matched_rate DECIMAL(14,4);
BEGIN
  -- A reversal carries the original book/rate/hash and is validated below by
  -- validate_production_report_reversal as an exact negation. Requiring the
  -- old book to still be effective at the correction time would make an
  -- expired historical report impossible to reverse.
  IF NEW."entryType" = 'REVERSAL' THEN
    RETURN NEW;
  END IF;

  SELECT operation."operationType", operation."unit"
  INTO operation_record
  FROM "ProductionOperation" operation
  WHERE operation."id" = NEW."operationId"
  FOR SHARE;

  IF NOT FOUND OR operation_record."unit" <> NEW."unit" THEN
    RAISE EXCEPTION 'Production report unit does not match its operation';
  END IF;

  SELECT rule."amount"
  INTO matched_rate
  FROM "PieceworkPriceBook" book
  JOIN "PieceworkPriceRule" rule ON rule."priceBookId" = book."id"
  WHERE book."id" = NEW."priceBookId"
    AND book."status" = 'PUBLISHED'
    AND book."version" = NEW."priceBookVersion"
    AND book."ruleSetSha256" = NEW."ruleSetSha256"
    AND book."effectiveFrom" <= NEW."reportedAt"
    AND (book."effectiveTo" IS NULL OR book."effectiveTo" > NEW."reportedAt")
    AND rule."operationType" = operation_record."operationType"
    AND rule."unit" = NEW."unit";

  IF NOT FOUND OR matched_rate IS NULL OR matched_rate <> NEW."rate" THEN
    RAISE EXCEPTION 'Production report does not match an effective published rate';
  END IF;

  IF operation_record."operationType" IN ('FULL', 'PACKING')
    AND NEW."chargeableQty" <> NEW."reportedCompletedQty"
  THEN
    RAISE EXCEPTION 'Only completed quantity is chargeable for this operation';
  END IF;
  IF operation_record."operationType" = 'PARTIAL' AND (
    (NEW."reportedCompletedQty" = 0 AND NEW."chargeableQty" <> 0)
    OR (
      NEW."reportedCompletedQty" <> 0
      AND (
        abs(NEW."chargeableQty") < abs(NEW."reportedCompletedQty")
        OR mod(
          abs(NEW."chargeableQty"),
          abs(NEW."reportedCompletedQty")
        ) <> 0
      )
    )
  ) THEN
    RAISE EXCEPTION 'PARTIAL chargeable quantity must be completed quantity times whole passes';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "ProductionReport_validate_price_snapshot"
BEFORE INSERT ON "ProductionReport"
FOR EACH ROW
EXECUTE FUNCTION validate_production_report_price_snapshot();

CREATE OR REPLACE FUNCTION validate_production_report_reversal()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  original "ProductionReport"%ROWTYPE;
BEGIN
  IF NEW."entryType" <> 'REVERSAL' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO original
  FROM "ProductionReport"
  WHERE "id" = NEW."reversalOfId"
  FOR SHARE;

  IF NOT FOUND OR original."entryType" <> 'REPORT' THEN
    RAISE EXCEPTION 'A reversal must reference an original report';
  END IF;
  IF NEW."operationId" <> original."operationId"
    OR NEW."reporterId" <> original."reporterId"
    OR NEW."priceBookId" <> original."priceBookId"
    OR NEW."priceBookVersion" <> original."priceBookVersion"
    OR NEW."ruleSetSha256" <> original."ruleSetSha256"
    OR NEW."unit" <> original."unit"
    OR NEW."rate" <> original."rate"
    OR NEW."reportedCompletedQty" <> -original."reportedCompletedQty"
    OR NEW."defectQty" <> -original."defectQty"
    OR NEW."reworkQty" <> -original."reworkQty"
    OR NEW."chargeableQty" <> -original."chargeableQty"
    OR NEW."amount" <> -original."amount"
  THEN
    RAISE EXCEPTION 'A reversal must be the exact negation of its original report';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "ProductionReport_validate_reversal"
BEFORE INSERT ON "ProductionReport"
FOR EACH ROW
EXECUTE FUNCTION validate_production_report_reversal();

CREATE OR REPLACE FUNCTION prevent_piecework_ledger_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% rows are immutable', TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER "ProductionReport_immutable"
BEFORE UPDATE OR DELETE ON "ProductionReport"
FOR EACH ROW
EXECUTE FUNCTION prevent_piecework_ledger_mutation();
CREATE TRIGGER "PieceworkSettlementItem_immutable"
BEFORE UPDATE OR DELETE ON "PieceworkSettlementItem"
FOR EACH ROW
EXECUTE FUNCTION prevent_piecework_ledger_mutation();

CREATE OR REPLACE FUNCTION protect_paid_piecework_settlement()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."status" = 'PAID' THEN
    RAISE EXCEPTION 'Paid PieceworkSettlement rows are immutable';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER "PieceworkSettlement_protect_paid"
BEFORE UPDATE OR DELETE ON "PieceworkSettlement"
FOR EACH ROW
EXECUTE FUNCTION protect_paid_piecework_settlement();

COMMIT;
