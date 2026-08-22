-- PR-3: case-insensitive identifiers backed by Pigsty/PostgreSQL citext.
--
-- User.username and Material.code already exist and are unique. Before
-- converting them to citext, explicitly fail if the current data contains
-- case-insensitive duplicates; otherwise PostgreSQL would fail later with a
-- generic unique-index rebuild error.

CREATE EXTENSION IF NOT EXISTS citext;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM (
      SELECT lower(username) AS normalized
      FROM "User"
      GROUP BY lower(username)
      HAVING count(*) > 1
    ) dup
  ) THEN
    RAISE EXCEPTION 'Cannot convert User.username to citext: case-insensitive duplicates exist';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (
      SELECT lower(code) AS normalized
      FROM "Material"
      GROUP BY lower(code)
      HAVING count(*) > 1
    ) dup
  ) THEN
    RAISE EXCEPTION 'Cannot convert Material.code to citext: case-insensitive duplicates exist';
  END IF;
END
$$;

ALTER TABLE "User"
  ALTER COLUMN "username" TYPE citext USING "username"::citext;

ALTER TABLE "Material"
  ALTER COLUMN "code" TYPE citext USING "code"::citext;

ALTER TABLE "Product"
  ADD COLUMN "code" citext;

CREATE UNIQUE INDEX "Product_code_key" ON "Product"("code");

CREATE INDEX IF NOT EXISTS "Product_code_trgm_idx"
  ON "Product" USING gin (("code"::text) gin_trgm_ops)
  WHERE "code" IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'pg_bigm'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS "Product_code_bigm_idx" ON "Product" USING gin (("code"::text) gin_bigm_ops) WHERE "code" IS NOT NULL';
  END IF;
END
$$;
