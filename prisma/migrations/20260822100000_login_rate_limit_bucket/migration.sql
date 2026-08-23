-- The public URL is not an authentication boundary for Next Server Actions:
-- Next can internally forward an action POST from another page to /login.
-- Keep the credential-attempt limit at the verifier itself and share its state
-- across every web process through PostgreSQL.
CREATE TABLE "LoginRateLimitBucket" (
  "key" TEXT NOT NULL,
  "theoreticalArrivalAt" TIMESTAMPTZ(3) NOT NULL,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "LoginRateLimitBucket_pkey" PRIMARY KEY ("key")
);

CREATE INDEX "LoginRateLimitBucket_updatedAt_idx"
  ON "LoginRateLimitBucket"("updatedAt");
