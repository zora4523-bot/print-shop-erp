-- Add the WeCom Bot ID + Secret long-connection transport without replacing
-- the existing group-webhook transport. Existing channel IDs and delivery
-- ledger identities remain stable and are explicitly backfilled as webhook.

BEGIN;

CREATE TYPE "NotificationChannelTransport" AS ENUM (
  'WECOM_GROUP_WEBHOOK',
  'WECOM_SMART_BOT'
);

CREATE TYPE "NotificationSmartBotChatType" AS ENUM ('SINGLE', 'GROUP');

CREATE TYPE "SmartBotConnectionStatus" AS ENUM (
  'NOT_CONFIGURED',
  'CONNECTING',
  'CONNECTED',
  'DISCONNECTED',
  'AUTH_FAILED',
  'CONNECTION_CONFLICT'
);

ALTER TABLE "BackgroundWorkerHeartbeat"
  ADD COLUMN "smartBotStatus" "SmartBotConnectionStatus";

-- Only the LIGHT worker owns the WeCom long connection. Keep the column
-- nullable for pre-upgrade LIGHT heartbeats and for rolling compatibility,
-- while preventing a HEAVY worker from publishing a misleading bot state.
ALTER TABLE "BackgroundWorkerHeartbeat"
  ADD CONSTRAINT "BackgroundWorkerHeartbeat_smart_bot_queue_ck" CHECK (
    "queue" = 'LIGHT'::"BackgroundJobQueue" OR "smartBotStatus" IS NULL
  );

ALTER TABLE "NotificationChannel"
  ADD COLUMN "transport" "NotificationChannelTransport" NOT NULL
    DEFAULT 'WECOM_GROUP_WEBHOOK',
  ADD COLUMN "smartBotBotDigest" CHAR(64),
  ADD COLUMN "smartBotTargetId" TEXT,
  ADD COLUMN "smartBotChatType" "NotificationSmartBotChatType",
  ADD COLUMN "smartBotBoundAt" TIMESTAMPTZ(3),
  ADD COLUMN "smartBotBindingCodeHash" CHAR(64),
  ADD COLUMN "smartBotBindingExpiresAt" TIMESTAMPTZ(3),
  ALTER COLUMN "webhookUrl" DROP NOT NULL;

CREATE UNIQUE INDEX "NotificationChannel_smartBotBotDigest_smartBotTargetId_key"
  ON "NotificationChannel"("smartBotBotDigest", "smartBotTargetId");

ALTER TABLE "NotificationChannel"
  ADD CONSTRAINT "NotificationChannel_transport_shape_ck" CHECK (
    (
      "transport" = 'WECOM_GROUP_WEBHOOK'::"NotificationChannelTransport"
      AND "webhookUrl" IS NOT NULL
      AND "smartBotBotDigest" IS NULL
      AND "smartBotTargetId" IS NULL
      AND "smartBotChatType" IS NULL
      AND "smartBotBoundAt" IS NULL
      AND "smartBotBindingCodeHash" IS NULL
      AND "smartBotBindingExpiresAt" IS NULL
    )
    OR
    (
      "transport" = 'WECOM_SMART_BOT'::"NotificationChannelTransport"
      AND "webhookUrl" IS NULL
      AND (
        (
          "smartBotTargetId" IS NOT NULL
          AND "smartBotBotDigest" IS NOT NULL
          AND "smartBotChatType" IS NOT NULL
          AND "smartBotBoundAt" IS NOT NULL
          AND "smartBotBindingCodeHash" IS NULL
          AND "smartBotBindingExpiresAt" IS NULL
        )
        OR
        (
          "smartBotTargetId" IS NULL
          AND "smartBotBotDigest" IS NULL
          AND "smartBotChatType" IS NULL
          AND "smartBotBoundAt" IS NULL
          AND "isActive" = false
          AND (
            (
              "smartBotBindingCodeHash" IS NULL
              AND "smartBotBindingExpiresAt" IS NULL
            )
            OR
            (
              "smartBotBindingCodeHash" IS NOT NULL
              AND "smartBotBindingExpiresAt" IS NOT NULL
            )
          )
        )
      )
    )
  );

ALTER TABLE "NotificationLog"
  ADD COLUMN "destinationFingerprint" CHAR(64);

CREATE TABLE "NotificationSmartBotSendSlot" (
  "targetDigest" CHAR(64) NOT NULL,
  "nextAvailableAt" TIMESTAMPTZ(3) NOT NULL,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NotificationSmartBotSendSlot_pkey" PRIMARY KEY ("targetDigest")
);

CREATE INDEX "NotificationSmartBotSendSlot_updatedAt_idx"
  ON "NotificationSmartBotSendSlot"("updatedAt");

CREATE TABLE "NotificationSmartBotBindingReceipt" (
  "id" TEXT NOT NULL,
  "botDigest" CHAR(64) NOT NULL,
  "msgId" VARCHAR(128) NOT NULL,
  "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NotificationSmartBotBindingReceipt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NotificationSmartBotBindingReceipt_botDigest_msgId_key"
  ON "NotificationSmartBotBindingReceipt"("botDigest", "msgId");

CREATE INDEX "NotificationSmartBotBindingReceipt_receivedAt_idx"
  ON "NotificationSmartBotBindingReceipt"("receivedAt");

-- Raw chat IDs are provider-scoped destination identifiers and should not be
-- copied into support/demo exports. The Bot Secret remains outside PostgreSQL.
INSERT INTO app_ops.sensitive_column_policy (
  table_name,
  column_name,
  data_class,
  masking_strategy,
  anon_mask_expression,
  audit_scope,
  priority,
  rationale
)
VALUES (
  'NotificationChannel',
  'smartBotTargetId',
  'external_identifier',
  'manual_export_redact',
  NULL,
  'WRITE',
  83,
  'enterprise WeChat conversation id must not be copied into support datasets'
)
ON CONFLICT (table_schema, table_name, column_name) DO UPDATE
SET
  data_class = EXCLUDED.data_class,
  masking_strategy = EXCLUDED.masking_strategy,
  anon_mask_expression = EXCLUDED.anon_mask_expression,
  audit_scope = EXCLUDED.audit_scope,
  priority = EXCLUDED.priority,
  rationale = EXCLUDED.rationale,
  updated_at = now();

COMMIT;
