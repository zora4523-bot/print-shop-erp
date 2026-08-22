BEGIN;

-- Freeze every table read or rewritten by the financial preflights. Keeping a
-- fixed lock order prevents a concurrent legacy writer from invalidating a
-- successful check before the migration installs its constraints.
LOCK TABLE
  "Product",
  "PriceTier",
  "PriceAdjustment",
  "Order",
  "OrderItem",
  "Bill",
  "BillItem",
  "BillPayment",
  "User"
IN SHARE ROW EXCLUSIVE MODE;

-- Quote inputs predate the stricter application validators. Fail with row IDs
-- before changing any financial table, then install equivalent CHECKs below.
-- Silently clamping a negative price or reversing an invalid window would
-- change customer charges and is therefore not migration-safe.
DO $$
DECLARE
  violation RECORD;
  invalid_count INTEGER := 0;
  invalid_details TEXT := '';
BEGIN
  FOR violation IN
    SELECT
      'Product'::TEXT AS entity,
      product."id" AS entity_id,
      concat_ws(', ',
        CASE
          WHEN product."baseUnitPrice" IS NOT NULL
           AND (product."baseUnitPrice" < 0 OR product."baseUnitPrice" > 999999.9999)
          THEN 'baseUnitPrice must be between 0 and 999999.9999'
        END,
        CASE
          WHEN product."minOrderQty" IS NOT NULL
           AND (product."minOrderQty" < 1 OR product."minOrderQty" > 9999999)
          THEN 'minOrderQty must be between 1 and 9999999'
        END
      ) AS reason
    FROM "Product" AS product
    WHERE (
      product."baseUnitPrice" IS NOT NULL
      AND (product."baseUnitPrice" < 0 OR product."baseUnitPrice" > 999999.9999)
    ) OR (
      product."minOrderQty" IS NOT NULL
      AND (product."minOrderQty" < 1 OR product."minOrderQty" > 9999999)
    )

    UNION ALL

    SELECT
      'PriceTier'::TEXT AS entity,
      tier."id" AS entity_id,
      concat_ws(', ',
        CASE
          WHEN tier."minQty" < 1 OR tier."minQty" > 9999999
          THEN 'minQty must be between 1 and 9999999'
        END,
        CASE
          WHEN tier."unitPrice" < 0 OR tier."unitPrice" > 999999.9999
          THEN 'unitPrice must be between 0 and 999999.9999'
        END,
        CASE
          WHEN tier."effectiveTo" IS NOT NULL
           AND tier."effectiveTo" <= tier."effectiveFrom"
          THEN 'effectiveTo must be later than effectiveFrom'
        END
      ) AS reason
    FROM "PriceTier" AS tier
    WHERE tier."minQty" < 1
       OR tier."minQty" > 9999999
       OR tier."unitPrice" < 0
       OR tier."unitPrice" > 999999.9999
       OR (
         tier."effectiveTo" IS NOT NULL
         AND tier."effectiveTo" <= tier."effectiveFrom"
       )

    UNION ALL

    SELECT
      'PriceAdjustment'::TEXT AS entity,
      adjustment."id" AS entity_id,
      'amount must be between 0 and 999999.9999'::TEXT AS reason
    FROM "PriceAdjustment" AS adjustment
    WHERE adjustment."amount" < 0
       OR adjustment."amount" > 999999.9999

    ORDER BY entity, entity_id
  LOOP
    invalid_count := invalid_count + 1;
    IF invalid_count <= 20 THEN
      invalid_details := invalid_details
        || CASE WHEN invalid_details = '' THEN '' ELSE '; ' END
        || format('%s %s: %s', violation.entity, violation.entity_id, violation.reason);
    END IF;
  END LOOP;

  IF invalid_count > 0 THEN
    IF invalid_count > 20 THEN
      invalid_details := invalid_details
        || format('; ... and %s more', invalid_count - 20);
    END IF;
    RAISE EXCEPTION USING
      ERRCODE = 'check_violation',
      MESSAGE = format(
        'Pricing migration blocked: %s Product/PriceTier/PriceAdjustment row(s) contain invalid quote values or effective windows. Repair them before retrying. %s',
        invalid_count,
        invalid_details
      );
  END IF;
END
$$;

-- Active price rules become part of the order's immutable quote snapshot in
-- this release. One legacy/hand-written JSON condition must not make every
-- production quote incomplete, so fail before changing any financial data.
-- Operators must explicitly repair or disable invalid rows; guessing a craft
-- code/ID or silently disabling a rule would change customer prices.
DO $$
DECLARE
  adjustment RECORD;
  condition JSONB;
  condition_key TEXT;
  unknown_keys TEXT[];
  validation_errors TEXT[];
  invalid_count INTEGER := 0;
  invalid_details TEXT := '';
BEGIN
  FOR adjustment IN
    SELECT
      "id",
      "name",
      "adjustmentType",
      "triggerCondition"
    FROM "PriceAdjustment"
    WHERE "isActive" = TRUE
    ORDER BY "id"
  LOOP
    condition := adjustment."triggerCondition";
    validation_errors := ARRAY[]::TEXT[];

    -- SQL NULL and JSON null both map to a null trigger condition in Prisma.
    IF condition IS NULL OR jsonb_typeof(condition) = 'null' THEN
      IF adjustment."adjustmentType"::TEXT = 'PER_SHEET' THEN
        validation_errors := array_append(
          validation_errors,
          'PER_SHEET requires a positive-integer unitsPerSheet'
        );
      END IF;
    ELSIF jsonb_typeof(condition) <> 'object' THEN
      validation_errors := array_append(
        validation_errors,
        'triggerCondition must be a JSON object or null'
      );
    ELSE
      SELECT array_agg(present_key ORDER BY present_key)
      INTO unknown_keys
      FROM jsonb_object_keys(condition) AS keys(present_key)
      WHERE NOT (
        present_key = ANY (ARRAY[
          'productIds',
          'craftIds',
          'craftMode',
          'specifications',
          'paperTypes',
          'foilColors',
          'isDoubleSided',
          'isDoubleColor',
          'minQty',
          'maxQty',
          'settlementTypes',
          'unitsPerSheet',
          'perFoilColor'
        ]::TEXT[])
      );
      IF unknown_keys IS NOT NULL THEN
        validation_errors := array_append(
          validation_errors,
          'unknown keys: ' || array_to_string(unknown_keys, ', ')
        );
      END IF;

      FOREACH condition_key IN ARRAY ARRAY[
        'productIds',
        'craftIds',
        'specifications',
        'paperTypes',
        'foilColors',
        'settlementTypes'
      ]::TEXT[]
      LOOP
        IF condition ? condition_key THEN
          IF jsonb_typeof(condition -> condition_key) <> 'array' THEN
            validation_errors := array_append(
              validation_errors,
              condition_key || ' must be a non-empty string array'
            );
          ELSIF jsonb_array_length(condition -> condition_key) = 0 OR EXISTS (
            SELECT 1
            FROM jsonb_array_elements(condition -> condition_key) AS entries(entry)
            WHERE jsonb_typeof(entry) <> 'string'
               OR btrim(entry #>> '{}') = ''
          ) THEN
            validation_errors := array_append(
              validation_errors,
              condition_key || ' must be a non-empty string array'
            );
          END IF;
        END IF;
      END LOOP;

      IF jsonb_typeof(condition -> 'settlementTypes') = 'array'
         AND EXISTS (
           SELECT 1
           FROM jsonb_array_elements(condition -> 'settlementTypes') AS entries(entry)
           WHERE jsonb_typeof(entry) = 'string'
             AND btrim(entry #>> '{}') NOT IN (
               'EXTERNAL_SALES',
               'INTERNAL_SALES',
               'FACTORY_DIRECT',
               'NO_CHARGE'
             )
         ) THEN
        validation_errors := array_append(
          validation_errors,
          'settlementTypes contains an unsupported settlement direction'
        );
      END IF;

      FOREACH condition_key IN ARRAY ARRAY[
        'isDoubleSided',
        'isDoubleColor',
        'perFoilColor'
      ]::TEXT[]
      LOOP
        IF condition ? condition_key
           AND jsonb_typeof(condition -> condition_key) <> 'boolean' THEN
          validation_errors := array_append(
            validation_errors,
            condition_key || ' must be boolean'
          );
        END IF;
      END LOOP;

      FOREACH condition_key IN ARRAY ARRAY[
        'minQty',
        'maxQty',
        'unitsPerSheet'
      ]::TEXT[]
      LOOP
        IF condition ? condition_key THEN
          IF jsonb_typeof(condition -> condition_key) <> 'number' THEN
            validation_errors := array_append(
              validation_errors,
              condition_key || ' must be a positive safe integer'
            );
          ELSIF (condition ->> condition_key)::NUMERIC < 1
             OR (condition ->> condition_key)::NUMERIC > 9007199254740991
             OR (condition ->> condition_key)::NUMERIC <>
                trunc((condition ->> condition_key)::NUMERIC) THEN
            validation_errors := array_append(
              validation_errors,
              condition_key || ' must be a positive safe integer'
            );
          END IF;
        END IF;
      END LOOP;

      IF condition ? 'craftMode' THEN
        IF jsonb_typeof(condition -> 'craftMode') <> 'string'
           OR (condition ->> 'craftMode') NOT IN ('ANY', 'ALL') THEN
          validation_errors := array_append(
            validation_errors,
            'craftMode must be ANY or ALL'
          );
        END IF;
        IF NOT (condition ? 'craftIds') THEN
          validation_errors := array_append(
            validation_errors,
            'craftMode requires craftIds'
          );
        END IF;
      END IF;

      IF jsonb_typeof(condition -> 'minQty') = 'number'
         AND jsonb_typeof(condition -> 'maxQty') = 'number'
         AND (condition ->> 'minQty')::NUMERIC =
             trunc((condition ->> 'minQty')::NUMERIC)
         AND (condition ->> 'maxQty')::NUMERIC =
             trunc((condition ->> 'maxQty')::NUMERIC)
         AND abs((condition ->> 'minQty')::NUMERIC) <= 9007199254740991
         AND abs((condition ->> 'maxQty')::NUMERIC) <= 9007199254740991
         AND (condition ->> 'minQty')::NUMERIC >
             (condition ->> 'maxQty')::NUMERIC THEN
        validation_errors := array_append(
          validation_errors,
          'minQty must not exceed maxQty'
        );
      END IF;

      IF adjustment."adjustmentType"::TEXT = 'PER_SHEET'
         AND NOT (condition ? 'unitsPerSheet') THEN
        validation_errors := array_append(
          validation_errors,
          'PER_SHEET requires a positive-integer unitsPerSheet'
        );
      END IF;
    END IF;

    IF cardinality(validation_errors) > 0 THEN
      invalid_count := invalid_count + 1;
      IF invalid_count <= 20 THEN
        invalid_details := invalid_details
          || CASE WHEN invalid_details = '' THEN '' ELSE '; ' END
          || format(
            '%s (%s): %s',
            adjustment."id",
            adjustment."name",
            array_to_string(validation_errors, ', ')
          );
      END IF;
    END IF;
  END LOOP;

  IF invalid_count > 0 THEN
    IF invalid_count > 20 THEN
      invalid_details := invalid_details
        || format('; ... and %s more', invalid_count - 20);
    END IF;
    RAISE EXCEPTION USING
      ERRCODE = 'check_violation',
      MESSAGE = format(
        'Pricing migration blocked: %s active PriceAdjustment rule(s) violate the current triggerCondition contract. Disable or repair them before retrying. %s',
        invalid_count,
        invalid_details
      );
  END IF;
END
$$;

CREATE TYPE "OrderSettlementType" AS ENUM (
  'EXTERNAL_SALES',
  'INTERNAL_SALES',
  'FACTORY_DIRECT',
  'NO_CHARGE'
);

ALTER TABLE "Order"
  ADD COLUMN "settlementType" "OrderSettlementType";

UPDATE "Order"
SET "settlementType" = CASE
  WHEN "billingMode" = 'NO_CHARGE' THEN 'NO_CHARGE'::"OrderSettlementType"
  WHEN "submitterRole" = 'SALES' THEN 'EXTERNAL_SALES'::"OrderSettlementType"
  WHEN "submitterRole" = 'CUSTOMER_SERVICE' THEN 'INTERNAL_SALES'::"OrderSettlementType"
  ELSE 'FACTORY_DIRECT'::"OrderSettlementType"
END;

ALTER TABLE "Order"
  ALTER COLUMN "settlementType" SET NOT NULL;

-- Legacy bill generation included every charged finished order, including
-- internal customer-service/admin orders. First reject every case where
-- changing rows would rewrite issued/paid history or where the external-sales
-- owner cannot be proven. These checks intentionally run before any delete.
DO $$
DECLARE
  problem_count INTEGER;
  problem_details TEXT;
BEGIN
  SELECT count(*)
  INTO problem_count
  FROM "Bill" AS bill
  WHERE EXISTS (
    SELECT 1
    FROM "BillItem" AS item
    JOIN "Order" AS source_order ON source_order."id" = item."orderId"
    WHERE item."billId" = bill."id"
      AND source_order."settlementType" <> 'EXTERNAL_SALES'::"OrderSettlementType"
  )
    AND (
      bill."status" <> 'DRAFT'
      OR bill."paidAmount" <> 0
      OR bill."openingAmount" <> 0
      OR bill."issuedAt" IS NOT NULL
      OR bill."paidAt" IS NOT NULL
      OR EXISTS (
        SELECT 1
        FROM "BillPayment" AS payment
        WHERE payment."billId" = bill."id"
      )
    );

  IF problem_count > 0 THEN
    SELECT string_agg(
      format(
        '%s(status=%s, opening=%s, paid=%s, issuedAt=%s, paidAt=%s, payments=%s)',
        unsafe_bill."id",
        unsafe_bill."status",
        unsafe_bill."openingAmount",
        unsafe_bill."paidAmount",
        COALESCE(unsafe_bill."issuedAt"::TEXT, 'null'),
        COALESCE(unsafe_bill."paidAt"::TEXT, 'null'),
        unsafe_bill.payment_count
      ),
      '; '
      ORDER BY unsafe_bill."id"
    )
    INTO problem_details
    FROM (
      SELECT
        bill."id",
        bill."status",
        bill."openingAmount",
        bill."paidAmount",
        bill."issuedAt",
        bill."paidAt",
        (SELECT count(*) FROM "BillPayment" AS payment WHERE payment."billId" = bill."id") AS payment_count
      FROM "Bill" AS bill
      WHERE EXISTS (
        SELECT 1
        FROM "BillItem" AS item
        JOIN "Order" AS source_order ON source_order."id" = item."orderId"
        WHERE item."billId" = bill."id"
          AND source_order."settlementType" <> 'EXTERNAL_SALES'::"OrderSettlementType"
      )
        AND (
          bill."status" <> 'DRAFT'
          OR bill."paidAmount" <> 0
          OR bill."openingAmount" <> 0
          OR bill."issuedAt" IS NOT NULL
          OR bill."paidAt" IS NOT NULL
          OR EXISTS (
            SELECT 1
            FROM "BillPayment" AS payment
            WHERE payment."billId" = bill."id"
          )
        )
      ORDER BY bill."id"
      LIMIT 20
    ) AS unsafe_bill;

    RAISE EXCEPTION USING
      ERRCODE = 'check_violation',
      MESSAGE = format(
        'Settlement migration blocked: %s contaminated bill(s) are issued, paid, have a non-zero opening balance, or have payment history and cannot be rewritten safely. Resolve them explicitly before retrying. %s',
        problem_count,
        COALESCE(problem_details, '')
      );
  END IF;

  SELECT count(*)
  INTO problem_count
  FROM "BillItem" AS item
  JOIN "Bill" AS bill ON bill."id" = item."billId"
  JOIN "Order" AS source_order ON source_order."id" = item."orderId"
  WHERE source_order."settlementType" = 'EXTERNAL_SALES'::"OrderSettlementType"
    AND source_order."submitterId" <> bill."salesUserId";

  IF problem_count > 0 THEN
    SELECT string_agg(
      format(
        'bill=%s/order=%s/billOwner=%s/orderSubmitter=%s',
        mismatch."billId",
        mismatch."orderId",
        mismatch."salesUserId",
        mismatch."submitterId"
      ),
      '; '
      ORDER BY mismatch."billId", mismatch."orderId"
    )
    INTO problem_details
    FROM (
      SELECT
        item."billId",
        item."orderId",
        bill."salesUserId",
        source_order."submitterId"
      FROM "BillItem" AS item
      JOIN "Bill" AS bill ON bill."id" = item."billId"
      JOIN "Order" AS source_order ON source_order."id" = item."orderId"
      WHERE source_order."settlementType" = 'EXTERNAL_SALES'::"OrderSettlementType"
        AND source_order."submitterId" <> bill."salesUserId"
      ORDER BY item."billId", item."orderId"
      LIMIT 20
    ) AS mismatch;

    RAISE EXCEPTION USING
      ERRCODE = 'check_violation',
      MESSAGE = format(
        'Settlement migration blocked: %s external BillItem owner mismatch(es) cannot be reassigned automatically. %s',
        problem_count,
        COALESCE(problem_details, '')
      );
  END IF;

  -- A non-zero opening balance with no surviving external-sales item has no
  -- historical direction snapshot. Likewise, a material itemless bill cannot
  -- be attributed. Do not guess based on the account's current role.
  SELECT count(*)
  INTO problem_count
  FROM "Bill" AS bill
  WHERE NOT EXISTS (
    SELECT 1
    FROM "BillItem" AS item
    JOIN "Order" AS source_order ON source_order."id" = item."orderId"
    WHERE item."billId" = bill."id"
      AND source_order."settlementType" = 'EXTERNAL_SALES'::"OrderSettlementType"
  )
    AND (
      bill."openingAmount" <> 0
      OR (
        NOT EXISTS (
          SELECT 1 FROM "BillItem" AS any_item WHERE any_item."billId" = bill."id"
        )
        AND (
          bill."totalAmount" <> 0
          OR bill."paidAmount" <> 0
          OR bill."status" <> 'DRAFT'
          OR EXISTS (
            SELECT 1
            FROM "BillPayment" AS payment
            WHERE payment."billId" = bill."id"
          )
        )
      )
    );

  IF problem_count > 0 THEN
    SELECT string_agg(
      format(
        '%s(opening=%s, total=%s, paid=%s, status=%s)',
        ambiguous_bill."id",
        ambiguous_bill."openingAmount",
        ambiguous_bill."totalAmount",
        ambiguous_bill."paidAmount",
        ambiguous_bill."status"
      ),
      '; '
      ORDER BY ambiguous_bill."id"
    )
    INTO problem_details
    FROM (
      SELECT
        bill."id",
        bill."openingAmount",
        bill."totalAmount",
        bill."paidAmount",
        bill."status"
      FROM "Bill" AS bill
      WHERE NOT EXISTS (
        SELECT 1
        FROM "BillItem" AS item
        JOIN "Order" AS source_order ON source_order."id" = item."orderId"
        WHERE item."billId" = bill."id"
          AND source_order."settlementType" = 'EXTERNAL_SALES'::"OrderSettlementType"
      )
        AND (
          bill."openingAmount" <> 0
          OR (
            NOT EXISTS (
              SELECT 1 FROM "BillItem" AS any_item WHERE any_item."billId" = bill."id"
            )
            AND (
              bill."totalAmount" <> 0
              OR bill."paidAmount" <> 0
              OR bill."status" <> 'DRAFT'
              OR EXISTS (
                SELECT 1
                FROM "BillPayment" AS payment
                WHERE payment."billId" = bill."id"
              )
            )
          )
        )
      ORDER BY bill."id"
      LIMIT 20
    ) AS ambiguous_bill;

    RAISE EXCEPTION USING
      ERRCODE = 'check_violation',
      MESSAGE = format(
        'Settlement migration blocked: %s bill(s) have opening/material balances but no provable external-sales item. Do not infer financial direction from a current user role. %s',
        problem_count,
        COALESCE(problem_details, '')
      );
  END IF;
END
$$;

-- Every remaining contaminated bill is now proven to be DRAFT, unpaid, never
-- issued, and payment-free. Delete only its non-external items and recompute
-- from the immutable surviving BillItem ledger plus its attributable opening.
DO $$
DECLARE
  target_bill RECORD;
  remaining_total NUMERIC;
  affected_rows INTEGER;
  cleaned_bills INTEGER := 0;
  deleted_items INTEGER := 0;
BEGIN
  FOR target_bill IN
    SELECT bill."id"
    FROM "Bill" AS bill
    WHERE EXISTS (
      SELECT 1
      FROM "BillItem" AS item
      JOIN "Order" AS source_order ON source_order."id" = item."orderId"
      WHERE item."billId" = bill."id"
        AND source_order."settlementType" <> 'EXTERNAL_SALES'::"OrderSettlementType"
    )
      AND bill."status" = 'DRAFT'
      AND bill."paidAmount" = 0
      AND bill."openingAmount" = 0
      AND bill."issuedAt" IS NULL
      AND bill."paidAt" IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM "BillPayment" AS payment
        WHERE payment."billId" = bill."id"
      )
    ORDER BY bill."id"
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM "Bill" AS bill
      WHERE bill."id" = target_bill."id"
        AND bill."status" = 'DRAFT'
        AND bill."paidAmount" = 0
        AND bill."openingAmount" = 0
        AND bill."issuedAt" IS NULL
        AND bill."paidAt" IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM "BillPayment" AS payment
          WHERE payment."billId" = bill."id"
        )
    ) THEN
      RAISE EXCEPTION USING
        ERRCODE = 'check_violation',
        MESSAGE = format(
          'Settlement migration blocked: Bill %s no longer satisfies the DRAFT, zero-balance, unissued, unpaid cleanup contract',
          target_bill."id"
        );
    END IF;

    DELETE FROM "BillItem" AS item
    USING "Order" AS source_order
    WHERE item."billId" = target_bill."id"
      AND source_order."id" = item."orderId"
      AND source_order."settlementType" <> 'EXTERNAL_SALES'::"OrderSettlementType";

    GET DIAGNOSTICS affected_rows = ROW_COUNT;
    deleted_items := deleted_items + affected_rows;

    SELECT
      bill."openingAmount" + COALESCE(sum(item."orderAmount"), 0)
    INTO remaining_total
    FROM "Bill" AS bill
    LEFT JOIN "BillItem" AS item ON item."billId" = bill."id"
    WHERE bill."id" = target_bill."id"
    GROUP BY bill."id", bill."openingAmount";

    IF remaining_total > 9999999999.99 OR remaining_total < -9999999999.99 THEN
      RAISE EXCEPTION USING
        ERRCODE = 'numeric_value_out_of_range',
        MESSAGE = format(
          'Settlement migration blocked: recalculated Bill %s total %s exceeds DECIMAL(12,2)',
          target_bill."id",
          remaining_total
        );
    END IF;

    UPDATE "Bill"
    SET
      "totalAmount" = remaining_total,
      "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = target_bill."id";

    cleaned_bills := cleaned_bills + 1;
  END LOOP;

  RAISE NOTICE 'Settlement migration safely cleaned % bill(s) and removed % non-external BillItem row(s)',
    cleaned_bills,
    deleted_items;
END
$$;

ALTER TABLE "OrderItem"
  ADD COLUMN "fixedFee" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "pricingSnapshot" JSONB,
  ADD COLUMN "priceOverrideReason" TEXT;

ALTER TABLE "Order"
  ADD CONSTRAINT "Order_billing_settlement_consistent"
  CHECK (
    ("billingMode" = 'NO_CHARGE' AND "settlementType" = 'NO_CHARGE') OR
    ("billingMode" = 'CHARGE' AND "settlementType" <> 'NO_CHARGE')
  ) NOT VALID,
  ADD CONSTRAINT "Order_settlement_role_consistent"
  CHECK (
    ("billingMode" = 'NO_CHARGE' AND "settlementType" = 'NO_CHARGE') OR
    (
      "billingMode" = 'CHARGE' AND (
        ("submitterRole" = 'SALES' AND "settlementType" = 'EXTERNAL_SALES') OR
        ("submitterRole" = 'CUSTOMER_SERVICE' AND "settlementType" = 'INTERNAL_SALES') OR
        (
          "submitterRole" NOT IN ('SALES', 'CUSTOMER_SERVICE') AND
          "settlementType" = 'FACTORY_DIRECT'
        )
      )
    )
  ) NOT VALID;

ALTER TABLE "OrderItem"
  ADD CONSTRAINT "OrderItem_fixedFee_nonnegative"
    CHECK ("fixedFee" >= 0) NOT VALID,
  ADD CONSTRAINT "OrderItem_pricingSnapshot_object"
    CHECK (
      "pricingSnapshot" IS NULL OR
      jsonb_typeof("pricingSnapshot") = 'object'
    ) NOT VALID;

ALTER TABLE "Product"
  ADD CONSTRAINT "Product_quote_values_valid"
  CHECK (
    ("baseUnitPrice" IS NULL OR "baseUnitPrice" BETWEEN 0 AND 999999.9999) AND
    ("minOrderQty" IS NULL OR "minOrderQty" BETWEEN 1 AND 9999999)
  ) NOT VALID;

ALTER TABLE "PriceTier"
  ADD CONSTRAINT "PriceTier_quote_values_valid"
  CHECK (
    "minQty" BETWEEN 1 AND 9999999 AND
    "unitPrice" BETWEEN 0 AND 999999.9999 AND
    ("effectiveTo" IS NULL OR "effectiveTo" > "effectiveFrom")
  ) NOT VALID;

ALTER TABLE "PriceAdjustment"
  ADD CONSTRAINT "PriceAdjustment_amount_valid"
  CHECK ("amount" BETWEEN 0 AND 999999.9999) NOT VALID;

ALTER TABLE "Order" VALIDATE CONSTRAINT "Order_billing_settlement_consistent";
ALTER TABLE "Order" VALIDATE CONSTRAINT "Order_settlement_role_consistent";
ALTER TABLE "OrderItem" VALIDATE CONSTRAINT "OrderItem_fixedFee_nonnegative";
ALTER TABLE "OrderItem" VALIDATE CONSTRAINT "OrderItem_pricingSnapshot_object";
ALTER TABLE "Product" VALIDATE CONSTRAINT "Product_quote_values_valid";
ALTER TABLE "PriceTier" VALIDATE CONSTRAINT "PriceTier_quote_values_valid";
ALTER TABLE "PriceAdjustment" VALIDATE CONSTRAINT "PriceAdjustment_amount_valid";

CREATE INDEX "Order_settlementType_status_finishedAt_idx"
  ON "Order"("settlementType", "status", "finishedAt");

-- SALES 是外部销售合作伙伴，只产生工单加工费应收，不是工厂员工。
-- 清理旧版表单为 SALES/ADMIN 默认写入的用工字段，防止进入考勤/工资语义。
UPDATE "User"
SET
  "employmentType" = NULL,
  "employmentStartDate" = NULL,
  "employmentEndDate" = NULL
WHERE "role" IN ('SALES', 'ADMIN');

COMMIT;
