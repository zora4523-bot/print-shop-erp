BEGIN;

SELECT pg_advisory_xact_lock(
  hashtext('print-shop-erp:price-rule-snapshot:v1')
);

LOCK TABLE
  "CustomerPriceBook",
  "CustomerPriceRule"
IN SHARE ROW EXCLUSIVE MODE;

CREATE TEMP TABLE "_ExternalLogisticsWeightV3Clock" ON COMMIT DROP AS
SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::TIMESTAMP(3) AS "releasedAt";

-- Snapshot the complete active LOGISTICS timeline from the release instant
-- forward. Every segment must receive the authoritative weight policy: leaving
-- an already-published future segment untouched would reintroduce its previous
-- policy as soon as that segment became current.
CREATE TEMP TABLE "_ExternalLogisticsWeightV3Source" ON COMMIT DROP AS
WITH candidates AS (
  SELECT
    book.*,
    book."effectiveFrom" AS "sourceEffectiveFrom",
    book."effectiveTo" AS "sourceEffectiveTo",
    book."effectiveFrom" <= clock."releasedAt" AS "isCurrent"
  FROM "CustomerPriceBook" book
  CROSS JOIN "_ExternalLogisticsWeightV3Clock" clock
  WHERE book."settlementType" = 'EXTERNAL_SALES'::"OrderSettlementType"
    AND book."purpose" = 'LOGISTICS'::"CustomerPriceBookPurpose"
    AND book."isActive" = TRUE
    AND (book."effectiveTo" IS NULL OR book."effectiveTo" > clock."releasedAt")
), ranked AS (
  SELECT
    candidate.*,
    ROW_NUMBER() OVER (
      ORDER BY candidate."sourceEffectiveFrom", candidate."id"
    ) AS "successorOrdinal"
  FROM candidates candidate
)
SELECT
  ranked.*,
  CASE
    WHEN ranked."isCurrent"
      THEN 'cpb_external_logistics_weight_policy_v3'
    ELSE 'cpb_external_logistics_weight_v3_' || substr(
      md5(ranked."id"),
      1,
      20
    )
  END AS "targetId",
  (
    (
      SELECT COALESCE(MAX(book."version"), 0)
      FROM "CustomerPriceBook" book
      WHERE book."code" = 'EXTERNAL_SALES_LOGISTICS_RULES'::CITEXT
    ) + ranked."successorOrdinal"
  )::INTEGER AS "targetVersion"
FROM ranked;

DO $$
BEGIN
  IF (
    SELECT COUNT(*)
    FROM "_ExternalLogisticsWeightV3Source"
    WHERE "isCurrent"
  ) <> 1 THEN
    RAISE EXCEPTION
      'External logistics weight policy v3 requires exactly one current source book';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM "_ExternalLogisticsWeightV3Source" source
    JOIN "CustomerPriceBook" existing
      ON existing."id" = source."targetId"
  ) THEN
    RAISE EXCEPTION 'External logistics weight policy v3 successor already exists';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM "_ExternalLogisticsWeightV3Source" source
    WHERE NOT EXISTS (
      SELECT 1
      FROM "CustomerPriceRule" rule
      WHERE rule."priceBookId" = source."id"
    )
  ) THEN
    RAISE EXCEPTION 'External logistics weight policy v3 source has no rules';
  END IF;
END
$$;

-- The exclusion constraint is immediate. Deactivate every future predecessor
-- before inserting its same-window successor. Its dates, notes, rules and audit
-- timestamps remain untouched, so the original published evidence stays
-- available without being eligible for future selection.
UPDATE "CustomerPriceBook" book
SET "isActive" = FALSE
FROM "_ExternalLogisticsWeightV3Source" source
WHERE book."id" = source."id"
  AND NOT source."isCurrent";

-- The current predecessor remains an immutable historical version. Only close
-- its half-open interval at the release instant.
UPDATE "CustomerPriceBook" book
SET
  "effectiveTo" = clock."releasedAt",
  "updatedAt" = clock."releasedAt"
FROM "_ExternalLogisticsWeightV3Clock" clock,
  "_ExternalLogisticsWeightV3Source" source
WHERE book."id" = source."id"
  AND source."isCurrent";

INSERT INTO "CustomerPriceBook" (
  "id", "code", "name", "settlementType", "purpose", "version",
  "currency", "sourceName", "sourceSha256", "effectiveFrom",
  "effectiveTo", "isActive", "notes", "createdAt", "updatedAt"
)
SELECT
  source."targetId",
  'EXTERNAL_SALES_LOGISTICS_RULES',
  source."name",
  source."settlementType",
  source."purpose",
  source."targetVersion",
  source."currency",
  source."sourceName",
  source."sourceSha256",
  CASE
    WHEN source."isCurrent" THEN clock."releasedAt"
    ELSE source."sourceEffectiveFrom"
  END,
  source."sourceEffectiveTo",
  TRUE,
  (
    (
      CASE
        WHEN jsonb_typeof(source."notes") = 'object'
          THEN source."notes"
        ELSE '{}'::JSONB
      END
    ) - 'ruleVersion' - 'shipping' - 'workflow'
  ) || jsonb_build_object(
    'ruleVersion', '2026-08-27-logistics-weight-v3',
    'supersedesPriceBookId', source."id",
    'shipping', (
      (
        CASE
          WHEN jsonb_typeof(source."notes"->'shipping') = 'object'
            THEN source."notes"->'shipping'
          ELSE '{}'::JSONB
        END
      )
        - 'billableWeightInput'
        - 'weightResolutionOrder'
        - 'ztoMaximumOrderQuantity'
        - 'maxOrderQuantity'
        - 'billableWeightRounding'
        - 'minimumBillableWeightKg'
        - 'gramsPerItemByPaperWeightGsm'
        - 'tenThousandEnvelopeGramsPerItem'
        - 'source'
    ) || jsonb_build_object(
      'billableWeightInput', 'SERVER_ESTIMATE_WITH_ACTUAL_OVERRIDE',
      'weightResolutionOrder', jsonb_build_array(
        'ACTUAL_FULFILLMENT_WEIGHT',
        'SERVER_ESTIMATE'
      ),
      'maxOrderQuantity', 2000,
      'billableWeightRounding', 'CEIL_KG',
      'minimumBillableWeightKg', 1,
      'gramsPerItemByPaperWeightGsm', jsonb_build_object(
        '120', 4.5,
        '150', 6,
        '160', 6,
        '180', 6.75,
        '200', 8,
        '230', 10
      ),
      'tenThousandEnvelopeGramsPerItem', 10,
      'source', jsonb_build_object(
        'fileName', '加工费计费规则.md',
        'sha256',
          '3596993e283d1d06f01dd7048b6ccf2f1c0e4b27394541e004a37419c856d817',
        'section', '§6'
      )
    ),
    'workflow', (
      CASE
        WHEN jsonb_typeof(source."notes"->'workflow') = 'object'
          THEN source."notes"->'workflow'
        ELSE '{}'::JSONB
      END
    ) || jsonb_build_object(
      'status', 'SYSTEM_RELEASE',
      'basedOn', jsonb_build_object(
        'id', source."id",
        'code', source."code"::TEXT,
        'version', source."version"
      ),
      'createdBy', 'SYSTEM_MIGRATION',
      'createdAt', to_char(
        clock."releasedAt",
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      ),
      'publishedBy', 'SYSTEM_MIGRATION',
      'publishedAt', to_char(
        clock."releasedAt",
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      ),
      'changeReason',
        '按订单款式数量和纸张克重服务端估算计费重量，履约实际重量优先。'
    )
  ),
  clock."releasedAt",
  clock."releasedAt"
FROM "_ExternalLogisticsWeightV3Source" source
CROSS JOIN "_ExternalLogisticsWeightV3Clock" clock;

-- Clone every rule from every current/future source segment, including inactive
-- rows. Carrier and carton rates, matchers, activation state and audited
-- per-rule provenance remain byte-for-byte equivalent inside each successor.
INSERT INTO "CustomerPriceRule" (
  "id", "priceBookId", "categoryId", "productId", "code", "name",
  "kind", "calculationType", "amount", "includedUnits",
  "incrementUnits", "incrementAmount", "minQty", "maxQty",
  "triggerCondition", "exclusiveGroup", "priority", "sourceSheet",
  "sourceRange", "sourceName", "sourceSha256", "note",
  "blocksAutomaticQuote", "isActive", "createdAt", "updatedAt"
)
SELECT
  'cpr_logistics_weight_v3_' || substr(
    md5(source."targetId" || ':' || rule."id"),
    1,
    20
  ),
  source."targetId",
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
  clock."releasedAt",
  clock."releasedAt"
FROM "CustomerPriceRule" rule
JOIN "_ExternalLogisticsWeightV3Source" source
  ON source."id" = rule."priceBookId"
CROSS JOIN "_ExternalLogisticsWeightV3Clock" clock;

DO $$
BEGIN
  IF (
    SELECT COUNT(*)
    FROM "CustomerPriceBook" target
    JOIN "_ExternalLogisticsWeightV3Source" source
      ON source."targetId" = target."id"
  ) <> (
    SELECT COUNT(*) FROM "_ExternalLogisticsWeightV3Source"
  ) THEN
    RAISE EXCEPTION 'External logistics v3 did not create every successor';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "_ExternalLogisticsWeightV3Source" source
    WHERE (
      SELECT COUNT(*)
      FROM "CustomerPriceRule" target_rule
      WHERE target_rule."priceBookId" = source."targetId"
    ) <> (
      SELECT COUNT(*)
      FROM "CustomerPriceRule" source_rule
      WHERE source_rule."priceBookId" = source."id"
    )
  ) THEN
    RAISE EXCEPTION 'External logistics v3 did not preserve every source rule';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "_ExternalLogisticsWeightV3Source" source
    JOIN "CustomerPriceBook" predecessor ON predecessor."id" = source."id"
    WHERE predecessor."sourceName" IS DISTINCT FROM source."sourceName"
      OR predecessor."sourceSha256" IS DISTINCT FROM source."sourceSha256"
      OR predecessor."notes" IS DISTINCT FROM source."notes"
      OR predecessor."effectiveFrom" IS DISTINCT FROM source."sourceEffectiveFrom"
      OR (
        NOT source."isCurrent"
        AND predecessor."effectiveTo" IS DISTINCT FROM source."sourceEffectiveTo"
      )
      OR (
        NOT source."isCurrent"
        AND predecessor."updatedAt" IS DISTINCT FROM source."updatedAt"
      )
  ) THEN
    RAISE EXCEPTION 'External logistics v3 rewrote predecessor evidence';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "CustomerPriceBook" book
    JOIN "_ExternalLogisticsWeightV3Source" source
      ON source."targetId" = book."id"
    CROSS JOIN "_ExternalLogisticsWeightV3Clock" clock
    WHERE book."code" IS DISTINCT FROM
        'EXTERNAL_SALES_LOGISTICS_RULES'::CITEXT
      OR book."version" IS DISTINCT FROM source."targetVersion"
      OR book."effectiveFrom" IS DISTINCT FROM CASE
        WHEN source."isCurrent" THEN clock."releasedAt"
        ELSE source."sourceEffectiveFrom"
      END
      OR book."effectiveTo" IS DISTINCT FROM source."sourceEffectiveTo"
      OR book."isActive" IS DISTINCT FROM TRUE
      OR book."sourceName" IS DISTINCT FROM source."sourceName"
      OR book."sourceSha256" IS DISTINCT FROM source."sourceSha256"
      OR book."notes"->>'ruleVersion'
        IS DISTINCT FROM '2026-08-27-logistics-weight-v3'
      OR book."notes"->>'supersedesPriceBookId'
        IS DISTINCT FROM source."id"
      OR book."notes"->'shipping'->>'billableWeightInput'
        IS DISTINCT FROM 'SERVER_ESTIMATE_WITH_ACTUAL_OVERRIDE'
      OR book."notes"->'shipping'->'weightResolutionOrder'
        IS DISTINCT FROM jsonb_build_array(
          'ACTUAL_FULFILLMENT_WEIGHT',
          'SERVER_ESTIMATE'
        )
      OR book."notes"->'shipping'->>'maxOrderQuantity'
        IS DISTINCT FROM '2000'
      OR book."notes"->'shipping'->>'billableWeightRounding'
        IS DISTINCT FROM 'CEIL_KG'
      OR book."notes"->'shipping'->>'minimumBillableWeightKg'
        IS DISTINCT FROM '1'
      OR book."notes"->'shipping'->'gramsPerItemByPaperWeightGsm'
        IS DISTINCT FROM jsonb_build_object(
          '120', 4.5,
          '150', 6,
          '160', 6,
          '180', 6.75,
          '200', 8,
          '230', 10
        )
      OR book."notes"->'shipping'->>'tenThousandEnvelopeGramsPerItem'
        IS DISTINCT FROM '10'
      OR book."notes"->'shipping'->'source'->>'fileName'
        IS DISTINCT FROM '加工费计费规则.md'
      OR book."notes"->'shipping'->'source'->>'section'
        IS DISTINCT FROM '§6'
      OR book."notes"->'shipping'->'source'->>'sha256'
        IS DISTINCT FROM
          '3596993e283d1d06f01dd7048b6ccf2f1c0e4b27394541e004a37419c856d817'
  ) THEN
    RAISE EXCEPTION 'External logistics v3 policy snapshot is incomplete';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "CustomerPriceBook" left_book
    JOIN "CustomerPriceBook" right_book
      ON left_book."id" < right_book."id"
     AND left_book."settlementType" = right_book."settlementType"
     AND left_book."purpose" = right_book."purpose"
     AND left_book."isActive" = TRUE
     AND right_book."isActive" = TRUE
     AND tsrange(
       left_book."effectiveFrom",
       COALESCE(left_book."effectiveTo", 'infinity'::TIMESTAMP),
       '[)'
     ) && tsrange(
       right_book."effectiveFrom",
       COALESCE(right_book."effectiveTo", 'infinity'::TIMESTAMP),
       '[)'
     )
    WHERE left_book."settlementType" =
        'EXTERNAL_SALES'::"OrderSettlementType"
      AND left_book."purpose" = 'LOGISTICS'::"CustomerPriceBookPurpose"
  ) THEN
    RAISE EXCEPTION 'External logistics v3 created an overlapping timeline';
  END IF;
END
$$;

COMMIT;
