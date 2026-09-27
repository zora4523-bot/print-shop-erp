-- Legacy links remain in history but are no longer accepted by the public
-- route. An administrator can issue a new token for an unexpired READY bundle.
-- No raw bearer credential is persisted for new links.
ALTER TABLE "DesignBundle"
  ADD COLUMN "zipObjectKey" TEXT,
  ADD COLUMN "accessTokenHash" TEXT,
  ADD COLUMN "downloadUrlCiphertext" TEXT,
  ADD COLUMN "revokedAt" TIMESTAMPTZ(3);

CREATE UNIQUE INDEX "DesignBundle_accessTokenHash_key"
  ON "DesignBundle"("accessTokenHash");

ALTER TABLE "DesignBundle" ADD CONSTRAINT "DesignBundle_token_hash_shape"
  CHECK ("accessTokenHash" IS NULL OR "accessTokenHash" ~ '^[a-f0-9]{64}$');
