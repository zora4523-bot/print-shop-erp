-- Strengthen purchase receiving and warehouse inventory integrity.

-- Existing receipts predate request idempotency. Their own immutable ids are
-- safe deterministic legacy keys.
ALTER TABLE "PurchaseReceipt" ADD COLUMN "idempotencyKey" TEXT;
UPDATE "PurchaseReceipt"
   SET "idempotencyKey" = 'legacy:' || id
 WHERE "idempotencyKey" IS NULL;
ALTER TABLE "PurchaseReceipt" ALTER COLUMN "idempotencyKey" SET NOT NULL;
CREATE UNIQUE INDEX "PurchaseReceipt_idempotencyKey_key"
  ON "PurchaseReceipt"("idempotencyKey");

ALTER TABLE "MaterialTransaction"
  ADD COLUMN "stockTransferId" TEXT,
  ADD COLUMN "inventoryCountItemId" TEXT;

CREATE TABLE "StockTransfer" (
  id TEXT NOT NULL,
  "transferNo" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "materialId" TEXT NOT NULL,
  "sourceLocationId" TEXT NOT NULL,
  "destinationLocationId" TEXT NOT NULL,
  quantity DECIMAL(12,2) NOT NULL,
  "operatorId" TEXT NOT NULL,
  remark TEXT,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "StockTransfer_pkey" PRIMARY KEY (id),
  CONSTRAINT "StockTransfer_quantity_check" CHECK (quantity > 0),
  CONSTRAINT "StockTransfer_locations_check" CHECK ("sourceLocationId" <> "destinationLocationId")
);

CREATE TABLE "InventoryCount" (
  id TEXT NOT NULL,
  "countNo" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "countedById" TEXT NOT NULL,
  "countedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  remark TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "InventoryCount_pkey" PRIMARY KEY (id)
);

CREATE TABLE "InventoryCountItem" (
  id TEXT NOT NULL,
  "inventoryCountId" TEXT NOT NULL,
  "materialId" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "bookQuantity" DECIMAL(12,2) NOT NULL,
  "countedQuantity" DECIMAL(12,2) NOT NULL,
  difference DECIMAL(12,2) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "InventoryCountItem_pkey" PRIMARY KEY (id),
  CONSTRAINT "InventoryCountItem_book_quantity_check" CHECK ("bookQuantity" >= 0),
  CONSTRAINT "InventoryCountItem_counted_quantity_check" CHECK ("countedQuantity" >= 0),
  CONSTRAINT "InventoryCountItem_difference_check"
    CHECK (difference = "countedQuantity" - "bookQuantity")
);

CREATE UNIQUE INDEX "StockTransfer_transferNo_key" ON "StockTransfer"("transferNo");
CREATE UNIQUE INDEX "StockTransfer_idempotencyKey_key" ON "StockTransfer"("idempotencyKey");
CREATE INDEX "StockTransfer_materialId_idx" ON "StockTransfer"("materialId");
CREATE INDEX "StockTransfer_sourceLocationId_idx" ON "StockTransfer"("sourceLocationId");
CREATE INDEX "StockTransfer_destinationLocationId_idx" ON "StockTransfer"("destinationLocationId");
CREATE INDEX "StockTransfer_occurredAt_idx" ON "StockTransfer"("occurredAt");

CREATE UNIQUE INDEX "InventoryCount_countNo_key" ON "InventoryCount"("countNo");
CREATE UNIQUE INDEX "InventoryCount_idempotencyKey_key" ON "InventoryCount"("idempotencyKey");
CREATE INDEX "InventoryCount_countedById_idx" ON "InventoryCount"("countedById");
CREATE INDEX "InventoryCount_countedAt_idx" ON "InventoryCount"("countedAt");
CREATE UNIQUE INDEX "InventoryCountItem_inventoryCountId_materialId_locationId_key"
  ON "InventoryCountItem"("inventoryCountId", "materialId", "locationId");
CREATE INDEX "InventoryCountItem_materialId_idx" ON "InventoryCountItem"("materialId");
CREATE INDEX "InventoryCountItem_locationId_idx" ON "InventoryCountItem"("locationId");

CREATE INDEX "MaterialTransaction_stockTransferId_idx"
  ON "MaterialTransaction"("stockTransferId");
CREATE UNIQUE INDEX "MaterialTransaction_inventoryCountItemId_key"
  ON "MaterialTransaction"("inventoryCountItemId");
CREATE UNIQUE INDEX "MaterialTransaction_stockTransferId_direction_key"
  ON "MaterialTransaction"("stockTransferId", direction);

-- A posted purchase receipt item has exactly one forward ledger row and at
-- most one reversing row. These indexes are the last line of defence against
-- retries and concurrent cancellation.
CREATE UNIQUE INDEX "MaterialTransaction_purchase_receipt_in_key"
  ON "MaterialTransaction"("purchaseReceiptItemId")
  WHERE "purchaseReceiptItemId" IS NOT NULL
    AND direction = 'IN'::"TxDirection"
    AND "reasonType" = 'PURCHASE_RECEIPT';
CREATE UNIQUE INDEX "MaterialTransaction_purchase_receipt_cancel_key"
  ON "MaterialTransaction"("purchaseReceiptItemId")
  WHERE "purchaseReceiptItemId" IS NOT NULL
    AND direction = 'OUT'::"TxDirection"
    AND "reasonType" = 'PURCHASE_RECEIPT_CANCEL';

ALTER TABLE "Material"
  ADD CONSTRAINT "Material_currentStock_check" CHECK ("currentStock" >= 0) NOT VALID;
ALTER TABLE "MaterialLocationStock"
  ADD CONSTRAINT "MaterialLocationStock_currentStock_check" CHECK ("currentStock" >= 0) NOT VALID;
ALTER TABLE "MaterialTransaction"
  ADD CONSTRAINT "MaterialTransaction_quantity_check" CHECK (quantity > 0) NOT VALID;
ALTER TABLE "PurchaseOrderItem"
  ADD CONSTRAINT "PurchaseOrderItem_quantity_check" CHECK (quantity > 0) NOT VALID,
  ADD CONSTRAINT "PurchaseOrderItem_receivedQuantity_check"
    CHECK ("receivedQuantity" >= 0 AND "receivedQuantity" <= quantity) NOT VALID;
ALTER TABLE "PurchaseReceiptItem"
  ADD CONSTRAINT "PurchaseReceiptItem_quantity_check" CHECK (quantity > 0) NOT VALID;

ALTER TABLE "Material" VALIDATE CONSTRAINT "Material_currentStock_check";
ALTER TABLE "MaterialLocationStock" VALIDATE CONSTRAINT "MaterialLocationStock_currentStock_check";
ALTER TABLE "MaterialTransaction" VALIDATE CONSTRAINT "MaterialTransaction_quantity_check";
ALTER TABLE "PurchaseOrderItem" VALIDATE CONSTRAINT "PurchaseOrderItem_quantity_check";
ALTER TABLE "PurchaseOrderItem" VALIDATE CONSTRAINT "PurchaseOrderItem_receivedQuantity_check";
ALTER TABLE "PurchaseReceiptItem" VALIDATE CONSTRAINT "PurchaseReceiptItem_quantity_check";

-- Keep the redundant warehouseId aligned with the selected location.
CREATE UNIQUE INDEX "WarehouseLocation_id_warehouseId_key"
  ON "WarehouseLocation"(id, "warehouseId");
ALTER TABLE "MaterialLocationStock"
  ADD CONSTRAINT "MaterialLocationStock_location_warehouse_fkey"
  FOREIGN KEY ("locationId", "warehouseId")
  REFERENCES "WarehouseLocation"(id, "warehouseId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MaterialTransaction"
  ADD CONSTRAINT "MaterialTransaction_location_warehouse_fkey"
  FOREIGN KEY ("locationId", "warehouseId")
  REFERENCES "WarehouseLocation"(id, "warehouseId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Warehouse and location history is immutable. Deactivation is the supported
-- lifecycle; deleting a used warehouse must never erase balances or locations.
ALTER TABLE "WarehouseLocation" DROP CONSTRAINT "WarehouseLocation_warehouseId_fkey";
ALTER TABLE "WarehouseLocation"
  ADD CONSTRAINT "WarehouseLocation_warehouseId_fkey"
  FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"(id)
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MaterialLocationStock" DROP CONSTRAINT "MaterialLocationStock_warehouseId_fkey";
ALTER TABLE "MaterialLocationStock"
  ADD CONSTRAINT "MaterialLocationStock_warehouseId_fkey"
  FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"(id)
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MaterialLocationStock" DROP CONSTRAINT "MaterialLocationStock_locationId_fkey";
ALTER TABLE "MaterialLocationStock"
  ADD CONSTRAINT "MaterialLocationStock_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "WarehouseLocation"(id)
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MaterialTransaction" DROP CONSTRAINT "MaterialTransaction_warehouseId_fkey";
ALTER TABLE "MaterialTransaction"
  ADD CONSTRAINT "MaterialTransaction_warehouseId_fkey"
  FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"(id)
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MaterialTransaction" DROP CONSTRAINT "MaterialTransaction_locationId_fkey";
ALTER TABLE "MaterialTransaction"
  ADD CONSTRAINT "MaterialTransaction_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "WarehouseLocation"(id)
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "StockTransfer"
  ADD CONSTRAINT "StockTransfer_materialId_fkey"
  FOREIGN KEY ("materialId") REFERENCES "Material"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "StockTransfer_sourceLocationId_fkey"
  FOREIGN KEY ("sourceLocationId") REFERENCES "WarehouseLocation"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "StockTransfer_destinationLocationId_fkey"
  FOREIGN KEY ("destinationLocationId") REFERENCES "WarehouseLocation"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "StockTransfer_operatorId_fkey"
  FOREIGN KEY ("operatorId") REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "InventoryCount"
  ADD CONSTRAINT "InventoryCount_countedById_fkey"
  FOREIGN KEY ("countedById") REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryCountItem"
  ADD CONSTRAINT "InventoryCountItem_inventoryCountId_fkey"
  FOREIGN KEY ("inventoryCountId") REFERENCES "InventoryCount"(id) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "InventoryCountItem_materialId_fkey"
  FOREIGN KEY ("materialId") REFERENCES "Material"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "InventoryCountItem_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "WarehouseLocation"(id) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MaterialTransaction"
  ADD CONSTRAINT "MaterialTransaction_stockTransferId_fkey"
  FOREIGN KEY ("stockTransferId") REFERENCES "StockTransfer"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "MaterialTransaction_inventoryCountItemId_fkey"
  FOREIGN KEY ("inventoryCountItemId") REFERENCES "InventoryCountItem"(id) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Per-location stock is authoritative. Repair any pre-existing drift before
-- installing the synchronization guard.
UPDATE "Material" material
   SET "currentStock" = stock.total,
       "updatedAt" = NOW()
  FROM (
    SELECT material.id,
           COALESCE(SUM(location_stock."currentStock"), 0)::DECIMAL(12,2) AS total
      FROM "Material" material
      LEFT JOIN "MaterialLocationStock" location_stock
        ON location_stock."materialId" = material.id
     GROUP BY material.id
  ) stock
 WHERE material.id = stock.id
   AND material."currentStock" <> stock.total;

CREATE FUNCTION sync_material_current_stock_from_locations()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  old_material_id TEXT;
  new_material_id TEXT;
BEGIN
  old_material_id := CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN OLD."materialId" ELSE NULL END;
  new_material_id := CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN NEW."materialId" ELSE NULL END;

  IF old_material_id IS NOT NULL AND old_material_id IS DISTINCT FROM new_material_id THEN
    UPDATE "Material"
       SET "currentStock" = (
             SELECT COALESCE(SUM(stock."currentStock"), 0)::DECIMAL(12,2)
               FROM "MaterialLocationStock" stock
              WHERE stock."materialId" = old_material_id
           ),
           "updatedAt" = NOW()
     WHERE id = old_material_id;
  END IF;

  IF new_material_id IS NOT NULL THEN
    UPDATE "Material"
       SET "currentStock" = (
             SELECT COALESCE(SUM(stock."currentStock"), 0)::DECIMAL(12,2)
               FROM "MaterialLocationStock" stock
              WHERE stock."materialId" = new_material_id
           ),
           "updatedAt" = NOW()
     WHERE id = new_material_id;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "MaterialLocationStock_sync_insert_delete"
AFTER INSERT OR DELETE ON "MaterialLocationStock"
FOR EACH ROW EXECUTE FUNCTION sync_material_current_stock_from_locations();
CREATE TRIGGER "MaterialLocationStock_sync_update"
AFTER UPDATE OF "currentStock", "materialId" ON "MaterialLocationStock"
FOR EACH ROW EXECUTE FUNCTION sync_material_current_stock_from_locations();

CREATE FUNCTION enforce_material_current_stock_summary()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  expected DECIMAL(12,2);
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."currentStock" <> 0 THEN
      RAISE EXCEPTION 'Material.currentStock is derived from location stock';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."currentStock" IS DISTINCT FROM OLD."currentStock" THEN
    SELECT COALESCE(SUM(stock."currentStock"), 0)::DECIMAL(12,2)
      INTO expected
      FROM "MaterialLocationStock" stock
     WHERE stock."materialId" = NEW.id;
    IF NEW."currentStock" <> expected THEN
      RAISE EXCEPTION 'Material.currentStock must equal location stock total';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Material_currentStock_insert_guard"
BEFORE INSERT ON "Material"
FOR EACH ROW EXECUTE FUNCTION enforce_material_current_stock_summary();
CREATE TRIGGER "Material_currentStock_update_guard"
BEFORE UPDATE OF "currentStock" ON "Material"
FOR EACH ROW EXECUTE FUNCTION enforce_material_current_stock_summary();
