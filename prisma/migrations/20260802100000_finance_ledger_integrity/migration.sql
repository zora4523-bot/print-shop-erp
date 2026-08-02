BEGIN;

-- Every browser mutation carries a stable request key. Existing rows receive a
-- deterministic legacy key so the new NOT NULL + UNIQUE contract is safe on
-- an upgraded database.
-- Perform every reconciliation preflight before changing the schema. Explicit
-- BEGIN/COMMIT makes a later assertion failure roll the whole migration back.
DO $$
DECLARE
  migration_now_utc TIMESTAMP := CURRENT_TIMESTAMP AT TIME ZONE 'UTC';
BEGIN
  -- SF collect means the receiver books and pays for SF Express. The new
  -- domain layer rejects every SHIPPING cost write for such an order. Stop
  -- here if historical data already contradicts that contract: silently
  -- deleting a posted cost would destroy the finance audit trail.
  IF EXISTS (
    SELECT 1
    FROM "Order" orders
    JOIN "OrderCostEntry" cost ON cost."orderId" = orders."id"
    WHERE orders."isSfCollect" = true
      AND cost."category" = 'SHIPPING'::"OrderCostCategory"
      AND cost."amount" <> 0
  ) THEN
    RAISE EXCEPTION
      'SF-collect orders have nonzero SHIPPING costs; finance must reconcile those historical entries before migration';
  END IF;

  -- SalaryRule DateTime values are stored as UTC wall-clock timestamps. Do not
  -- compare them directly with timestamptz CURRENT_TIMESTAMP: on a Pigsty
  -- session configured as Asia/Shanghai that would activate a rule eight hours
  -- early. Validate the exact rule shapes used by account creation/settlement.
  IF EXISTS (
    SELECT 1
    FROM "User"
    WHERE "role" = 'CUSTOMER_SERVICE'::"Role"
      AND "isActive" = true
  ) AND NOT EXISTS (
    SELECT 1
    FROM (
      SELECT "ruleValue"
      FROM "SalaryRule"
      WHERE "ruleType" = 'CS_COMMISSION'::"SalaryRuleType"
        AND "ruleKey" = 'CS_BASE_SALARY'
        AND "effectiveFrom" <= migration_now_utc
        AND ("effectiveTo" IS NULL OR "effectiveTo" > migration_now_utc)
      ORDER BY "effectiveFrom" DESC
      LIMIT 1
    ) active_base
    WHERE jsonb_typeof(active_base."ruleValue") = 'object'
      AND CASE
        WHEN COALESCE(active_base."ruleValue"->>'monthlyBase', '')
          ~ '^[0-9]+([.][0-9]{1,2})?$'
        THEN (active_base."ruleValue"->>'monthlyBase')::numeric
          <= 99999999.99
        ELSE false
      END
  ) THEN
    RAISE EXCEPTION
      'Active customer-service accounts require a valid CS_BASE_SALARY rule (nonnegative Decimal(10,2))';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "User"
    WHERE "role" = 'CUSTOMER_SERVICE'::"Role"
      AND "isActive" = true
  ) AND NOT EXISTS (
    SELECT 1
    FROM (
      SELECT "ruleValue"
      FROM "SalaryRule"
      WHERE "ruleType" = 'CS_COMMISSION'::"SalaryRuleType"
        AND "ruleKey" = 'CS_PERIOD_LENGTH'
        AND "effectiveFrom" <= migration_now_utc
        AND ("effectiveTo" IS NULL OR "effectiveTo" > migration_now_utc)
      ORDER BY "effectiveFrom" DESC
      LIMIT 1
    ) active_duration
    WHERE jsonb_typeof(active_duration."ruleValue") = 'object'
      AND CASE
        WHEN COALESCE(active_duration."ruleValue"->>'months', '') ~ '^[0-9]+$'
        THEN (active_duration."ruleValue"->>'months')::numeric BETWEEN 1 AND 24
        ELSE false
      END
  ) THEN
    RAISE EXCEPTION
      'Active customer-service accounts require a valid CS_PERIOD_LENGTH rule (1..24 whole months)';
  END IF;

  -- A tier rule is needed both for active accounts that will receive a new
  -- period below and for every historical IN_PROGRESS period that can still
  -- be settled, even if its owner has since been disabled or changed role.
  IF EXISTS (
    SELECT 1
    FROM "User"
    WHERE "role" = 'CUSTOMER_SERVICE'::"Role"
      AND "isActive" = true
  ) OR EXISTS (
    SELECT 1
    FROM "SalaryPeriod"
    WHERE "status" = 'IN_PROGRESS'::"SalaryPeriodStatus"
  ) THEN
    IF NOT EXISTS (
      SELECT 1
      FROM (
        SELECT "ruleValue"
        FROM "SalaryRule"
        WHERE "ruleType" = 'CS_COMMISSION'::"SalaryRuleType"
          AND "ruleKey" = 'CS_TIERS'
          AND "effectiveFrom" <= migration_now_utc
          AND ("effectiveTo" IS NULL OR "effectiveTo" > migration_now_utc)
        ORDER BY "effectiveFrom" DESC
        LIMIT 1
      ) active_tiers
      WHERE jsonb_typeof(active_tiers."ruleValue") = 'object'
        AND active_tiers."ruleValue"->>'mode' = 'FLAT'
        AND CASE
          WHEN jsonb_typeof(active_tiers."ruleValue"->'tiers') = 'array'
          THEN jsonb_array_length(active_tiers."ruleValue"->'tiers') > 0
          ELSE false
        END
    ) THEN
      RAISE EXCEPTION
        'Active or unsettled customer-service periods require a nonempty FLAT CS_TIERS rule';
    END IF;

    IF EXISTS (
      WITH active_tiers AS (
        SELECT "ruleValue"->'tiers' AS tiers
        FROM "SalaryRule"
        WHERE "ruleType" = 'CS_COMMISSION'::"SalaryRuleType"
          AND "ruleKey" = 'CS_TIERS'
          AND "effectiveFrom" <= migration_now_utc
          AND ("effectiveTo" IS NULL OR "effectiveTo" > migration_now_utc)
        ORDER BY "effectiveFrom" DESC
        LIMIT 1
      )
      SELECT 1
      FROM active_tiers
      CROSS JOIN LATERAL jsonb_array_elements(active_tiers.tiers) tier(value)
      WHERE jsonb_typeof(tier.value) <> 'object'
         OR NOT CASE
           WHEN COALESCE(tier.value->>'minSales', '')
             ~ '^[0-9]+([.][0-9]{1,2})?$'
           THEN true
           ELSE false
         END
         OR NOT CASE
           WHEN COALESCE(tier.value->>'rate', '')
             ~ '^[0-9]+([.][0-9]{1,4})?$'
           THEN (tier.value->>'rate')::numeric <= 1
           ELSE false
         END
    ) THEN
      RAISE EXCEPTION
        'CS_TIERS contains an invalid threshold or rate';
    END IF;

    IF EXISTS (
      WITH active_tiers AS (
        SELECT "ruleValue"->'tiers' AS tiers
        FROM "SalaryRule"
        WHERE "ruleType" = 'CS_COMMISSION'::"SalaryRuleType"
          AND "ruleKey" = 'CS_TIERS'
          AND "effectiveFrom" <= migration_now_utc
          AND ("effectiveTo" IS NULL OR "effectiveTo" > migration_now_utc)
        ORDER BY "effectiveFrom" DESC
        LIMIT 1
      )
      SELECT 1
      FROM active_tiers
      CROSS JOIN LATERAL jsonb_array_elements(active_tiers.tiers) tier(value)
      GROUP BY (tier.value->>'minSales')::numeric
      HAVING COUNT(*) > 1
    ) THEN
      RAISE EXCEPTION
        'CS_TIERS contains duplicate sales thresholds';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "User"
    WHERE "role" = 'CUSTOMER_SERVICE'::"Role"
      AND "isActive" = true
  ) AND EXISTS (
    WITH active_base AS (
      SELECT CASE
        WHEN COALESCE("ruleValue"->>'monthlyBase', '')
          ~ '^[0-9]+([.][0-9]{1,2})?$'
        THEN ("ruleValue"->>'monthlyBase')::numeric
        ELSE NULL
      END AS monthly_base
      FROM "SalaryRule"
      WHERE "ruleType" = 'CS_COMMISSION'::"SalaryRuleType"
        AND "ruleKey" = 'CS_BASE_SALARY'
        AND "effectiveFrom" <= migration_now_utc
        AND ("effectiveTo" IS NULL OR "effectiveTo" > migration_now_utc)
      ORDER BY "effectiveFrom" DESC
      LIMIT 1
    ), active_duration AS (
      SELECT CASE
        WHEN COALESCE("ruleValue"->>'months', '') ~ '^[0-9]+$'
        THEN ("ruleValue"->>'months')::numeric
        ELSE NULL
      END AS duration_months
      FROM "SalaryRule"
      WHERE "ruleType" = 'CS_COMMISSION'::"SalaryRuleType"
        AND "ruleKey" = 'CS_PERIOD_LENGTH'
        AND "effectiveFrom" <= migration_now_utc
        AND ("effectiveTo" IS NULL OR "effectiveTo" > migration_now_utc)
      ORDER BY "effectiveFrom" DESC
      LIMIT 1
    )
    SELECT 1
    FROM active_base
    CROSS JOIN active_duration
    WHERE active_base.monthly_base * active_duration.duration_months
      > 99999999.99
  ) THEN
    RAISE EXCEPTION
      'Active CS base salary multiplied by period length exceeds Decimal(10,2)';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "SalaryPeriod"
    WHERE "durationMonths" NOT BETWEEN 1 AND 24
       OR "monthlyBase" < 0
       OR "monthlyBase" * "durationMonths" > 99999999.99
       OR "initialSales" < 0
       OR ABS("totalSales" + "initialSales") > 9999999999.99
       OR (
         "status" = 'IN_PROGRESS'::"SalaryPeriodStatus"
         AND "settledAt" IS NOT NULL
       )
       OR (
         "status" = 'SETTLED'::"SalaryPeriodStatus"
         AND "settledAt" IS NULL
       )
  ) THEN
    RAISE EXCEPTION
      'SalaryPeriod dates, amounts, duration, or settlement state are invalid';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "SalaryPeriod"
    WHERE "periodEnd" <> (
      "periodStart" + make_interval(months => "durationMonths")
      - interval '1 day'
    )::date
  ) THEN
    RAISE EXCEPTION
      'SalaryPeriod periodEnd does not match periodStart plus durationMonths';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "SalaryPeriod" left_period
    JOIN "SalaryPeriod" right_period
      ON right_period."csUserId" = left_period."csUserId"
     AND right_period."id" > left_period."id"
     AND right_period."periodStart" <= left_period."periodEnd"
     AND right_period."periodEnd" >= left_period."periodStart"
  ) THEN
    RAISE EXCEPTION
      'Overlapping customer-service salary periods exist';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "SalaryPeriod" period
    LEFT JOIN "CustomerServiceCommission" commission
      ON commission."salaryPeriodId" = period."id"
    WHERE (
      period."status" = 'SETTLED'::"SalaryPeriodStatus"
      AND commission."id" IS NULL
    ) OR (
      period."status" = 'IN_PROGRESS'::"SalaryPeriodStatus"
      AND commission."id" IS NOT NULL
    )
  ) THEN
    RAISE EXCEPTION
      'SalaryPeriod settlement state does not match CustomerServiceCommission';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "CustomerServiceCommission" commission
    JOIN "SalaryPeriod" period
      ON period."id" = commission."salaryPeriodId"
    WHERE commission."csUserId" <> period."csUserId"
       OR commission."settledAt" <> period."settledAt"
       OR commission."totalSales"
            <> period."totalSales" + period."initialSales"
       OR commission."tierRate" < 0
       OR commission."tierRate" > 1
       OR commission."commissionAmount" < 0
       OR commission."commissionAmount"
            <> ROUND(commission."totalSales" * commission."tierRate", 2)
       OR commission."monthlyBaseTotal"
            <> period."monthlyBase" * period."durationMonths"
       OR commission."totalIncome"
            <> commission."monthlyBaseTotal" + commission."commissionAmount"
       OR commission."paidBase" < 0
       OR commission."paidCommission" < 0
       OR commission."paidBase" > commission."monthlyBaseTotal"
       OR commission."paidCommission" > commission."commissionAmount"
       OR commission."isFullyPaid" <> (
         commission."paidBase" = commission."monthlyBaseTotal"
         AND commission."paidCommission" = commission."commissionAmount"
       )
       OR (commission."isFullyPaid" AND commission."paidAt" IS NULL)
       OR (NOT commission."isFullyPaid" AND commission."paidAt" IS NOT NULL)
  ) THEN
    RAISE EXCEPTION
      'CustomerServiceCommission identity, formula, or paid-state invariants are invalid';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "Bill"
    WHERE "totalAmount" < 0
       OR "paidAmount" < 0
       OR "paidAmount" > "totalAmount"
       OR (
         "status" IN ('DRAFT'::"BillStatus", 'ISSUED'::"BillStatus")
         AND "paidAmount" <> 0
       )
       OR (
         "status" = 'PARTIAL_PAID'::"BillStatus"
         AND NOT ("paidAmount" > 0 AND "paidAmount" < "totalAmount")
       )
       OR (
         "status" = 'FULLY_PAID'::"BillStatus"
         AND NOT ("totalAmount" > 0 AND "paidAmount" = "totalAmount")
       )
  ) THEN
    RAISE EXCEPTION
      'Bill amount/status invariants are invalid; reconcile historical bills before applying this migration';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "Bill" bill
    LEFT JOIN (
      SELECT "billId", SUM("orderAmount") AS item_total
      FROM "BillItem"
      GROUP BY "billId"
    ) items ON items."billId" = bill."id"
    WHERE ABS(bill."totalAmount" - COALESCE(items.item_total, 0))
      > 9999999999.99
  ) THEN
    RAISE EXCEPTION
      'Bill opening amount exceeds Decimal(12,2); reconcile historical bill items first';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "Bill" bill
    LEFT JOIN (
      SELECT "billId", SUM("amount") AS ledger_paid
      FROM "BillPayment"
      GROUP BY "billId"
    ) payments ON payments."billId" = bill."id"
    WHERE bill."paidAmount" < COALESCE(payments.ledger_paid, 0)
  ) THEN
    RAISE EXCEPTION
      'BillPayment exceeds Bill.paidAmount; manual finance reconciliation required';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "Bill" bill
    LEFT JOIN (
      SELECT "billId", SUM("amount") AS ledger_paid
      FROM "BillPayment"
      GROUP BY "billId"
    ) payments ON payments."billId" = bill."id"
    WHERE bill."paidAmount" > COALESCE(payments.ledger_paid, 0)
  ) AND NOT EXISTS (
    SELECT 1 FROM "User" WHERE "role" = 'ADMIN'::"Role"
  ) THEN
    RAISE EXCEPTION
      'Cannot backfill BillPayment without an ADMIN recorder';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "CustomerServiceCommission"
    WHERE "paidBase" < 0
       OR "paidCommission" < 0
       OR "paidBase" > "monthlyBaseTotal"
       OR "paidCommission" > "commissionAmount"
  ) THEN
    RAISE EXCEPTION
      'Customer-service paid snapshots exceed their settled amounts';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "CustomerServiceCommission"
    WHERE "paidBase" + "paidCommission" > 0
  ) AND NOT EXISTS (
    SELECT 1 FROM "User" WHERE "role" = 'ADMIN'::"Role"
  ) THEN
    RAISE EXCEPTION
      'Cannot backfill CsPayrollPayment without an ADMIN recorder';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "SalaryPeriod" period
    LEFT JOIN (
      SELECT "salaryPeriodId", SUM("amount") AS entry_total
      FROM "CsSalesEntry"
      GROUP BY "salaryPeriodId"
    ) entries ON entries."salaryPeriodId" = period."id"
    WHERE ABS(period."totalSales" - COALESCE(entries.entry_total, 0))
      > 9999999999.99
  ) THEN
    RAISE EXCEPTION
      'Customer-service opening sales entry exceeds Decimal(12,2)';
  END IF;
END $$;

-- Draft orders are not yet finance-of-record, so repair their derived amounts
-- before future submissions can turn an old inconsistent draft into a bill.
UPDATE "OrderItem" item
SET "subtotal" = ROUND(item."quantity" * item."unitPrice", 2)
FROM "Order" orders
WHERE orders."id" = item."orderId"
  AND orders."status" = 'DRAFT'::"OrderStatus"
  AND item."subtotal" <> ROUND(item."quantity" * item."unitPrice", 2);

UPDATE "Order" orders
SET "totalAmount" = totals."itemTotal"
FROM (
  SELECT item."orderId", COALESCE(SUM(item."subtotal"), 0) AS "itemTotal"
  FROM "OrderItem" item
  GROUP BY item."orderId"
) totals
WHERE totals."orderId" = orders."id"
  AND orders."status" = 'DRAFT'::"OrderStatus"
  AND orders."totalAmount" <> totals."itemTotal";

-- Store the business event instant separately from insertion time so a delayed
-- write remains auditable against the Shanghai DATE used for period matching.
ALTER TABLE "CsSalesEntry" ADD COLUMN "occurredAt" TIMESTAMP(3);
UPDATE "CsSalesEntry"
SET "occurredAt" = "createdAt"
WHERE "occurredAt" IS NULL;
ALTER TABLE "CsSalesEntry" ALTER COLUMN "occurredAt" SET NOT NULL;
CREATE INDEX "CsSalesEntry_occurredAt_idx" ON "CsSalesEntry"("occurredAt");
ALTER TABLE "CsSalesEntry"
  ADD CONSTRAINT "CsSalesEntry_amount_nonzero"
    CHECK ("amount" <> 0) NOT VALID;

ALTER TABLE "Bill"
  ADD COLUMN "openingAmount" DECIMAL(12, 2) NOT NULL DEFAULT 0;

-- Preserve old/manual bill totals explicitly. From this migration onward the
-- invariant is totalAmount = openingAmount + SUM(BillItem.orderAmount).
UPDATE "Bill" bill
SET "openingAmount" = bill."totalAmount" - COALESCE(items."itemTotal", 0)
FROM (
  SELECT b."id", SUM(item."orderAmount") AS "itemTotal"
  FROM "Bill" b
  LEFT JOIN "BillItem" item ON item."billId" = b."id"
  GROUP BY b."id"
) items
WHERE items."id" = bill."id";

ALTER TABLE "Bill"
  ADD CONSTRAINT "Bill_amounts_nonnegative"
    CHECK ("totalAmount" >= 0 AND "paidAmount" >= 0),
  ADD CONSTRAINT "Bill_paid_not_over_total"
    CHECK ("paidAmount" <= "totalAmount"),
  ADD CONSTRAINT "Bill_status_amount_consistency"
    CHECK (
      (
        "status" IN ('DRAFT'::"BillStatus", 'ISSUED'::"BillStatus")
        AND "paidAmount" = 0
      )
      OR (
        "status" = 'PARTIAL_PAID'::"BillStatus"
        AND "paidAmount" > 0
        AND "paidAmount" < "totalAmount"
      )
      OR (
        "status" = 'FULLY_PAID'::"BillStatus"
        AND "totalAmount" > 0
        AND "paidAmount" = "totalAmount"
      )
    );

ALTER TABLE "BillPayment" ADD COLUMN "idempotencyKey" TEXT;
UPDATE "BillPayment"
SET "idempotencyKey" = 'legacy:' || "id"
WHERE "idempotencyKey" IS NULL;
ALTER TABLE "BillPayment" ALTER COLUMN "idempotencyKey" SET NOT NULL;
CREATE UNIQUE INDEX "BillPayment_idempotencyKey_key"
  ON "BillPayment"("idempotencyKey");

-- Backfill paidAmount snapshots that predate BillPayment. A positive gap is a
-- historical opening receipt. A negative gap cannot be represented by the
-- positive-only payment ledger and deliberately fails the migration below.
WITH recorder AS (
  SELECT "id"
  FROM "User"
  WHERE "role" = 'ADMIN'::"Role"
  ORDER BY "isActive" DESC, "createdAt" ASC
  LIMIT 1
), payment_totals AS (
  SELECT bill."id", COALESCE(SUM(payment."amount"), 0) AS ledger_paid
  FROM "Bill" bill
  LEFT JOIN "BillPayment" payment ON payment."billId" = bill."id"
  GROUP BY bill."id"
)
INSERT INTO "BillPayment" (
  "id",
  "idempotencyKey",
  "billId",
  "amount",
  "paidAt",
  "paymentMethod",
  "referenceNo",
  "remark",
  "recordedById",
  "createdAt"
)
SELECT
  'legacy:bill-payment:' || bill."id",
  'migration:20260802:bill-payment:' || bill."id",
  bill."id",
  bill."paidAmount" - totals.ledger_paid,
  COALESCE(bill."paidAt", bill."issuedAt", bill."updatedAt"),
  '历史期初',
  NULL,
  '付款流水启用前的账面已收金额',
  recorder."id",
  CURRENT_TIMESTAMP AT TIME ZONE 'UTC'
FROM "Bill" bill
JOIN payment_totals totals ON totals."id" = bill."id"
CROSS JOIN recorder
WHERE bill."paidAmount" > totals.ledger_paid;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "Bill" bill
    LEFT JOIN (
      SELECT "billId", SUM("amount") AS ledger_paid
      FROM "BillPayment"
      GROUP BY "billId"
    ) payments ON payments."billId" = bill."id"
    WHERE bill."paidAmount" <> COALESCE(payments.ledger_paid, 0)
  ) THEN
    RAISE EXCEPTION
      'Bill.paidAmount does not reconcile with BillPayment; manual finance reconciliation required';
  END IF;
END $$;

ALTER TABLE "OrderCostEntry" ADD COLUMN "idempotencyKey" TEXT;
UPDATE "OrderCostEntry"
SET "idempotencyKey" = 'legacy:' || "id"
WHERE "idempotencyKey" IS NULL;
ALTER TABLE "OrderCostEntry" ALTER COLUMN "idempotencyKey" SET NOT NULL;
CREATE UNIQUE INDEX "OrderCostEntry_idempotencyKey_key"
  ON "OrderCostEntry"("idempotencyKey");

-- Historical rows are retained exactly as posted. These NOT VALID constraints
-- protect all new writes without making an upgrade fail if a legacy manual
-- row used PIECEWORK / OUTSOURCE or a negative non-adjustment amount.
ALTER TABLE "OrderCostEntry"
  ADD CONSTRAINT "OrderCostEntry_manual_category_source"
    CHECK (
      "sourceType" IS NOT NULL
      OR "category" NOT IN (
        'PIECEWORK'::"OrderCostCategory",
        'OUTSOURCE'::"OrderCostCategory"
      )
    ) NOT VALID,
  ADD CONSTRAINT "OrderCostEntry_amount_sign"
    CHECK (
      "category" = 'ADJUSTMENT'::"OrderCostCategory"
      OR "amount" > 0
    ) NOT VALID,
  ADD CONSTRAINT "OrderCostEntry_amount_nonzero"
    CHECK ("amount" <> 0) NOT VALID,
  ADD CONSTRAINT "OrderCostEntry_quantity_nonnegative"
    CHECK ("quantity" IS NULL OR "quantity" >= 0) NOT VALID,
  ADD CONSTRAINT "OrderCostEntry_unit_price_nonnegative"
    CHECK ("unitPrice" IS NULL OR "unitPrice" >= 0) NOT VALID;

-- Bottom salary can be paid monthly before a four-month CS period settles;
-- commission can be posted after settlement. The append-only ledger makes the
-- example “first three months paid 6000, final month pays 35000” auditable.
CREATE TABLE "CsPayrollPayment" (
  "id" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "salaryPeriodId" TEXT NOT NULL,
  "baseAmount" DECIMAL(12, 2) NOT NULL DEFAULT 0,
  "commissionAmount" DECIMAL(12, 2) NOT NULL DEFAULT 0,
  "paidAt" TIMESTAMP(3) NOT NULL,
  "paymentMethod" TEXT,
  "referenceNo" TEXT,
  "remark" TEXT,
  "recordedById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CsPayrollPayment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CsPayrollPayment_amounts_nonnegative"
    CHECK ("baseAmount" >= 0 AND "commissionAmount" >= 0),
  CONSTRAINT "CsPayrollPayment_amount_positive"
    CHECK ("baseAmount" + "commissionAmount" > 0),
  CONSTRAINT "CsPayrollPayment_salaryPeriodId_fkey"
    FOREIGN KEY ("salaryPeriodId") REFERENCES "SalaryPeriod"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CsPayrollPayment_recordedById_fkey"
    FOREIGN KEY ("recordedById") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "CsPayrollPayment_idempotencyKey_key"
  ON "CsPayrollPayment"("idempotencyKey");
CREATE INDEX "CsPayrollPayment_salaryPeriodId_paidAt_idx"
  ON "CsPayrollPayment"("salaryPeriodId", "paidAt");
CREATE INDEX "CsPayrollPayment_recordedById_createdAt_idx"
  ON "CsPayrollPayment"("recordedById", "createdAt");

-- Preserve paidBase / paidCommission snapshots from the former all-at-once
-- toggle as one auditable opening payroll payment.
WITH recorder AS (
  SELECT "id"
  FROM "User"
  WHERE "role" = 'ADMIN'::"Role"
  ORDER BY "isActive" DESC, "createdAt" ASC
  LIMIT 1
)
INSERT INTO "CsPayrollPayment" (
  "id",
  "idempotencyKey",
  "salaryPeriodId",
  "baseAmount",
  "commissionAmount",
  "paidAt",
  "paymentMethod",
  "referenceNo",
  "remark",
  "recordedById",
  "createdAt"
)
SELECT
  'legacy:cs-payroll:' || commission."id",
  'migration:20260802:cs-payroll:' || commission."id",
  commission."salaryPeriodId",
  commission."paidBase",
  commission."paidCommission",
  COALESCE(commission."paidAt", commission."settledAt"),
  '历史期初',
  NULL,
  '工资发放流水启用前的已发金额',
  recorder."id",
  CURRENT_TIMESTAMP AT TIME ZONE 'UTC'
FROM "CustomerServiceCommission" commission
CROSS JOIN recorder
WHERE commission."paidBase" + commission."paidCommission" > 0;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "CustomerServiceCommission" commission
    LEFT JOIN (
      SELECT
        "salaryPeriodId",
        SUM("baseAmount") AS paid_base,
        SUM("commissionAmount") AS paid_commission
      FROM "CsPayrollPayment"
      GROUP BY "salaryPeriodId"
    ) payments ON payments."salaryPeriodId" = commission."salaryPeriodId"
    WHERE commission."paidBase" <> COALESCE(payments.paid_base, 0)
       OR commission."paidCommission" <> COALESCE(payments.paid_commission, 0)
  ) THEN
    RAISE EXCEPTION
      'CustomerServiceCommission paid snapshots do not reconcile with CsPayrollPayment';
  END IF;
END $$;

-- SPEC §3.7 requires every active customer-service account to start with a
-- salary period. Earlier account creation did not do this, so create the
-- current Shanghai-month period for accounts that have no active period and
-- no historical range collision. Active rule values are used rather than
-- hard-coded salary numbers.
WITH active_rules AS (
  SELECT
    (
      SELECT CASE
        WHEN COALESCE(sr."ruleValue"->>'monthlyBase', '')
          ~ '^[0-9]+([.][0-9]{1,2})?$'
        THEN (sr."ruleValue"->>'monthlyBase')::numeric
        ELSE NULL
      END
      FROM "SalaryRule" sr
      WHERE sr."ruleType" = 'CS_COMMISSION'::"SalaryRuleType"
        AND sr."ruleKey" = 'CS_BASE_SALARY'
        AND sr."effectiveFrom" <= CURRENT_TIMESTAMP AT TIME ZONE 'UTC'
        AND (
          sr."effectiveTo" IS NULL
          OR sr."effectiveTo" > CURRENT_TIMESTAMP AT TIME ZONE 'UTC'
        )
      ORDER BY sr."effectiveFrom" DESC
      LIMIT 1
    ) AS monthly_base,
    (
      SELECT CASE
        WHEN COALESCE(sr."ruleValue"->>'months', '') ~ '^[0-9]+$'
        THEN CASE
          WHEN (sr."ruleValue"->>'months')::numeric BETWEEN 1 AND 24
          THEN (sr."ruleValue"->>'months')::integer
          ELSE NULL
        END
        ELSE NULL
      END
      FROM "SalaryRule" sr
      WHERE sr."ruleType" = 'CS_COMMISSION'::"SalaryRuleType"
        AND sr."ruleKey" = 'CS_PERIOD_LENGTH'
        AND sr."effectiveFrom" <= CURRENT_TIMESTAMP AT TIME ZONE 'UTC'
        AND (
          sr."effectiveTo" IS NULL
          OR sr."effectiveTo" > CURRENT_TIMESTAMP AT TIME ZONE 'UTC'
        )
      ORDER BY sr."effectiveFrom" DESC
      LIMIT 1
    ) AS duration_months,
    date_trunc('month', timezone('Asia/Shanghai', CURRENT_TIMESTAMP))::date
      AS period_start
), candidates AS (
  SELECT
    u."id" AS cs_user_id,
    rules.monthly_base,
    rules.duration_months,
    rules.period_start,
    (
      rules.period_start
      + (rules.duration_months || ' months')::interval
      - interval '1 day'
    )::date AS period_end
  FROM "User" u
  CROSS JOIN active_rules rules
  WHERE u."role" = 'CUSTOMER_SERVICE'::"Role"
    AND u."isActive" = true
    AND rules.monthly_base IS NOT NULL
    AND rules.monthly_base >= 0
    AND rules.duration_months BETWEEN 1 AND 24
    AND rules.monthly_base * rules.duration_months <= 99999999.99
    AND NOT EXISTS (
      SELECT 1
      FROM "SalaryPeriod" active
      WHERE active."csUserId" = u."id"
        AND active."status" = 'IN_PROGRESS'::"SalaryPeriodStatus"
    )
)
INSERT INTO "SalaryPeriod" (
  "id",
  "csUserId",
  "periodStart",
  "periodEnd",
  "durationMonths",
  "totalSales",
  "initialSales",
  "monthlyBase",
  "status",
  "createdAt",
  "updatedAt"
)
SELECT
  'auto-period:' || candidate.cs_user_id || ':' ||
    to_char(candidate.period_start, 'YYYYMM'),
  candidate.cs_user_id,
  candidate.period_start,
  candidate.period_end,
  candidate.duration_months,
  0,
  0,
  candidate.monthly_base,
  'IN_PROGRESS'::"SalaryPeriodStatus",
  CURRENT_TIMESTAMP AT TIME ZONE 'UTC',
  CURRENT_TIMESTAMP AT TIME ZONE 'UTC'
FROM candidates candidate
WHERE NOT EXISTS (
  SELECT 1
  FROM "SalaryPeriod" historical
  WHERE historical."csUserId" = candidate.cs_user_id
    AND historical."periodStart" <= candidate.period_end
    AND historical."periodEnd" >= candidate.period_start
);

-- CsSalesEntry was introduced after SalaryPeriod.totalSales had already been
-- used in production. Preserve the existing aggregate as one explicit opening
-- correction per period instead of silently resetting or double-counting it.
INSERT INTO "CsSalesEntry" (
  "id",
  "eventKey",
  "csUserId",
  "salaryPeriodId",
  "orderId",
  "orderRevision",
  "type",
  "amount",
  "occurredAt",
  "remark",
  "createdAt"
)
SELECT
  'baseline:' || sp."id",
  'migration:20260802:salary-period-baseline:' || sp."id",
  sp."csUserId",
  sp."id",
  NULL,
  NULL,
  'MANUAL_ADJUSTMENT'::"CsSalesEntryType",
  sp."totalSales" - COALESCE(entries."entryTotal", 0),
  (sp."periodStart"::timestamp AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'UTC',
  '客服销售额流水启用前的期初校准；保留原周期累计值，不代表单张工单',
  CURRENT_TIMESTAMP AT TIME ZONE 'UTC'
FROM "SalaryPeriod" sp
LEFT JOIN (
  SELECT "salaryPeriodId", SUM("amount") AS "entryTotal"
  FROM "CsSalesEntry"
  GROUP BY "salaryPeriodId"
) entries ON entries."salaryPeriodId" = sp."id"
WHERE sp."totalSales" <> COALESCE(entries."entryTotal", 0)
ON CONFLICT ("eventKey") DO NOTHING;

-- Final postconditions make the migration an executable reconciliation gate,
-- not merely a best-effort backfill. Any failure rolls back every DDL/DML
-- statement above because this file owns its transaction explicitly.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "Bill" bill
    LEFT JOIN (
      SELECT "billId", SUM("orderAmount") AS item_total
      FROM "BillItem"
      GROUP BY "billId"
    ) items ON items."billId" = bill."id"
    WHERE bill."totalAmount"
      <> bill."openingAmount" + COALESCE(items.item_total, 0)
  ) THEN
    RAISE EXCEPTION
      'Bill totalAmount does not reconcile with openingAmount + BillItem';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "Bill" bill
    LEFT JOIN (
      SELECT "billId", SUM("amount") AS ledger_paid
      FROM "BillPayment"
      GROUP BY "billId"
    ) payments ON payments."billId" = bill."id"
    WHERE bill."paidAmount" <> COALESCE(payments.ledger_paid, 0)
  ) THEN
    RAISE EXCEPTION
      'Bill.paidAmount does not reconcile with BillPayment after backfill';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "SalaryPeriod" period
    LEFT JOIN (
      SELECT "salaryPeriodId", SUM("amount") AS entry_total
      FROM "CsSalesEntry"
      GROUP BY "salaryPeriodId"
    ) entries ON entries."salaryPeriodId" = period."id"
    WHERE period."totalSales" <> COALESCE(entries.entry_total, 0)
  ) THEN
    RAISE EXCEPTION
      'SalaryPeriod.totalSales does not reconcile with CsSalesEntry after backfill';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "SalaryPeriod" period
    WHERE "durationMonths" NOT BETWEEN 1 AND 24
       OR "periodEnd" <> (
         "periodStart" + make_interval(months => "durationMonths")
         - interval '1 day'
       )::date
       OR "monthlyBase" < 0
       OR "monthlyBase" * "durationMonths" > 99999999.99
       OR "initialSales" < 0
       OR ABS("totalSales" + "initialSales") > 9999999999.99
  ) THEN
    RAISE EXCEPTION
      'SalaryPeriod formula invariants failed after backfill';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "SalaryPeriod" period
    LEFT JOIN "CustomerServiceCommission" commission
      ON commission."salaryPeriodId" = period."id"
    WHERE (
      period."status" = 'SETTLED'::"SalaryPeriodStatus"
      AND (period."settledAt" IS NULL OR commission."id" IS NULL)
    ) OR (
      period."status" = 'IN_PROGRESS'::"SalaryPeriodStatus"
      AND (period."settledAt" IS NOT NULL OR commission."id" IS NOT NULL)
    )
  ) THEN
    RAISE EXCEPTION
      'SalaryPeriod settlement state failed after payroll backfill';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "CustomerServiceCommission" commission
    JOIN "SalaryPeriod" period
      ON period."id" = commission."salaryPeriodId"
    LEFT JOIN (
      SELECT
        "salaryPeriodId",
        SUM("baseAmount") AS paid_base,
        SUM("commissionAmount") AS paid_commission,
        MAX("paidAt") AS latest_paid_at
      FROM "CsPayrollPayment"
      GROUP BY "salaryPeriodId"
    ) payments ON payments."salaryPeriodId" = commission."salaryPeriodId"
    WHERE commission."csUserId" <> period."csUserId"
       OR commission."settledAt" <> period."settledAt"
       OR commission."totalSales"
            <> period."totalSales" + period."initialSales"
       OR commission."tierRate" < 0
       OR commission."tierRate" > 1
       OR commission."commissionAmount" < 0
       OR commission."commissionAmount"
            <> ROUND(commission."totalSales" * commission."tierRate", 2)
       OR commission."monthlyBaseTotal"
            <> period."monthlyBase" * period."durationMonths"
       OR commission."totalIncome"
            <> commission."monthlyBaseTotal" + commission."commissionAmount"
       OR commission."paidBase" <> COALESCE(payments.paid_base, 0)
       OR commission."paidCommission" <> COALESCE(payments.paid_commission, 0)
       OR commission."isFullyPaid" <> (
         commission."paidBase" = commission."monthlyBaseTotal"
         AND commission."paidCommission" = commission."commissionAmount"
       )
       OR (commission."isFullyPaid" AND commission."paidAt" IS NULL)
       OR (NOT commission."isFullyPaid" AND commission."paidAt" IS NOT NULL)
       OR (
         commission."isFullyPaid"
         AND commission."paidBase" + commission."paidCommission" > 0
         AND commission."paidAt" <> payments.latest_paid_at
       )
  ) THEN
    RAISE EXCEPTION
      'Customer-service commission/payroll identity, formula, or paid-state reconciliation failed';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "SalaryPeriod" period
    JOIN (
      SELECT
        "salaryPeriodId",
        SUM("baseAmount") AS paid_base,
        SUM("commissionAmount") AS paid_commission
      FROM "CsPayrollPayment"
      GROUP BY "salaryPeriodId"
    ) payments ON payments."salaryPeriodId" = period."id"
    LEFT JOIN "CustomerServiceCommission" commission
      ON commission."salaryPeriodId" = period."id"
    WHERE payments.paid_commission
            > COALESCE(commission."commissionAmount", 0)
       OR payments.paid_base > COALESCE(
         commission."monthlyBaseTotal",
         period."monthlyBase" * period."durationMonths"
       )
  ) THEN
    RAISE EXCEPTION
      'Customer-service payroll totals exceed their period liabilities';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "CsPayrollPayment" payment
    JOIN "User" recorder ON recorder."id" = payment."recordedById"
    WHERE recorder."role" <> 'ADMIN'::"Role"
  ) THEN
    RAISE EXCEPTION
      'Every customer-service payroll entry must be recorded by an ADMIN';
  END IF;

  IF EXISTS (
    SELECT active_cs."id"
    FROM "User" active_cs
    LEFT JOIN "SalaryPeriod" current_period
      ON current_period."csUserId" = active_cs."id"
     AND current_period."status" = 'IN_PROGRESS'::"SalaryPeriodStatus"
     AND current_period."periodStart"
       <= timezone('Asia/Shanghai', CURRENT_TIMESTAMP)::date
     AND current_period."periodEnd"
       >= timezone('Asia/Shanghai', CURRENT_TIMESTAMP)::date
    WHERE active_cs."role" = 'CUSTOMER_SERVICE'::"Role"
      AND active_cs."isActive" = true
    GROUP BY active_cs."id"
    HAVING COUNT(current_period."id") <> 1
  ) THEN
    RAISE EXCEPTION
      'Every active customer-service account must have exactly one current IN_PROGRESS salary period';
  END IF;
END $$;

COMMIT;
