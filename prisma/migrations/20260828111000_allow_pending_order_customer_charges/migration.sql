BEGIN;

-- PENDING_AMOUNT was added after the original value-shape constraint.  The
-- dedicated status/amount constraint correctly requires NULL for this state,
-- but OrderCustomerCharge_values_valid still required every non-adjustment
-- row to have a numeric amount and only admitted ESTIMATED/FINAL/WAIVED.
-- Replace that stale half of the contract without changing any price data.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'OrderCustomerCharge_values_valid'
      AND conrelid = '"OrderCustomerCharge"'::regclass
  ) THEN
    RAISE EXCEPTION
      'Expected OrderCustomerCharge_values_valid before pending-amount repair';
  END IF;
END
$$;

ALTER TABLE "OrderCustomerCharge"
  DROP CONSTRAINT "OrderCustomerCharge_values_valid";

ALTER TABLE "OrderCustomerCharge"
  ADD CONSTRAINT "OrderCustomerCharge_values_valid" CHECK (
    btrim("businessKey"::TEXT) <> '' AND
    btrim("description") <> '' AND
    ("quantity" IS NULL OR "quantity" > 0) AND
    ("unit" IS NULL OR btrim("unit") <> '') AND
    ("unitPrice" IS NULL OR "unitPrice" BETWEEN 0 AND 99999999.9999) AND
    ("suggestedAmount" IS NULL OR "suggestedAmount" BETWEEN 0 AND 9999999999.99) AND
    ("pricingSnapshot" IS NULL OR jsonb_typeof("pricingSnapshot") = 'object') AND
    ("overrideReason" IS NULL OR btrim("overrideReason") <> '') AND
    ("approvalReference" IS NULL OR btrim("approvalReference") <> '') AND
    (
      (
        "status" = 'PENDING_AMOUNT'::"OrderCustomerChargeStatus" AND
        NOT "isAdjustment" AND
        "amount" IS NULL AND
        "finalizedById" IS NULL AND
        "finalizedAt" IS NULL
      ) OR
      (
        "status" <> 'PENDING_AMOUNT'::"OrderCustomerChargeStatus" AND
        (
          (NOT "isAdjustment" AND "amount" BETWEEN 0 AND 9999999999.99) OR
          ("isAdjustment" AND "amount" BETWEEN -9999999999.99 AND 9999999999.99)
        ) AND
        ("status" <> 'WAIVED'::"OrderCustomerChargeStatus" OR "amount" = 0) AND
        (
          (
            "status" = 'ESTIMATED'::"OrderCustomerChargeStatus" AND
            "finalizedById" IS NULL AND
            "finalizedAt" IS NULL
          ) OR
          (
            "status" IN (
              'FINAL'::"OrderCustomerChargeStatus",
              'WAIVED'::"OrderCustomerChargeStatus"
            ) AND
            "finalizedById" IS NOT NULL AND
            "finalizedAt" IS NOT NULL
          )
        )
      )
    )
  );

COMMIT;
