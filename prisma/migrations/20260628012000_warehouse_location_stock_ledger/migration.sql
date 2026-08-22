-- A18: Warehouse / location stock ledger extension.
--
-- Transitional strategy:
-- 1. Keep Material.currentStock as the global summary used by existing pages.
-- 2. Add MaterialLocationStock as the per-location summary.
-- 3. Create a default warehouse/location and backfill every existing material's
--    currentStock into that location.
-- 4. Backfill existing MaterialTransaction rows to the default location so the
--    ledger can be filtered by location without breaking historical rows.

CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE "Warehouse" (
  "id" TEXT NOT NULL,
  "code" CITEXT NOT NULL,
  "name" TEXT NOT NULL,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Warehouse_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WarehouseLocation" (
  "id" TEXT NOT NULL,
  "warehouseId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "WarehouseLocation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MaterialLocationStock" (
  "id" TEXT NOT NULL,
  "materialId" TEXT NOT NULL,
  "warehouseId" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "currentStock" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "MaterialLocationStock_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "MaterialTransaction"
  ADD COLUMN "warehouseId" TEXT,
  ADD COLUMN "locationId" TEXT;

CREATE UNIQUE INDEX "Warehouse_code_key" ON "Warehouse"("code");
CREATE UNIQUE INDEX "Warehouse_one_default_idx"
  ON "Warehouse"("isDefault")
  WHERE "isDefault";
CREATE INDEX "Warehouse_isActive_idx" ON "Warehouse"("isActive");
CREATE INDEX "Warehouse_isDefault_idx" ON "Warehouse"("isDefault");

CREATE UNIQUE INDEX "WarehouseLocation_warehouseId_code_key"
  ON "WarehouseLocation"("warehouseId", "code");
CREATE UNIQUE INDEX "WarehouseLocation_one_default_per_warehouse_idx"
  ON "WarehouseLocation"("warehouseId")
  WHERE "isDefault";
CREATE INDEX "WarehouseLocation_warehouseId_idx" ON "WarehouseLocation"("warehouseId");
CREATE INDEX "WarehouseLocation_isActive_idx" ON "WarehouseLocation"("isActive");
CREATE INDEX "WarehouseLocation_isDefault_idx" ON "WarehouseLocation"("isDefault");

CREATE UNIQUE INDEX "MaterialLocationStock_materialId_locationId_key"
  ON "MaterialLocationStock"("materialId", "locationId");
CREATE INDEX "MaterialLocationStock_materialId_idx" ON "MaterialLocationStock"("materialId");
CREATE INDEX "MaterialLocationStock_warehouseId_idx" ON "MaterialLocationStock"("warehouseId");
CREATE INDEX "MaterialLocationStock_locationId_idx" ON "MaterialLocationStock"("locationId");

CREATE INDEX "MaterialTransaction_warehouseId_idx" ON "MaterialTransaction"("warehouseId");
CREATE INDEX "MaterialTransaction_locationId_idx" ON "MaterialTransaction"("locationId");

ALTER TABLE "WarehouseLocation"
  ADD CONSTRAINT "WarehouseLocation_warehouseId_fkey"
  FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MaterialLocationStock"
  ADD CONSTRAINT "MaterialLocationStock_materialId_fkey"
  FOREIGN KEY ("materialId") REFERENCES "Material"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MaterialLocationStock"
  ADD CONSTRAINT "MaterialLocationStock_warehouseId_fkey"
  FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MaterialLocationStock"
  ADD CONSTRAINT "MaterialLocationStock_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "WarehouseLocation"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "Warehouse" (
  id, code, name, "isDefault", "isActive", "createdAt", "updatedAt"
) VALUES (
  'default_warehouse', 'DEFAULT', '默认仓库', true, true, NOW(), NOW()
) ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  "isDefault" = true,
  "isActive" = true,
  "updatedAt" = NOW();

INSERT INTO "WarehouseLocation" (
  id, "warehouseId", code, name, "isDefault", "isActive", "createdAt", "updatedAt"
) VALUES (
  'default_location', 'default_warehouse', 'DEFAULT', '默认库位', true, true, NOW(), NOW()
) ON CONFLICT ("warehouseId", code) DO UPDATE SET
  name = EXCLUDED.name,
  "isDefault" = true,
  "isActive" = true,
  "updatedAt" = NOW();

INSERT INTO "MaterialLocationStock" (
  id, "materialId", "warehouseId", "locationId", "currentStock", "createdAt", "updatedAt"
)
SELECT
  'mls_' || md5(m.id || ':default_location'),
  m.id,
  'default_warehouse',
  'default_location',
  m."currentStock",
  NOW(),
  NOW()
FROM "Material" m
ON CONFLICT ("materialId", "locationId") DO UPDATE SET
  "currentStock" = EXCLUDED."currentStock",
  "updatedAt" = NOW();

UPDATE "MaterialTransaction"
SET "warehouseId" = 'default_warehouse',
    "locationId" = 'default_location'
WHERE "warehouseId" IS NULL
  AND "locationId" IS NULL;

ALTER TABLE "MaterialTransaction"
  ADD CONSTRAINT "MaterialTransaction_warehouseId_fkey"
  FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MaterialTransaction"
  ADD CONSTRAINT "MaterialTransaction_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "WarehouseLocation"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
