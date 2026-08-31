BEGIN;

CREATE TYPE "OrderPricingStatus" AS ENUM (
  'LEGACY_CONFIRMED',
  'AUTO_CONFIRMED',
  'PENDING_ADMIN_CONFIRMATION',
  'ADMIN_CONFIRMED'
);

ALTER TABLE "Order"
  ADD COLUMN "pricingStatus" "OrderPricingStatus" NOT NULL DEFAULT 'PENDING_ADMIN_CONFIRMATION',
  ADD COLUMN "priceRevision" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "pricingConfirmedAt" TIMESTAMP(3),
  ADD COLUMN "pricingConfirmedById" TEXT;

ALTER TABLE "Order"
  ADD CONSTRAINT "Order_priceRevision_check"
  CHECK ("priceRevision" >= 1);

ALTER TABLE "Order"
  ADD CONSTRAINT "Order_pricing_confirmation_shape_check"
  CHECK (
    ("pricingStatus" = 'PENDING_ADMIN_CONFIRMATION' AND "pricingConfirmedAt" IS NULL AND "pricingConfirmedById" IS NULL)
    OR ("pricingStatus" = 'ADMIN_CONFIRMED' AND "pricingConfirmedAt" IS NOT NULL AND "pricingConfirmedById" IS NOT NULL)
    OR ("pricingStatus" IN ('AUTO_CONFIRMED', 'LEGACY_CONFIRMED') AND "pricingConfirmedAt" IS NOT NULL AND "pricingConfirmedById" IS NULL)
  );

ALTER TABLE "Order"
  ADD CONSTRAINT "Order_pricingConfirmedById_fkey"
  FOREIGN KEY ("pricingConfirmedById") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "Order_settlementType_pricingStatus_status_idx"
  ON "Order"("settlementType", "pricingStatus", "status");

CREATE INDEX "Order_pricingConfirmedById_idx"
  ON "Order"("pricingConfirmedById");

CREATE TABLE "OrderPricingRevision" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "status" "OrderPricingStatus" NOT NULL,
  "source" VARCHAR(64) NOT NULL,
  "snapshot" JSONB NOT NULL,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "OrderPricingRevision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OrderPricingRevision_revision_check" CHECK ("revision" >= 1),
  CONSTRAINT "OrderPricingRevision_source_check" CHECK (length(btrim("source")) > 0),
  CONSTRAINT "OrderPricingRevision_snapshot_object_check"
    CHECK (jsonb_typeof("snapshot") = 'object')
);

ALTER TABLE "OrderPricingRevision"
  ADD CONSTRAINT "OrderPricingRevision_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OrderPricingRevision"
  ADD CONSTRAINT "OrderPricingRevision_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "OrderPricingRevision_orderId_revision_key"
  ON "OrderPricingRevision"("orderId", "revision");

CREATE INDEX "OrderPricingRevision_orderId_createdAt_idx"
  ON "OrderPricingRevision"("orderId", "createdAt" DESC);

CREATE INDEX "OrderPricingRevision_createdById_idx"
  ON "OrderPricingRevision"("createdById");

-- Existing rows predate the review workflow. Preserve their current amounts as
-- an explicit legacy revision instead of pretending they were recalculated by
-- today's price books.
UPDATE "Order"
SET
  "pricingStatus" = 'LEGACY_CONFIRMED',
  "pricingConfirmedAt" = COALESCE("updatedAt", "createdAt"),
  "pricingConfirmedById" = NULL;

INSERT INTO "OrderPricingRevision" (
  "id",
  "orderId",
  "revision",
  "status",
  "source",
  "snapshot",
  "createdAt"
)
SELECT
  'legacy_' || md5(o."id" || ':pricing:1'),
  o."id",
  1,
  'LEGACY_CONFIRMED'::"OrderPricingStatus",
  'LEGACY_BACKFILL',
  jsonb_build_object(
    'version', 1,
    'source', 'LEGACY_BACKFILL',
    'pricedAt', COALESCE(o."updatedAt", o."createdAt"),
    'order', jsonb_build_object(
      'id', o."id",
      'orderNo', o."orderNo",
      'settlementType', o."settlementType",
      'processingAmount', o."processingAmount"::text,
      'totalAmount', o."totalAmount"::text
    ),
    'items', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', oi."id",
            'sequence', oi."sequence",
            'name', oi."name",
            'quantity', oi."quantity",
            'unitPrice', oi."unitPrice"::text,
            'fixedFee', oi."fixedFee"::text,
            'subtotal', oi."subtotal"::text,
            'suggestedSubtotal', oi."suggestedSubtotal"::text,
            'priceOverrideReason', oi."priceOverrideReason",
            'pricingSnapshot', oi."pricingSnapshot"
          )
          ORDER BY oi."sequence"
        )
        FROM "OrderItem" oi
        WHERE oi."orderId" = o."id"
      ),
      '[]'::jsonb
    ),
    'customerCharges', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', oc."id",
            'businessKey', oc."businessKey",
            'status', oc."status",
            'priceBookId', oc."priceBookId",
            'sourceRuleId', oc."sourceRuleId",
            'suggestedAmount', oc."suggestedAmount"::text,
            'amount', oc."amount"::text,
            'overrideReason', oc."overrideReason",
            'pricingSnapshot', oc."pricingSnapshot"
          )
          ORDER BY oc."createdAt", oc."id"
        )
        FROM "OrderCustomerCharge" oc
        WHERE oc."orderId" = o."id"
      ),
      '[]'::jsonb
    )
  ),
  COALESCE(o."updatedAt", o."createdAt")
FROM "Order" o;

CREATE OR REPLACE FUNCTION prevent_order_pricing_revision_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'OrderPricingRevision rows are immutable';
END;
$$;

CREATE TRIGGER "OrderPricingRevision_immutable"
BEFORE UPDATE OR DELETE ON "OrderPricingRevision"
FOR EACH ROW
EXECUTE FUNCTION prevent_order_pricing_revision_mutation();

COMMIT;
