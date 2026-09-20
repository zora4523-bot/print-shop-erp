-- Only new STOCK_BASE rows may omit Product. Published/historical rows are not rewritten.
-- Preserve existing immutability triggers and the per-product quantity exclusion.
CREATE FUNCTION blank_stock_price_identity(condition JSONB) RETURNS TEXT
LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE paper TEXT; spec TEXT; weight TEXT;
BEGIN
  IF condition ->> 'target' IS DISTINCT FROM 'ITEM'
    OR condition -> 'pricingRoutes' IS DISTINCT FROM '["STOCK_BLANK"]'::JSONB
    OR jsonb_typeof(condition -> 'paperTypes') IS DISTINCT FROM 'array'
    OR jsonb_typeof(condition -> 'specifications') IS DISTINCT FROM 'array' THEN RETURN NULL; END IF;
  IF jsonb_array_length(condition -> 'paperTypes') <> 1 OR jsonb_array_length(condition -> 'specifications') <> 1 THEN RETURN NULL; END IF;
  IF jsonb_typeof(condition -> 'paperTypes' -> 0) IS DISTINCT FROM 'string' OR jsonb_typeof(condition -> 'specifications' -> 0) IS DISTINCT FROM 'string' THEN RETURN NULL; END IF;
  paper := regexp_replace(condition -> 'paperTypes' ->> 0, '[[:space:]]', '', 'g');
  IF paper !~ '^[1-9][0-9]{0,3}[gG克][^/／|]+$' THEN RETURN NULL; END IF;
  weight := substring(paper FROM '^([0-9]+)');
  IF weight::INTEGER > 2000 THEN RETURN NULL; END IF;
  paper := regexp_replace(paper, '^[0-9]+[gG克]', '');
  spec := regexp_replace(condition -> 'specifications' ->> 0, '[[:space:]]', '', 'g');
  spec := regexp_replace(spec, '[0-9]+([.][0-9]+)?[×xX*][0-9]+([.][0-9]+)?(mm|毫米)?$', '', 'i');
  spec := CASE spec WHEN '迷你' THEN '迷你封' WHEN '方形' THEN '方形封' WHEN '中号' THEN '中号封' WHEN '大号' THEN '大号封' ELSE spec END;
  IF spec NOT IN ('迷你封','方形封','中号封','大号封','西封中号','西封大号') THEN RETURN NULL; END IF;
  RETURN jsonb_build_array(paper, weight::INTEGER, spec)::TEXT;
END $$;

ALTER TABLE "CustomerPriceRule"
  DROP CONSTRAINT "CustomerPriceRule_values_valid";

ALTER TABLE "CustomerPriceRule"
  ADD CONSTRAINT "CustomerPriceRule_values_valid" CHECK (
    btrim("code"::TEXT) <> '' AND
    btrim("name") <> '' AND
    "priority" >= 0 AND
    ("amount" IS NULL OR "amount" BETWEEN 0 AND 9999999999.9999) AND
    ("minQty" IS NULL OR "minQty" BETWEEN 1 AND 9999999) AND
    ("maxQty" IS NULL OR "maxQty" BETWEEN 1 AND 9999999) AND
    ("minQty" IS NULL OR "maxQty" IS NULL OR "minQty" <= "maxQty") AND
    ("triggerCondition" IS NULL OR jsonb_typeof("triggerCondition") = 'object') AND
    (
      (
        (("calculationType" IS NULL) = ("amount" IS NULL)) AND
        (
          "kind" = 'REFERENCE'::"CustomerPriceRuleKind" OR
          ("calculationType" IS NOT NULL AND "amount" IS NOT NULL)
        )
      ) OR COALESCE((
        "kind" = 'BASE'::"CustomerPriceRuleKind" AND
        "calculationType" =
          'FIXED_AMOUNT'::"CustomerPriceCalculationType" AND
        "amount" IS NULL AND
        "productId" IS NOT NULL AND
        "exclusiveGroup" = 'COLOR_BASE' AND
        NOT "blocksAutomaticQuote" AND
        "minQty" IS NOT NULL AND
        "minQty" = "maxQty" AND
        "minQty" = CASE
          WHEN "code"::TEXT ~ '_Q[1-9][0-9]{0,6}$'
          THEN substring("code"::TEXT FROM '_Q([1-9][0-9]{0,6})$')::INTEGER
          ELSE NULL
        END AND
        btrim(COALESCE("sourceSheet", '')) <> '' AND
        btrim(COALESCE("sourceRange", '')) <> '' AND
        "triggerCondition" ->> 'target' = 'ITEM' AND
        "triggerCondition" -> 'pricingRoutes' = '["COLOR_PRINT"]'::JSONB AND
        CASE
          WHEN jsonb_typeof("triggerCondition" -> 'productCodes') = 'array'
          THEN jsonb_array_length("triggerCondition" -> 'productCodes') = 1
            AND btrim("triggerCondition" -> 'productCodes' ->> 0) <> ''
          ELSE FALSE
        END AND
        CASE
          WHEN jsonb_typeof("triggerCondition" -> 'specifications') = 'array'
          THEN jsonb_array_length("triggerCondition" -> 'specifications') = 1
            AND btrim("triggerCondition" -> 'specifications' ->> 0) <> ''
          ELSE FALSE
        END AND
        CASE
          WHEN jsonb_typeof("triggerCondition" -> 'paperTypes') = 'array'
          THEN jsonb_array_length("triggerCondition" -> 'paperTypes') = 1
            AND btrim("triggerCondition" -> 'paperTypes' ->> 0) <> ''
          ELSE FALSE
        END
      ), FALSE)
    ) AND
    (
      "kind" <> 'BASE'::"CustomerPriceRuleKind" OR
      "productId" IS NOT NULL OR COALESCE((
        "exclusiveGroup" = 'STOCK_BASE' AND
        "calculationType" = 'PER_PIECE'::"CustomerPriceCalculationType" AND
        "amount" IS NOT NULL AND NOT "blocksAutomaticQuote" AND "isActive" AND
        "minQty" = 1 AND ("maxQty" IS NULL OR "maxQty" = 9999999) AND
        blank_stock_price_identity("triggerCondition") IS NOT NULL AND
        "triggerCondition" -> 'schemaVersion' = '1'::JSONB AND
        ("triggerCondition" - ARRAY['schemaVersion','target','pricingRoutes','paperTypes','specifications']) = '{}'::JSONB
      ), FALSE)
    ) AND
    (
      NOT "blocksAutomaticQuote" OR
      "kind" = 'REFERENCE'::"CustomerPriceRuleKind"
    ) AND
    (
      "calculationType" IS DISTINCT FROM
        'PER_SHEET'::"CustomerPriceCalculationType" OR
      ("triggerCondition" IS NOT NULL AND "triggerCondition" ? 'unitsPerSheet')
    )
  );

-- Protect the text identity even when productId is NULL. Old aliased rules share
-- the same identity; duplicates are an explicit migration preflight failure.
CREATE UNIQUE INDEX "CustomerPriceRule_blank_identity_unique"
  ON "CustomerPriceRule" ("priceBookId", blank_stock_price_identity("triggerCondition"))
  WHERE "exclusiveGroup" = 'STOCK_BASE';

CREATE FUNCTION validate_blank_stock_price_rule() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."exclusiveGroup" = 'STOCK_BASE' AND NEW."productId" IS NULL THEN
    IF NOT EXISTS (SELECT 1 FROM "CustomerChargeCategory" WHERE "id" = NEW."categoryId" AND "code" = 'BASE_PROCESSING' AND "isActive")
      OR NOT EXISTS (SELECT 1 FROM "CustomerPriceBook" WHERE "id" = NEW."priceBookId" AND "purpose" = 'PROCESSING' AND "settlementType" = 'EXTERNAL_SALES') THEN
      RAISE EXCEPTION 'Blank stock prices require an active base processing category and processing price book' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "CustomerPriceRule_blank_shape"
  BEFORE INSERT OR UPDATE ON "CustomerPriceRule"
  FOR EACH ROW EXECUTE FUNCTION validate_blank_stock_price_rule();
