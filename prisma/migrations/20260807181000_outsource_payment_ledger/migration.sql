BEGIN;

CREATE TABLE "OutsourcePayment" (
  "id" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "outsourceOrderId" TEXT NOT NULL,
  "amount" DECIMAL(12, 2) NOT NULL,
  "paidAt" TIMESTAMP(3) NOT NULL,
  "method" TEXT,
  "reference" TEXT,
  "remark" TEXT,
  "recordedById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "OutsourcePayment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OutsourcePayment_amount_positive" CHECK ("amount" > 0),
  CONSTRAINT "OutsourcePayment_outsourceOrderId_fkey"
    FOREIGN KEY ("outsourceOrderId") REFERENCES "OutsourceOrder"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "OutsourcePayment_recordedById_fkey"
    FOREIGN KEY ("recordedById") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "OutsourcePayment_idempotencyKey_key"
  ON "OutsourcePayment"("idempotencyKey");
CREATE INDEX "OutsourcePayment_outsourceOrderId_paidAt_idx"
  ON "OutsourcePayment"("outsourceOrderId", "paidAt");
CREATE INDEX "OutsourcePayment_recordedById_createdAt_idx"
  ON "OutsourcePayment"("recordedById", "createdAt");

COMMIT;
