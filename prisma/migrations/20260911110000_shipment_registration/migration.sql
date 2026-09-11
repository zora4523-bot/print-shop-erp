-- AlterTable
ALTER TABLE "OrderShipment" ADD COLUMN     "carrierName" VARCHAR(80),
ADD COLUMN     "registrationVersion" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "OrderShipmentLabel" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "image" BYTEA NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderShipmentLabel_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrderShipmentLabel_shipmentId_createdAt_idx" ON "OrderShipmentLabel"("shipmentId", "createdAt");

-- AddForeignKey
ALTER TABLE "OrderShipmentLabel" ADD CONSTRAINT "OrderShipmentLabel_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "OrderShipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Bound private images even if a future writer bypasses application validation.
ALTER TABLE "OrderShipmentLabel" ADD CONSTRAINT "OrderShipmentLabel_image_size_check" CHECK (octet_length("image") BETWEEN 1 AND 524288);
