-- One database row coordinates every process and event that targets the same
-- real WeCom bot. Only a one-way SHA-256 digest of the fixed endpoint plus its
-- decoded key is stored here; equivalent URL encodings share one bucket while
-- the webhook URL remains solely in NotificationChannel.
CREATE TABLE "NotificationWebhookSendSlot" (
  "webhookDigest" CHAR(64) NOT NULL,
  "nextAvailableAt" TIMESTAMPTZ(3) NOT NULL,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "NotificationWebhookSendSlot_pkey"
    PRIMARY KEY ("webhookDigest"),
  CONSTRAINT "NotificationWebhookSendSlot_digest_check"
    CHECK ("webhookDigest" ~ '^[0-9a-f]{64}$')
);

CREATE INDEX "NotificationWebhookSendSlot_updatedAt_idx"
  ON "NotificationWebhookSendSlot"("updatedAt");
