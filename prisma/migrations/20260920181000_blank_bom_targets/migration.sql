-- New blank-stock orders target paper + standard specification directly.
-- Existing product/category BOMs remain unchanged for historical orders.
ALTER TABLE "BillOfMaterial"
  ADD COLUMN "blankPaperMaterialId" TEXT,
  ADD COLUMN "blankSpecificationKey" TEXT;
ALTER TABLE "BillOfMaterial"
  DROP CONSTRAINT "BillOfMaterial_exactly_one_target_check",
  ADD CONSTRAINT "BillOfMaterial_exactly_one_target_check" CHECK (
    ("productId" IS NOT NULL AND "categoryNodeId" IS NULL AND "blankPaperMaterialId" IS NULL AND "blankSpecificationKey" IS NULL)
    OR ("productId" IS NULL AND "categoryNodeId" IS NOT NULL AND "blankPaperMaterialId" IS NULL AND "blankSpecificationKey" IS NULL)
    OR ("productId" IS NULL AND "categoryNodeId" IS NULL AND "blankPaperMaterialId" IS NOT NULL AND "blankSpecificationKey" IS NOT NULL
      AND "blankSpecificationKey" IN ('mini', 'square', 'mid', 'large', 'west-mid', 'west-large'))
  ),
  ADD CONSTRAINT "BillOfMaterial_blankPaperMaterialId_fkey"
    FOREIGN KEY ("blankPaperMaterialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "BillOfMaterial_blank_target_version_key"
  ON "BillOfMaterial" ("blankPaperMaterialId", "blankSpecificationKey", "version");
CREATE UNIQUE INDEX "BillOfMaterial_active_blank_target_key"
  ON "BillOfMaterial" ("blankPaperMaterialId", "blankSpecificationKey")
  WHERE "isActive" AND "blankPaperMaterialId" IS NOT NULL;
CREATE INDEX "BillOfMaterial_blank_target_idx"
  ON "BillOfMaterial" ("blankPaperMaterialId", "blankSpecificationKey");
-- Prevent deleting historical product/category BOMs through cascading targets.
ALTER TABLE "BillOfMaterial" DROP CONSTRAINT "BillOfMaterial_productId_fkey",
  ADD CONSTRAINT "BillOfMaterial_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BillOfMaterial" DROP CONSTRAINT "BillOfMaterial_categoryNodeId_fkey",
  ADD CONSTRAINT "BillOfMaterial_categoryNodeId_fkey" FOREIGN KEY ("categoryNodeId") REFERENCES "ProductCategoryNode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A JSON setting intentionally avoids a new sales state/table. Validate its
-- production-only reference and protect it against category retirement/deletion.
CREATE FUNCTION guard_blank_bom_category_setting() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE category_id TEXT;
BEGIN
  IF NEW.key = 'blank_stock_bom_category_node_id' AND NEW.value <> 'null'::jsonb THEN
    IF jsonb_typeof(NEW.value) <> 'string' THEN
      RAISE EXCEPTION '空白封默认用料分类必须是分类 ID 或 null';
    END IF;
    category_id := NEW.value #>> '{}';
    PERFORM id FROM "ProductCategoryNode" WHERE id = category_id AND "isActive" AND "legacyCategory" = 'BLANK_STOCK' FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION '空白封默认用料分类不存在或已失效'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "Setting_blank_bom_category_guard" BEFORE INSERT OR UPDATE ON "Setting"
  FOR EACH ROW EXECUTE FUNCTION guard_blank_bom_category_setting();
CREATE FUNCTION guard_blank_bom_category_reference() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Setting" WHERE key = 'blank_stock_bom_category_node_id' AND value = to_jsonb(OLD.id)) THEN
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION '分类仍被空白封默认用料配置引用'; END IF;
    IF NOT NEW."isActive" OR NEW."legacyCategory" IS DISTINCT FROM 'BLANK_STOCK' OR NEW.id <> OLD.id THEN
      RAISE EXCEPTION '分类仍被空白封默认用料配置引用';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "ProductCategoryNode_blank_bom_reference_guard" BEFORE DELETE OR UPDATE ON "ProductCategoryNode"
  FOR EACH ROW EXECUTE FUNCTION guard_blank_bom_category_reference();
