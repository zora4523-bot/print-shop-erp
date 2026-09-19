-- Nullable components preserve already-published legacy prices unchanged.
ALTER TABLE "PieceworkPriceRule"
  ADD COLUMN "smallOrderAmount" DECIMAL(14,4),
  ADD COLUMN "setupAmount" DECIMAL(14,4),
  ADD CONSTRAINT "PieceworkPriceRule_foil_components_check" CHECK (
    ("smallOrderAmount" IS NULL AND "setupAmount" IS NULL)
    OR ("operationType" IN ('PARTIAL', 'FULL') AND "smallOrderAmount" IS NOT NULL
      AND "setupAmount" IS NOT NULL AND "smallOrderAmount" >= 0 AND "setupAmount" >= 0)
  );
