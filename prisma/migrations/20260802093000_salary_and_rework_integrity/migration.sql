BEGIN;

-- The application now deliberately supports only one generation of rework.
-- Stop the upgrade instead of silently keeping historical grandchildren whose
-- production cost would be omitted by the one-level rework accounting model.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "Order" child
    JOIN "Order" parent ON parent."id" = child."sourceOrderId"
    WHERE child."kind" = 'REWORK'::"OrderKind"
      AND parent."kind" = 'REWORK'::"OrderKind"
  ) THEN
    RAISE EXCEPTION
      'Nested rework orders exist; flatten their sourceOrderId lineage before applying this migration';
  END IF;
END $$;

-- Existing WINDMILL personal rules predate the inclusive small-order and
-- large-order setup-fee fields. Preserve valid explicit values, but repair
-- both missing keys and JSON null so the runtime never receives a null where
-- the compatibility defaults are required.
UPDATE "WorkerMachineSalaryRule"
SET "ruleValue" = jsonb_set(
  jsonb_set(
    jsonb_build_object(
      'smallOrderInclusive', true,
      'largeOrderSetupFee', 10
    ) || "ruleValue",
    '{smallOrderInclusive}',
    CASE
      WHEN "ruleValue"->'smallOrderInclusive' IS NULL
        OR "ruleValue"->'smallOrderInclusive' = 'null'::jsonb
      THEN 'true'::jsonb
      ELSE "ruleValue"->'smallOrderInclusive'
    END,
    true
  ),
  '{largeOrderSetupFee}',
  CASE
    WHEN "ruleValue"->'largeOrderSetupFee' IS NULL
      OR "ruleValue"->'largeOrderSetupFee' = 'null'::jsonb
    THEN '10'::jsonb
    ELSE "ruleValue"->'largeOrderSetupFee'
  END,
  true
)
WHERE "machineType" = 'WINDMILL'::"MachineType"
  AND jsonb_typeof("ruleValue") = 'object'
  AND (
    NOT ("ruleValue" ? 'smallOrderInclusive')
    OR NOT ("ruleValue" ? 'largeOrderSetupFee')
    OR "ruleValue"->'smallOrderInclusive' = 'null'::jsonb
    OR "ruleValue"->'largeOrderSetupFee' = 'null'::jsonb
  );

-- Apply the same compatibility defaults to every historical global WINDMILL
-- version. A past version may still be needed to reproduce an older task.
UPDATE "SalaryRule"
SET "ruleValue" = jsonb_set(
  jsonb_set(
    jsonb_build_object(
      'smallOrderInclusive', true,
      'largeOrderSetupFee', 10
    ) || "ruleValue",
    '{smallOrderInclusive}',
    CASE
      WHEN "ruleValue"->'smallOrderInclusive' IS NULL
        OR "ruleValue"->'smallOrderInclusive' = 'null'::jsonb
      THEN 'true'::jsonb
      ELSE "ruleValue"->'smallOrderInclusive'
    END,
    true
  ),
  '{largeOrderSetupFee}',
  CASE
    WHEN "ruleValue"->'largeOrderSetupFee' IS NULL
      OR "ruleValue"->'largeOrderSetupFee' = 'null'::jsonb
    THEN '10'::jsonb
    ELSE "ruleValue"->'largeOrderSetupFee'
  END,
  true
)
WHERE "ruleType" = 'WORKER_MACHINE'::"SalaryRuleType"
  AND "ruleKey" = 'WINDMILL'
  AND jsonb_typeof("ruleValue") = 'object'
  AND (
    NOT ("ruleValue" ? 'smallOrderInclusive')
    OR NOT ("ruleValue" ? 'largeOrderSetupFee')
    OR "ruleValue"->'smallOrderInclusive' = 'null'::jsonb
    OR "ruleValue"->'largeOrderSetupFee' = 'null'::jsonb
  );

-- A malformed historical rule would otherwise be discovered only when a
-- worker reports production. Validate every global and personal version now;
-- historical versions remain part of the immutable salary audit trail.
DO $$
BEGIN
  IF EXISTS (
    WITH machine_rules AS (
      SELECT 'global' AS source, "id", "ruleValue" AS value
      FROM "SalaryRule"
      WHERE "ruleType" = 'WORKER_MACHINE'::"SalaryRuleType"
      UNION ALL
      SELECT 'personal' AS source, "id", "ruleValue" AS value
      FROM "WorkerMachineSalaryRule"
    )
    SELECT 1
    FROM machine_rules
    WHERE COALESCE(jsonb_typeof(value) <> 'object', true)
       OR NOT (value ?& ARRAY[
         'dailyBase',
         'pieceRate',
         'boardRate',
         'smallOrderThreshold',
         'smallOrderFlatPrice',
         'multiplierFactors'
       ])
       OR COALESCE(jsonb_typeof(value->'multiplierFactors') <> 'array', true)
       OR (
         value ? 'smallOrderInclusive'
         AND COALESCE(jsonb_typeof(value->'smallOrderInclusive') <> 'boolean', true)
       )
  ) THEN
    RAISE EXCEPTION
      'Malformed WORKER_MACHINE salary rule JSON; repair the named rule before migration';
  END IF;

  IF EXISTS (
    WITH machine_rules AS (
      SELECT "id", "ruleValue" AS value
      FROM "SalaryRule"
      WHERE "ruleType" = 'WORKER_MACHINE'::"SalaryRuleType"
      UNION ALL
      SELECT "id", "ruleValue" AS value
      FROM "WorkerMachineSalaryRule"
    )
    SELECT 1
    FROM machine_rules
    WHERE COALESCE(value->>'dailyBase', '')
            !~ '^[0-9]+([.][0-9]{1,2})?$'
       OR COALESCE(value->>'pieceRate', '')
            !~ '^[0-9]+([.][0-9]{1,4})?$'
       OR COALESCE(value->>'boardRate', '')
            !~ '^[0-9]+([.][0-9]{1,4})?$'
       OR (
         value->>'smallOrderThreshold' IS NOT NULL
         AND value->>'smallOrderThreshold' !~ '^[0-9]{1,9}$'
       )
       OR (
         value->>'smallOrderThreshold' IS NOT NULL
         AND value->>'smallOrderFlatPrice' IS NULL
       )
       OR (
         value->>'smallOrderFlatPrice' IS NOT NULL
         AND value->>'smallOrderFlatPrice'
               !~ '^[0-9]+([.][0-9]{1,2})?$'
       )
       OR (
         value->>'largeOrderSetupFee' IS NOT NULL
         AND value->>'largeOrderSetupFee'
               !~ '^[0-9]+([.][0-9]{1,2})?$'
       )
       OR EXISTS (
         SELECT 1
         FROM jsonb_array_elements_text(value->'multiplierFactors') factor(name)
         WHERE factor.name NOT IN ('DOUBLE_SIDED', 'DOUBLE_COLOR')
       )
  ) THEN
    RAISE EXCEPTION
      'WORKER_MACHINE salary rule contains invalid amounts, threshold, or multiplier factors';
  END IF;

  IF EXISTS (
    WITH machine_rules AS (
      SELECT "id", "ruleValue" AS value
      FROM "SalaryRule"
      WHERE "ruleType" = 'WORKER_MACHINE'::"SalaryRuleType"
      UNION ALL
      SELECT "id", "ruleValue" AS value
      FROM "WorkerMachineSalaryRule"
    )
    SELECT 1
    FROM machine_rules
    WHERE (value->>'dailyBase')::numeric > 99999999.99
       OR COALESCE((value->>'smallOrderFlatPrice')::numeric, 0)
            > 99999999.99
       OR ROUND((
         (value->>'pieceRate')::numeric * 30000000
         * CASE WHEN value->'multiplierFactors' ? 'DOUBLE_SIDED' THEN 2 ELSE 1 END
         * CASE WHEN value->'multiplierFactors' ? 'DOUBLE_COLOR' THEN 2 ELSE 1 END
         + (value->>'boardRate')::numeric
         * CASE WHEN value->'multiplierFactors' ? 'DOUBLE_SIDED' THEN 2 ELSE 1 END
         * CASE WHEN value->'multiplierFactors' ? 'DOUBLE_COLOR' THEN 2 ELSE 1 END
         + COALESCE((value->>'largeOrderSetupFee')::numeric, 0)
       ), 2) > 99999999.99
  ) THEN
    RAISE EXCEPTION
      'WORKER_MACHINE salary rule can overflow Decimal(10,2) at the supported task quantity';
  END IF;
END $$;

COMMIT;
