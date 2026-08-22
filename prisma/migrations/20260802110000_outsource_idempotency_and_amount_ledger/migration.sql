BEGIN;

-- Creation retries need a durable request identity. Historical rows receive a
-- deterministic key; their creator is unknowable and therefore remains NULL.
ALTER TABLE "OutsourceOrder"
  ADD COLUMN "idempotencyKey" TEXT,
  ADD COLUMN "createdById" TEXT;

UPDATE "OutsourceOrder"
SET "idempotencyKey" = 'legacy-outsource:' || "id"
WHERE "idempotencyKey" IS NULL;

ALTER TABLE "OutsourceOrder"
  ALTER COLUMN "idempotencyKey" SET NOT NULL;

CREATE UNIQUE INDEX "OutsourceOrder_idempotencyKey_key"
  ON "OutsourceOrder"("idempotencyKey");
CREATE INDEX "OutsourceOrder_createdById_idx"
  ON "OutsourceOrder"("createdById");

ALTER TABLE "OutsourceOrder"
  ADD CONSTRAINT "OutsourceOrder_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Amount changes are append-only. This preserves every confirmation/correction
-- and gives retries a unique database-enforced request key instead of relying
-- on the mutable amount currently stored on OutsourceOrder.
CREATE TABLE "OutsourceAmountChange" (
  "id" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "outsourceOrderId" TEXT NOT NULL,
  "previousAmount" DECIMAL(12,2),
  "newAmount" DECIMAL(12,2) NOT NULL,
  "reason" TEXT NOT NULL,
  "changedById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "OutsourceAmountChange_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OutsourceAmountChange_idempotencyKey_key"
  ON "OutsourceAmountChange"("idempotencyKey");
CREATE INDEX "OutsourceAmountChange_outsourceOrderId_createdAt_idx"
  ON "OutsourceAmountChange"("outsourceOrderId", "createdAt");
CREATE INDEX "OutsourceAmountChange_changedById_createdAt_idx"
  ON "OutsourceAmountChange"("changedById", "createdAt");

ALTER TABLE "OutsourceAmountChange"
  ADD CONSTRAINT "OutsourceAmountChange_outsourceOrderId_fkey"
  FOREIGN KEY ("outsourceOrderId") REFERENCES "OutsourceOrder"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OutsourceAmountChange"
  ADD CONSTRAINT "OutsourceAmountChange_changedById_fkey"
  FOREIGN KEY ("changedById") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
