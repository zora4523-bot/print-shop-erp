-- 录单人可为工单填写便于识别的自定义名称。
ALTER TABLE "Order" ADD COLUMN "customName" TEXT;

-- 工单列表支持按自定义名称 contains / ILIKE 搜索。pg_trgm 已由
-- 20260628000000_add_search_extensions 安装；Pigsty 有 pg_bigm 时再补
-- 短中文关键词索引，本地 PostgreSQL 没有该扩展也不阻塞迁移。
CREATE INDEX "Order_customName_trgm_idx"
  ON "Order" USING gin ("customName" gin_trgm_ops)
  WHERE "customName" IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'pg_bigm'
  ) THEN
    EXECUTE 'CREATE INDEX "Order_customName_bigm_idx" ON "Order" USING gin ("customName" gin_bigm_ops) WHERE "customName" IS NOT NULL';
  END IF;
END
$$;
