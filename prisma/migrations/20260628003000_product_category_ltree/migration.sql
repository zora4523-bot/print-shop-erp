-- PR-5: product category tree backed by Pigsty/PostgreSQL ltree.
--
-- Prisma 7.7 does not expose @db.LTree, so the application writes a stable
-- text `path` while PostgreSQL maintains a generated ltree column for tree
-- validation/indexing. Product.category remains as a denormalized legacy
-- enum for existing reports and order forms.

CREATE EXTENSION IF NOT EXISTS ltree;

CREATE TABLE "ProductCategoryNode" (
  "id" TEXT NOT NULL,
  "path" TEXT NOT NULL,
  "pathLtree" ltree GENERATED ALWAYS AS ("path"::ltree) STORED,
  "name" TEXT NOT NULL,
  "legacyCategory" "ProductCategory" NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ProductCategoryNode_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProductCategoryNode_path_ltree_safe"
    CHECK ("path" ~ '^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*$')
);

CREATE UNIQUE INDEX "ProductCategoryNode_path_key"
  ON "ProductCategoryNode"("path");
CREATE INDEX "ProductCategoryNode_legacyCategory_idx"
  ON "ProductCategoryNode"("legacyCategory");
CREATE INDEX "ProductCategoryNode_isActive_idx"
  ON "ProductCategoryNode"("isActive");
CREATE INDEX "ProductCategoryNode_pathLtree_gist_idx"
  ON "ProductCategoryNode" USING gist ("pathLtree");

INSERT INTO "ProductCategoryNode" (
  "id", "path", "name", "legacyCategory", "sortOrder", "isActive", "createdAt", "updatedAt"
) VALUES
  ('cat_blank_stock', 'product.blank_stock', '空白现货', 'BLANK_STOCK', 10, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('cat_generic_stock', 'product.generic_stock', '通版现货', 'GENERIC_STOCK', 20, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('cat_custom_flat_foil', 'product.custom_flat_foil', '专版烫金', 'CUSTOM_FLAT_FOIL', 30, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('cat_color_print', 'product.color_print', '彩印', 'COLOR_PRINT', 40, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('cat_stock_foil_add', 'product.stock_foil_add', '现货加烫', 'STOCK_FOIL_ADD', 50, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('cat_byo_material', 'product.byo_material', '自带纸料', 'BYO_MATERIAL', 60, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

ALTER TABLE "Product"
  ADD COLUMN "categoryNodeId" TEXT;

UPDATE "Product"
SET "categoryNodeId" = CASE "category"
  WHEN 'BLANK_STOCK' THEN 'cat_blank_stock'
  WHEN 'GENERIC_STOCK' THEN 'cat_generic_stock'
  WHEN 'CUSTOM_FLAT_FOIL' THEN 'cat_custom_flat_foil'
  WHEN 'COLOR_PRINT' THEN 'cat_color_print'
  WHEN 'STOCK_FOIL_ADD' THEN 'cat_stock_foil_add'
  WHEN 'BYO_MATERIAL' THEN 'cat_byo_material'
END;

ALTER TABLE "Product"
  ALTER COLUMN "categoryNodeId" SET NOT NULL;

CREATE INDEX "Product_categoryNodeId_idx"
  ON "Product"("categoryNodeId");

ALTER TABLE "Product"
  ADD CONSTRAINT "Product_categoryNodeId_fkey"
  FOREIGN KEY ("categoryNodeId") REFERENCES "ProductCategoryNode"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
