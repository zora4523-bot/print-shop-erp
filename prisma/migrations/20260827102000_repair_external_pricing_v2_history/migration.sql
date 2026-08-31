BEGIN;

SELECT pg_advisory_xact_lock(
  hashtext('print-shop-erp:price-rule-snapshot:v1')
);

LOCK TABLE
  "CustomerPriceBook",
  "CustomerPriceRule"
IN SHARE ROW EXCLUSIVE MODE;

-- The v2 system releases used one clock value both to create the replacement
-- book and to deactivate every already-published future segment. Restore only
-- rows carrying that exact migration fingerprint. Human drafts have a DRAFT
-- workflow and are never candidates. The conflict guard keeps the repair safe
-- if an administrator published another timeline after the faulty migration.
CREATE TEMP TABLE "_ExternalPricingV2ScheduledRepair" ON COMMIT DROP AS
SELECT
  current_replacement."id" AS "replacementId",
  release_marker."id" AS "releaseMarkerId",
  scheduled."id" AS "scheduledId",
  scheduled."effectiveFrom" AS "scheduledFrom"
FROM "CustomerPriceBook" release_marker
JOIN "CustomerPriceBook" current_replacement
  ON current_replacement."settlementType" = release_marker."settlementType"
 AND current_replacement."purpose" = release_marker."purpose"
 AND current_replacement."isActive" = TRUE
 AND current_replacement."effectiveFrom" <=
   (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::TIMESTAMP(3)
 AND (
   current_replacement."effectiveTo" IS NULL
   OR current_replacement."effectiveTo" >
     (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::TIMESTAMP(3)
 )
 AND (
   current_replacement."id" = release_marker."id"
   OR (
     release_marker."id" = 'cpb_external_processing_rule_v2'
     AND current_replacement."id" =
       'cpb_external_processing_rule_v2_packaging'
   )
 )
JOIN "CustomerPriceBook" scheduled
  ON scheduled."settlementType" = release_marker."settlementType"
 AND scheduled."purpose" = release_marker."purpose"
 AND scheduled."id" <> release_marker."id"
WHERE release_marker."id" IN (
    'cpb_external_processing_rule_v2',
    'cpb_external_logistics_rule_v2'
  )
  AND release_marker."settlementType" =
    'EXTERNAL_SALES'::"OrderSettlementType"
  AND scheduled."isActive" = FALSE
  AND scheduled."effectiveFrom" > release_marker."effectiveFrom"
  -- A repair may run after another system successor has already become
  -- current. Never let an old/missed segment shorten that successor before
  -- its own start, and never revive a segment whose window has already ended.
  AND scheduled."effectiveFrom" > current_replacement."effectiveFrom"
  AND scheduled."effectiveFrom" >
    (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::TIMESTAMP(3)
  AND (
    scheduled."effectiveTo" IS NULL
    OR scheduled."effectiveTo" >
      (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::TIMESTAMP(3)
  )
  AND scheduled."updatedAt" = release_marker."createdAt"
  AND COALESCE(scheduled."notes"->'workflow'->>'status', '') <> 'DRAFT'
  AND NOT EXISTS (
    SELECT 1
    FROM "CustomerPriceBook" conflict
    WHERE conflict."settlementType" = scheduled."settlementType"
      AND conflict."purpose" = scheduled."purpose"
      AND conflict."isActive" = TRUE
      AND conflict."id" NOT IN (
        current_replacement."id",
        scheduled."id"
      )
      AND (
        conflict."effectiveTo" IS NULL
        OR conflict."effectiveTo" > scheduled."effectiveFrom"
      )
      AND (
        scheduled."effectiveTo" IS NULL
        OR scheduled."effectiveTo" > conflict."effectiveFrom"
      )
  );

-- Close the replacement before reactivating scheduled books. The database's
-- immediate exclusion constraint therefore never observes overlapping active
-- half-open intervals, even inside this transaction.
UPDATE "CustomerPriceBook" replacement
SET
  "effectiveTo" = repair."firstScheduledFrom",
  "updatedAt" = CURRENT_TIMESTAMP AT TIME ZONE 'UTC'
FROM (
  SELECT
    "replacementId",
    MIN("scheduledFrom") AS "firstScheduledFrom"
  FROM "_ExternalPricingV2ScheduledRepair"
  GROUP BY "replacementId"
) repair
WHERE replacement."id" = repair."replacementId"
  AND (
    replacement."effectiveTo" IS NULL
    OR replacement."effectiveTo" > repair."firstScheduledFrom"
  );

UPDATE "CustomerPriceBook" scheduled
SET
  "isActive" = TRUE,
  "updatedAt" = CURRENT_TIMESTAMP AT TIME ZONE 'UTC'
FROM "_ExternalPricingV2ScheduledRepair" repair
WHERE scheduled."id" = repair."scheduledId";

-- The logistics book combines two audited workbooks. Restore its book-level
-- provenance and record that billable weight is an operator-supplied carrier
-- fact. Remove the synthetic per-paper weight/rounding metadata without
-- rewriting historical order charge snapshots.
UPDATE "CustomerPriceBook" book
SET
  "sourceName" = '长昆中通报价表(1).xlsx + 纸箱价格表1(1).xlsx',
  "sourceSha256" =
    '7d3d0b6dddb2ee910046b3bc80f1d7fc8e35aa94dd25d5cf14f23c58a6ab8a69',
  "notes" = (
    COALESCE(book."notes", '{}'::JSONB)
      - 'sources'
      - 'shipping'
  ) || jsonb_build_object(
    'sources', jsonb_build_array(
      jsonb_build_object(
        'fileName', '长昆中通报价表(1).xlsx',
        'sha256', 'a92088a9ba0093afcbb96c6b3b182ab29e4f7d675cacf929c6745987bf4d6060',
        'sheet', '中通',
        'range', 'A1:D29'
      ),
      jsonb_build_object(
        'fileName', '纸箱价格表1(1).xlsx',
        'sha256', '9f0c30333a737ab9d36398b8af2c84ece599317f9df21af5dacb8f365fa5401b',
        'sheet', 'Sheet1',
        'range', 'A1:B6'
      )
    ),
    'shipping', (
      COALESCE(book."notes"->'shipping', '{}'::JSONB)
        - 'billableWeightRounding'
        - 'minimumBillableWeightKg'
        - 'gramsPerItemByPaperWeightGsm'
        - 'tenThousandEnvelopeGramsPerItem'
    ) || jsonb_build_object(
      'billableWeightInput', 'CARRIER_CONFIRMED'
    )
  ),
  "updatedAt" = CURRENT_TIMESTAMP AT TIME ZONE 'UTC'
WHERE book."id" = 'cpb_external_logistics_rule_v2'
  AND book."settlementType" = 'EXTERNAL_SALES'::"OrderSettlementType"
  AND book."purpose" = 'LOGISTICS'::"CustomerPriceBookPurpose";

-- Carton tier amounts came from the carton workbook, not the processing-rule
-- Markdown file. Keep the v2 calculation semantics but repair every rule-level
-- evidence pointer to the audited source named in DECISIONS.md.
UPDATE "CustomerPriceRule" rule
SET
  "sourceSheet" = 'Sheet1',
  "sourceName" = '纸箱价格表1(1).xlsx',
  "sourceSha256" =
    '9f0c30333a737ab9d36398b8af2c84ece599317f9df21af5dacb8f365fa5401b',
  "updatedAt" = CURRENT_TIMESTAMP AT TIME ZONE 'UTC'
FROM "CustomerChargeCategory" category
WHERE rule."priceBookId" = 'cpb_external_logistics_rule_v2'
  AND category."id" = rule."categoryId"
  AND category."code" = 'PACKING_MATERIAL'::CITEXT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "_ExternalPricingV2ScheduledRepair" repair
    JOIN "CustomerPriceBook" scheduled
      ON scheduled."id" = repair."scheduledId"
    JOIN "CustomerPriceBook" replacement
      ON replacement."id" = repair."replacementId"
    WHERE scheduled."isActive" = FALSE
      OR replacement."effectiveTo" IS NULL
      OR replacement."effectiveTo" > scheduled."effectiveFrom"
  ) THEN
    RAISE EXCEPTION
      'External pricing v2 scheduled versions were not restored safely';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "CustomerPriceRule" rule
    JOIN "CustomerChargeCategory" category
      ON category."id" = rule."categoryId"
    WHERE rule."priceBookId" = 'cpb_external_logistics_rule_v2'
      AND category."code" = 'PACKING_MATERIAL'::CITEXT
      AND (
        rule."sourceSheet" IS DISTINCT FROM 'Sheet1'
        OR rule."sourceName" IS DISTINCT FROM '纸箱价格表1(1).xlsx'
        OR rule."sourceSha256" IS DISTINCT FROM
          '9f0c30333a737ab9d36398b8af2c84ece599317f9df21af5dacb8f365fa5401b'
      )
  ) THEN
    RAISE EXCEPTION 'External carton source evidence was not repaired';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "CustomerPriceBook" book
    WHERE book."id" = 'cpb_external_logistics_rule_v2'
      AND (
        book."notes"->'shipping'->>'billableWeightInput'
          IS DISTINCT FROM 'CARRIER_CONFIRMED'
        OR book."notes"->'shipping' ?| ARRAY[
          'billableWeightRounding',
          'minimumBillableWeightKg',
          'gramsPerItemByPaperWeightGsm',
          'tenThousandEnvelopeGramsPerItem'
        ]
      )
  ) THEN
    RAISE EXCEPTION
      'External logistics book still contains synthetic billable-weight facts';
  END IF;
END
$$;

COMMIT;
