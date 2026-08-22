-- A19: BOM and material usage planning.
--
-- Rules:
-- 1. A BOM targets exactly one product OR one product category node.
-- 2. A target can keep historical inactive versions, but only one active
--    product/category BOM may exist at a time.
-- 3. Quantities are planning-only. This migration does not issue stock.

CREATE TABLE "BillOfMaterial" (
  "id" TEXT NOT NULL,
  "productId" TEXT,
  "categoryNodeId" TEXT,
  "name" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "baseQuantity" INTEGER NOT NULL DEFAULT 1,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "BillOfMaterial_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BillOfMaterial_exactly_one_target_check"
    CHECK (
      (CASE WHEN "productId" IS NULL THEN 0 ELSE 1 END) +
      (CASE WHEN "categoryNodeId" IS NULL THEN 0 ELSE 1 END) = 1
    ),
  CONSTRAINT "BillOfMaterial_baseQuantity_positive_check"
    CHECK ("baseQuantity" > 0)
);

CREATE TABLE "BillOfMaterialItem" (
  "id" TEXT NOT NULL,
  "bomId" TEXT NOT NULL,
  "materialId" TEXT NOT NULL,
  "quantity" DECIMAL(12,4) NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 10,
  "remark" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "BillOfMaterialItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BillOfMaterialItem_quantity_positive_check"
    CHECK ("quantity" > 0)
);

CREATE UNIQUE INDEX "BillOfMaterial_productId_version_key"
  ON "BillOfMaterial"("productId", "version");
CREATE UNIQUE INDEX "BillOfMaterial_categoryNodeId_version_key"
  ON "BillOfMaterial"("categoryNodeId", "version");
CREATE UNIQUE INDEX "BillOfMaterial_active_product_key"
  ON "BillOfMaterial"("productId")
  WHERE "isActive" AND "productId" IS NOT NULL;
CREATE UNIQUE INDEX "BillOfMaterial_active_category_key"
  ON "BillOfMaterial"("categoryNodeId")
  WHERE "isActive" AND "categoryNodeId" IS NOT NULL;
CREATE INDEX "BillOfMaterial_productId_idx" ON "BillOfMaterial"("productId");
CREATE INDEX "BillOfMaterial_categoryNodeId_idx" ON "BillOfMaterial"("categoryNodeId");
CREATE INDEX "BillOfMaterial_isActive_idx" ON "BillOfMaterial"("isActive");

CREATE UNIQUE INDEX "BillOfMaterialItem_bomId_materialId_key"
  ON "BillOfMaterialItem"("bomId", "materialId");
CREATE INDEX "BillOfMaterialItem_bomId_idx" ON "BillOfMaterialItem"("bomId");
CREATE INDEX "BillOfMaterialItem_materialId_idx" ON "BillOfMaterialItem"("materialId");

ALTER TABLE "BillOfMaterial"
  ADD CONSTRAINT "BillOfMaterial_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BillOfMaterial"
  ADD CONSTRAINT "BillOfMaterial_categoryNodeId_fkey"
  FOREIGN KEY ("categoryNodeId") REFERENCES "ProductCategoryNode"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BillOfMaterialItem"
  ADD CONSTRAINT "BillOfMaterialItem_bomId_fkey"
  FOREIGN KEY ("bomId") REFERENCES "BillOfMaterial"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BillOfMaterialItem"
  ADD CONSTRAINT "BillOfMaterialItem_materialId_fkey"
  FOREIGN KEY ("materialId") REFERENCES "Material"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
