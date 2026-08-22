-- Material search indexes for the inventory dashboard.
--
-- Material.code is citext after PR-3, so text-search operator classes use a
-- code::text expression index. pg_bigm remains optional for Pigsty deployments
-- that have the package installed; pg_trgm is required.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "Material_code_trgm_idx"
  ON "Material" USING gin (("code"::text) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Material_name_trgm_idx"
  ON "Material" USING gin ("name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Material_specification_trgm_idx"
  ON "Material" USING gin ("specification" gin_trgm_ops)
  WHERE "specification" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "Material_unit_trgm_idx"
  ON "Material" USING gin ("unit" gin_trgm_ops);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'pg_bigm'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS "Material_code_bigm_idx" ON "Material" USING gin (("code"::text) gin_bigm_ops)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS "Material_name_bigm_idx" ON "Material" USING gin ("name" gin_bigm_ops)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS "Material_specification_bigm_idx" ON "Material" USING gin ("specification" gin_bigm_ops) WHERE "specification" IS NOT NULL';
    EXECUTE 'CREATE INDEX IF NOT EXISTS "Material_unit_bigm_idx" ON "Material" USING gin ("unit" gin_bigm_ops)';
  END IF;
END
$$;
