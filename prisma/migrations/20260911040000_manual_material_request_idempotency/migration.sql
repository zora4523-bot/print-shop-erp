-- Existing immutable ledger rows remain unchanged. Only new manual movements
-- record a request key and its canonical payload fingerprint.
ALTER TABLE "MaterialTransaction"
  ADD COLUMN "idempotencyKey" VARCHAR(128),
  ADD COLUMN "requestFingerprint" VARCHAR(64);

ALTER TABLE "MaterialTransaction"
  ADD CONSTRAINT "MaterialTransaction_manual_request_pair_check" CHECK (
    ("idempotencyKey" IS NULL AND "requestFingerprint" IS NULL)
    OR ("idempotencyKey" IS NOT NULL AND "requestFingerprint" IS NOT NULL
        AND "requestFingerprint" ~ '^[0-9a-f]{64}$')
  );

CREATE UNIQUE INDEX "MaterialTransaction_idempotencyKey_key"
  ON "MaterialTransaction"("idempotencyKey");
