CREATE TYPE "OrderKind" AS ENUM ('NORMAL', 'REWORK');
CREATE TYPE "OrderBillingMode" AS ENUM ('CHARGE', 'NO_CHARGE');
CREATE TYPE "ReworkCause" AS ENUM ('QUALITY', 'LOGISTICS_DAMAGE', 'OTHER');
CREATE TYPE "ShipmentStatus" AS ENUM ('PLANNED', 'SHIPPED');

ALTER TABLE "Order"
  ADD COLUMN "kind" "OrderKind" NOT NULL DEFAULT 'NORMAL',
  ADD COLUMN "billingMode" "OrderBillingMode" NOT NULL DEFAULT 'CHARGE',
  ADD COLUMN "sourceOrderId" TEXT,
  ADD COLUMN "reworkCause" "ReworkCause",
  ADD COLUMN "reworkReason" TEXT;

ALTER TABLE "Order"
  ADD CONSTRAINT "Order_sourceOrderId_fkey"
  FOREIGN KEY ("sourceOrderId") REFERENCES "Order"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "OrderShipment" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "receiverName" TEXT,
  "receiverPhone" TEXT,
  "receiverAddress" TEXT,
  "expressCode" TEXT,
  "trackingNo" TEXT,
  "status" "ShipmentStatus" NOT NULL DEFAULT 'PLANNED',
  "shippedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OrderShipment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OrderShipment_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "Order"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "OrderShipmentLine" (
  "id" TEXT NOT NULL,
  "shipmentId" TEXT NOT NULL,
  "orderItemId" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  CONSTRAINT "OrderShipmentLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OrderShipmentLine_shipmentId_fkey"
    FOREIGN KEY ("shipmentId") REFERENCES "OrderShipment"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "OrderShipmentLine_orderItemId_fkey"
    FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "OrderShipment_orderId_sequence_key"
  ON "OrderShipment"("orderId", "sequence");
CREATE INDEX "OrderShipment_orderId_status_idx"
  ON "OrderShipment"("orderId", "status");
CREATE UNIQUE INDEX "OrderShipmentLine_shipmentId_orderItemId_key"
  ON "OrderShipmentLine"("shipmentId", "orderItemId");
CREATE INDEX "OrderShipmentLine_orderItemId_idx"
  ON "OrderShipmentLine"("orderItemId");
CREATE INDEX "Order_sourceOrderId_idx" ON "Order"("sourceOrderId");
CREATE INDEX "Order_kind_idx" ON "Order"("kind");
CREATE INDEX "Order_billingMode_idx" ON "Order"("billingMode");

-- Compatibility backfill: every historical order becomes a one-address
-- shipment. The top-level receiver/tracking fields remain as the primary
-- shipment snapshot so old integrations and existing print data keep working.
INSERT INTO "OrderShipment" (
  "id", "orderId", "sequence", "receiverName", "receiverPhone",
  "receiverAddress", "expressCode", "trackingNo", "status",
  "shippedAt", "createdAt", "updatedAt"
)
SELECT
  'ship_' || substr(md5(o."id"), 1, 24),
  o."id",
  1,
  o."receiverName",
  o."receiverPhone",
  o."receiverAddress",
  o."expressCode",
  o."trackingNo",
  CASE
    WHEN o."status" IN ('SHIPPED', 'FINISHED')
      THEN 'SHIPPED'::"ShipmentStatus"
    ELSE 'PLANNED'::"ShipmentStatus"
  END,
  o."shippedAt",
  o."createdAt",
  o."updatedAt"
FROM "Order" o;

INSERT INTO "OrderShipmentLine" (
  "id", "shipmentId", "orderItemId", "quantity"
)
SELECT
  'sline_' || substr(md5(i."id"), 1, 24),
  'ship_' || substr(md5(i."orderId"), 1, 24),
  i."id",
  i."quantity"
FROM "OrderItem" i;
