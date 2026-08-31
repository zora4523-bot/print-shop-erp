BEGIN;

-- The processing-rule v2 release replaced the previously structured book but
-- omitted its two order-level packaging rules. Release a complete successor
-- instead of mutating the already-published v2 book in place.
SELECT pg_advisory_xact_lock(
  hashtext('print-shop-erp:price-rule-snapshot:v1')
);

LOCK TABLE
  "CustomerPriceBook",
  "CustomerChargeCategory",
  "CustomerPriceRule"
IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
  released_at TIMESTAMP(3) :=
    (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::TIMESTAMP(3);
  source_book RECORD;
  current_book_id TEXT;
  current_book_count INTEGER;
  target_rule_count INTEGER;
  valid_packaging_count INTEGER;
  source_rule_count INTEGER;
  released_rule_count INTEGER;
  next_version INTEGER;
  next_notes JSONB;
  next_book_id CONSTANT TEXT :=
    'cpb_external_processing_rule_v2_packaging';
BEGIN
  -- A safely completed equivalent repair makes this migration a no-op.
  IF EXISTS (
    SELECT 1
    FROM "CustomerPriceBook"
    WHERE "id" = next_book_id
  ) THEN
    SELECT COUNT(*)
    INTO target_rule_count
    FROM "CustomerPriceRule" rule
    WHERE rule."priceBookId" = next_book_id
      AND rule."isActive" = TRUE
      AND rule."triggerCondition"->>'target' = 'PACKAGING_GROUP';

    SELECT COUNT(*)
    INTO valid_packaging_count
    FROM "CustomerPriceRule" rule
    JOIN "CustomerChargeCategory" category
      ON category."id" = rule."categoryId"
    WHERE rule."priceBookId" = next_book_id
      AND rule."isActive" = TRUE
      AND category."isActive" = TRUE
      AND category."code" = 'PACKING'::CITEXT
      AND rule."kind" = 'ADD_ON'::"CustomerPriceRuleKind"
      AND rule."calculationType" =
        'PER_BAG'::"CustomerPriceCalculationType"
      AND rule."productId" IS NULL
      AND rule."minQty" IS NULL
      AND rule."maxQty" IS NULL
      AND rule."exclusiveGroup" = 'PACKAGING_GROUP_MODE'
      AND rule."blocksAutomaticQuote" = FALSE
      AND (
        (
          rule."code" = 'PACKAGING_SINGLE_STYLE_PER_BAG'::CITEXT
          AND rule."amount" = 0.1000
          AND rule."triggerCondition" @>
            '{"schemaVersion":1,"target":"PACKAGING_GROUP","packagingModes":["SINGLE_STYLE"]}'::JSONB
        )
        OR
        (
          rule."code" = 'PACKAGING_MIXED_STYLE_PER_BAG'::CITEXT
          AND rule."amount" = 0.2000
          AND rule."triggerCondition" @>
            '{"schemaVersion":1,"target":"PACKAGING_GROUP","packagingModes":["MIXED_STYLE"]}'::JSONB
        )
      );

    IF target_rule_count <> 2 OR valid_packaging_count <> 2 THEN
      RAISE EXCEPTION
        'Existing packaging-rule repair book is incomplete or invalid';
    END IF;
    RETURN;
  END IF;

  SELECT COUNT(*), MIN(book."id")
  INTO current_book_count, current_book_id
  FROM "CustomerPriceBook" book
  WHERE book."settlementType" =
      'EXTERNAL_SALES'::"OrderSettlementType"
    AND book."purpose" = 'PROCESSING'::"CustomerPriceBookPurpose"
    AND book."isActive" = TRUE
    AND book."effectiveFrom" <= released_at
    AND (book."effectiveTo" IS NULL OR book."effectiveTo" > released_at);

  IF current_book_count <> 1 THEN
    RAISE EXCEPTION
      'Packaging-rule repair requires exactly one current external processing book';
  END IF;

  -- If an administrator already superseded v2, preserve that release. It is
  -- safe to no-op only when the newer current book has exactly the two valid
  -- packaging-group rules expected by the quote service.
  IF current_book_id <> 'cpb_external_processing_rule_v2' THEN
    SELECT COUNT(*)
    INTO target_rule_count
    FROM "CustomerPriceRule" rule
    WHERE rule."priceBookId" = current_book_id
      AND rule."isActive" = TRUE
      AND rule."triggerCondition"->>'target' = 'PACKAGING_GROUP';

    SELECT COUNT(*)
    INTO valid_packaging_count
    FROM "CustomerPriceRule" rule
    JOIN "CustomerChargeCategory" category
      ON category."id" = rule."categoryId"
    WHERE rule."priceBookId" = current_book_id
      AND rule."isActive" = TRUE
      AND category."isActive" = TRUE
      AND category."code" = 'PACKING'::CITEXT
      AND rule."kind" = 'ADD_ON'::"CustomerPriceRuleKind"
      AND rule."calculationType" =
        'PER_BAG'::"CustomerPriceCalculationType"
      AND rule."productId" IS NULL
      AND rule."minQty" IS NULL
      AND rule."maxQty" IS NULL
      AND rule."exclusiveGroup" = 'PACKAGING_GROUP_MODE'
      AND rule."blocksAutomaticQuote" = FALSE
      AND (
        (
          rule."amount" = 0.1000
          AND rule."triggerCondition" @>
            '{"schemaVersion":1,"target":"PACKAGING_GROUP","packagingModes":["SINGLE_STYLE"]}'::JSONB
        )
        OR
        (
          rule."amount" = 0.2000
          AND rule."triggerCondition" @>
            '{"schemaVersion":1,"target":"PACKAGING_GROUP","packagingModes":["MIXED_STYLE"]}'::JSONB
        )
      );

    IF target_rule_count = 2 AND valid_packaging_count = 2 THEN
      RETURN;
    END IF;
    RAISE EXCEPTION
      'Current external processing book superseded v2 without complete packaging rules';
  END IF;

  SELECT *
  INTO source_book
  FROM "CustomerPriceBook"
  WHERE "id" = current_book_id
  FOR UPDATE;

  SELECT COUNT(*)
  INTO target_rule_count
  FROM "CustomerPriceRule" rule
  WHERE rule."priceBookId" = source_book."id"
    AND rule."isActive" = TRUE
    AND rule."triggerCondition"->>'target' = 'PACKAGING_GROUP';

  IF target_rule_count <> 0 THEN
    RAISE EXCEPTION
      'Processing-rule v2 has partial packaging rules; automatic repair is unsafe';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM "CustomerChargeCategory"
    WHERE "code" = 'PACKING'::CITEXT
      AND "isActive" = TRUE
  ) THEN
    RAISE EXCEPTION 'Active PACKING charge category is required';
  END IF;

  SELECT COALESCE(MAX(book."version"), 0) + 1
  INTO next_version
  FROM "CustomerPriceBook" book
  WHERE book."code" = source_book."code";

  SELECT COUNT(*)
  INTO source_rule_count
  FROM "CustomerPriceRule"
  WHERE "priceBookId" = source_book."id";

  next_notes := (
    CASE
      WHEN jsonb_typeof(source_book."notes") = 'object'
        THEN source_book."notes"
      ELSE '{}'::JSONB
    END
    - 'workflow'
    - 'ruleSetSha256'
  ) || jsonb_build_object(
    'summary', '当前结构化规则：款式加工费与包装组入袋费同版本生效。',
    'constants', (
      CASE
        WHEN jsonb_typeof(source_book."notes"->'constants') = 'object'
          THEN source_book."notes"->'constants'
        ELSE '{}'::JSONB
      END
    ) || jsonb_build_object(
      'singleStyleBagFee', 0.1,
      'mixedStyleBagFee', 0.2
    ),
    'supersedesPriceBookId', source_book."id",
    'workflow', jsonb_build_object(
      'status', 'SYSTEM_RELEASE',
      'basedOn', jsonb_build_object(
        'id', source_book."id",
        'code', source_book."code"::TEXT,
        'version', source_book."version"
      ),
      'createdBy', 'SYSTEM_MIGRATION',
      'createdAt', to_char(
        released_at,
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      ),
      'changeReason', '补齐加工费规则版本中的普通入袋 0.1 元/袋与混装 0.2 元/袋。',
      'publishedBy', 'SYSTEM_MIGRATION',
      'publishedAt', to_char(
        released_at,
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      ),
      'publishNote', '由数据库迁移发布；不伪造 ruleSetSha256。'
    )
  );

  -- Close the old half-open interval before opening its complete successor.
  UPDATE "CustomerPriceBook"
  SET
    "effectiveTo" = released_at,
    "updatedAt" = released_at
  WHERE "id" = source_book."id";

  INSERT INTO "CustomerPriceBook" (
    "id", "code", "name", "settlementType", "purpose", "version",
    "currency", "sourceName", "sourceSha256", "effectiveFrom",
    "effectiveTo", "isActive", "notes", "createdAt", "updatedAt"
  ) VALUES (
    next_book_id,
    source_book."code",
    source_book."name",
    source_book."settlementType",
    source_book."purpose",
    next_version,
    source_book."currency",
    source_book."sourceName",
    source_book."sourceSha256",
    released_at,
    source_book."effectiveTo",
    TRUE,
    next_notes,
    released_at,
    released_at
  );

  INSERT INTO "CustomerPriceRule" (
    "id", "priceBookId", "categoryId", "productId", "code", "name",
    "kind", "calculationType", "amount", "includedUnits",
    "incrementUnits", "incrementAmount", "minQty", "maxQty",
    "triggerCondition", "exclusiveGroup", "priority", "sourceSheet",
    "sourceRange", "sourceName", "sourceSha256", "note",
    "blocksAutomaticQuote", "isActive", "createdAt", "updatedAt"
  )
  SELECT
    'cpr_packfix_' || md5(next_book_id || ':' || rule."id"),
    next_book_id,
    rule."categoryId",
    rule."productId",
    rule."code",
    rule."name",
    rule."kind",
    rule."calculationType",
    rule."amount",
    rule."includedUnits",
    rule."incrementUnits",
    rule."incrementAmount",
    rule."minQty",
    rule."maxQty",
    rule."triggerCondition",
    rule."exclusiveGroup",
    rule."priority",
    rule."sourceSheet",
    rule."sourceRange",
    rule."sourceName",
    rule."sourceSha256",
    rule."note",
    rule."blocksAutomaticQuote",
    rule."isActive",
    released_at,
    released_at
  FROM "CustomerPriceRule" rule
  WHERE rule."priceBookId" = source_book."id";

  INSERT INTO "CustomerPriceRule" (
    "id", "priceBookId", "categoryId", "productId", "code", "name",
    "kind", "calculationType", "amount", "includedUnits",
    "incrementUnits", "incrementAmount", "minQty", "maxQty",
    "triggerCondition", "exclusiveGroup", "priority", "sourceSheet",
    "sourceRange", "sourceName", "sourceSha256", "note",
    "blocksAutomaticQuote", "isActive", "createdAt", "updatedAt"
  )
  SELECT
    seed."id",
    next_book_id,
    category."id",
    NULL,
    seed."code"::CITEXT,
    seed."name",
    'ADD_ON'::"CustomerPriceRuleKind",
    'PER_BAG'::"CustomerPriceCalculationType",
    seed."amount"::DECIMAL(14, 4),
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    seed."triggerCondition"::JSONB,
    'PACKAGING_GROUP_MODE',
    300,
    '加工费计费规则.md',
    '§4',
    '加工费计费规则.md',
    '3596993e283d1d06f01dd7048b6ccf2f1c0e4b27394541e004a37419c856d817',
    seed."note",
    FALSE,
    TRUE,
    released_at,
    released_at
  FROM (
    VALUES
      (
        'cpr_v2_packaging_single_style',
        'PACKAGING_SINGLE_STYLE_PER_BAG',
        '普通入袋',
        0.1000,
        '{"schemaVersion":1,"target":"PACKAGING_GROUP","packagingModes":["SINGLE_STYLE"]}',
        '单款装包装组按实际袋数 × 0.1 元/袋。'
      ),
      (
        'cpr_v2_packaging_mixed_style',
        'PACKAGING_MIXED_STYLE_PER_BAG',
        '混装入袋',
        0.2000,
        '{"schemaVersion":1,"target":"PACKAGING_GROUP","packagingModes":["MIXED_STYLE"]}',
        '混装包装组按实际袋数 × 0.2 元/袋。'
      )
  ) AS seed(
    "id", "code", "name", "amount", "triggerCondition", "note"
  )
  CROSS JOIN "CustomerChargeCategory" category
  WHERE category."code" = 'PACKING'::CITEXT
    AND category."isActive" = TRUE;

  SELECT COUNT(*)
  INTO released_rule_count
  FROM "CustomerPriceRule"
  WHERE "priceBookId" = next_book_id;

  SELECT COUNT(*)
  INTO target_rule_count
  FROM "CustomerPriceRule" rule
  WHERE rule."priceBookId" = next_book_id
    AND rule."isActive" = TRUE
    AND rule."triggerCondition"->>'target' = 'PACKAGING_GROUP';

  SELECT COUNT(*)
  INTO valid_packaging_count
  FROM "CustomerPriceRule" rule
  JOIN "CustomerChargeCategory" category
    ON category."id" = rule."categoryId"
  WHERE rule."priceBookId" = next_book_id
    AND rule."isActive" = TRUE
    AND category."isActive" = TRUE
    AND category."code" = 'PACKING'::CITEXT
    AND rule."kind" = 'ADD_ON'::"CustomerPriceRuleKind"
    AND rule."calculationType" = 'PER_BAG'::"CustomerPriceCalculationType"
    AND rule."productId" IS NULL
    AND rule."minQty" IS NULL
    AND rule."maxQty" IS NULL
    AND rule."exclusiveGroup" = 'PACKAGING_GROUP_MODE'
    AND rule."blocksAutomaticQuote" = FALSE
    AND (
      (
        rule."code" = 'PACKAGING_SINGLE_STYLE_PER_BAG'::CITEXT
        AND rule."amount" = 0.1000
        AND rule."triggerCondition" @>
          '{"schemaVersion":1,"target":"PACKAGING_GROUP","packagingModes":["SINGLE_STYLE"]}'::JSONB
      )
      OR
      (
        rule."code" = 'PACKAGING_MIXED_STYLE_PER_BAG'::CITEXT
        AND rule."amount" = 0.2000
        AND rule."triggerCondition" @>
          '{"schemaVersion":1,"target":"PACKAGING_GROUP","packagingModes":["MIXED_STYLE"]}'::JSONB
      )
    );

  IF released_rule_count <> source_rule_count + 2 THEN
    RAISE EXCEPTION
      'Packaging-rule repair cloned % rules but released %',
      source_rule_count,
      released_rule_count;
  END IF;

  IF target_rule_count <> 2 OR valid_packaging_count <> 2 THEN
    RAISE EXCEPTION
      'Packaging-rule repair did not release exactly two valid rules';
  END IF;
END
$$;

COMMIT;
