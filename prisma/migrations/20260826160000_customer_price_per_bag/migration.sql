-- PostgreSQL enum values must be committed before a later migration can use
-- them in persisted rows. Keep this migration intentionally separate from the
-- structural/data upgrade that follows.
ALTER TYPE "CustomerPriceCalculationType" ADD VALUE IF NOT EXISTS 'PER_BAG';
