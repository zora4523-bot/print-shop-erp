-- PR-4: Pigsty-backed price dictionary constraints.
--
-- btree_gist is PostgreSQL contrib and available through Pigsty. It lets us
-- express the key invariant for price tiers: the same product + minQty cannot
-- have overlapping effective windows.

CREATE EXTENSION IF NOT EXISTS btree_gist;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "PriceTier" a
    JOIN "PriceTier" b
      ON a.id < b.id
     AND a."productId" = b."productId"
     AND a."minQty" = b."minQty"
     AND tsrange(
          a."effectiveFrom",
          COALESCE(a."effectiveTo", 'infinity'::timestamp),
          '[)'
        ) && tsrange(
          b."effectiveFrom",
          COALESCE(b."effectiveTo", 'infinity'::timestamp),
          '[)'
        )
  ) THEN
    RAISE EXCEPTION 'Cannot add PriceTier exclusion constraint: overlapping effective windows exist';
  END IF;
END
$$;

ALTER TABLE "PriceTier"
  ADD CONSTRAINT "PriceTier_effective_window_valid"
  CHECK ("effectiveTo" IS NULL OR "effectiveTo" > "effectiveFrom");

ALTER TABLE "PriceTier"
  ADD CONSTRAINT "PriceTier_product_minQty_effective_no_overlap"
  EXCLUDE USING gist (
    "productId" WITH =,
    "minQty" WITH =,
    tsrange(
      "effectiveFrom",
      COALESCE("effectiveTo", 'infinity'::timestamp),
      '[)'
    ) WITH &&
  );

-- pg_jsonschema is a Pigsty extension. Keep it optional for local PostgreSQL
-- installs that have not installed Pigsty extension packages; Pigsty
-- environments will create the extension and enforce the constraint.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_available_extensions WHERE name = 'pg_jsonschema'
  ) THEN
    EXECUTE 'CREATE EXTENSION IF NOT EXISTS pg_jsonschema';
    ALTER TABLE "PriceAdjustment"
      ADD CONSTRAINT "PriceAdjustment_triggerCondition_object"
      CHECK (
        "triggerCondition" IS NULL OR jsonb_matches_schema(
          '{"type":"object"}'::json,
          "triggerCondition"
        )
      );
  ELSE
    RAISE NOTICE 'pg_jsonschema extension is not available; skipping PriceAdjustment.triggerCondition JSON schema check';
  END IF;
END
$$;
