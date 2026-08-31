-- Structured non-production customer charges and per-style plate details.
-- Existing orders remain compatible: new relations are empty and every
-- historical customer charge is explicitly non-adjustment by default.

ALTER TABLE "OrderCustomerCharge"
  ADD COLUMN "isAdjustment" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN "approvalReference" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'OrderCustomerCharge_values_valid'
      AND conrelid = '"OrderCustomerCharge"'::regclass
  ) THEN
    RAISE EXCEPTION 'Expected OrderCustomerCharge_values_valid before replacement';
  END IF;
END
$$;

ALTER TABLE "OrderCustomerCharge"
  DROP CONSTRAINT "OrderCustomerCharge_values_valid";

ALTER TABLE "OrderCustomerCharge"
  ADD CONSTRAINT "OrderCustomerCharge_values_valid" CHECK (
    btrim("businessKey"::TEXT) <> '' AND
    btrim("description") <> '' AND
    ("quantity" IS NULL OR "quantity" > 0) AND
    ("unit" IS NULL OR btrim("unit") <> '') AND
    ("unitPrice" IS NULL OR "unitPrice" BETWEEN 0 AND 99999999.9999) AND
    ("suggestedAmount" IS NULL OR "suggestedAmount" BETWEEN 0 AND 9999999999.99) AND
    (
      (NOT "isAdjustment" AND "amount" BETWEEN 0 AND 9999999999.99) OR
      ("isAdjustment" AND "amount" BETWEEN -9999999999.99 AND 9999999999.99)
    ) AND
    ("pricingSnapshot" IS NULL OR jsonb_typeof("pricingSnapshot") = 'object') AND
    ("overrideReason" IS NULL OR btrim("overrideReason") <> '') AND
    ("approvalReference" IS NULL OR btrim("approvalReference") <> '') AND
    ("status" <> 'WAIVED'::"OrderCustomerChargeStatus" OR "amount" = 0) AND
    (
      (
        "status" = 'ESTIMATED'::"OrderCustomerChargeStatus" AND
        "finalizedById" IS NULL AND
        "finalizedAt" IS NULL
      ) OR
      (
        "status" IN (
          'FINAL'::"OrderCustomerChargeStatus",
          'WAIVED'::"OrderCustomerChargeStatus"
        ) AND
        "finalizedById" IS NOT NULL AND
        "finalizedAt" IS NOT NULL
      )
    )
  );

CREATE TABLE "OrderItemPlateDetail" (
  "id" TEXT NOT NULL,
  "orderItemId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "plateGroupId" TEXT,
  "specification" TEXT,
  "quantity" INTEGER NOT NULL,
  "unitPrice" DECIMAL(12,2) NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "remark" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdById" TEXT NOT NULL,
  "removedById" TEXT,
  "removedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "OrderItemPlateDetail_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OrderItemPlateDetail_values_valid" CHECK (
    "sequence" >= 1 AND
    btrim("name") <> '' AND
    ("plateGroupId" IS NULL OR btrim("plateGroupId") <> '') AND
    ("specification" IS NULL OR btrim("specification") <> '') AND
    "quantity" BETWEEN 1 AND 9999999 AND
    "unitPrice" BETWEEN 0 AND 9999999999.99 AND
    "amount" BETWEEN 0 AND 9999999999.99 AND
    ("remark" IS NULL OR btrim("remark") <> '') AND
    (
      ("isActive" AND "removedById" IS NULL AND "removedAt" IS NULL) OR
      (NOT "isActive" AND "removedById" IS NOT NULL AND "removedAt" IS NOT NULL)
    )
  )
);

CREATE UNIQUE INDEX "OrderItemPlateDetail_orderItemId_sequence_key"
  ON "OrderItemPlateDetail"("orderItemId", "sequence");
CREATE INDEX "OrderItemPlateDetail_orderItemId_isActive_sequence_idx"
  ON "OrderItemPlateDetail"("orderItemId", "isActive", "sequence");
CREATE INDEX "OrderItemPlateDetail_createdById_idx"
  ON "OrderItemPlateDetail"("createdById");
CREATE INDEX "OrderItemPlateDetail_removedById_idx"
  ON "OrderItemPlateDetail"("removedById");

ALTER TABLE "OrderItemPlateDetail"
  ADD CONSTRAINT "OrderItemPlateDetail_orderItemId_fkey"
  FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "OrderItemPlateDetail_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "OrderItemPlateDetail_removedById_fkey"
  FOREIGN KEY ("removedById") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "CustomerChargeCategory" (
  "id", "code", "name", "description", "sortOrder", "isActive", "createdAt", "updatedAt"
) VALUES
  ('ccc_plate_making_fee', 'PLATE_MAKING_FEE', '制版费', '按款式多行记录的制版对客收费。', 100, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('ccc_sample_fee', 'SAMPLE_FEE', '打样费', '管理员确认的订单级打样对客收费。', 110, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('ccc_other_packaging_fee', 'OTHER_PACKAGING_FEE', '其他包装费', '入袋费和逐票耗材费之外的订单级包装收费。', 120, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('ccc_approved_adjustment', 'APPROVED_ADJUSTMENT', '经审批调整金额', '有原因和审批信息的订单级加减调整。', 130, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO UPDATE SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "sortOrder" = EXCLUDED."sortOrder",
  "isActive" = TRUE,
  "updatedAt" = CURRENT_TIMESTAMP;
