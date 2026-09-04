BEGIN;

ALTER TABLE "BackgroundWorkerHeartbeat"
  ADD COLUMN "smartBotBotDigest" CHAR(64);

ALTER TABLE "BackgroundWorkerHeartbeat"
  DROP CONSTRAINT "BackgroundWorkerHeartbeat_smart_bot_queue_ck",
  ADD CONSTRAINT "BackgroundWorkerHeartbeat_smart_bot_queue_ck" CHECK (
    "queue" = 'LIGHT'::"BackgroundJobQueue"
    OR (
      "smartBotStatus" IS NULL
      AND "smartBotBotDigest" IS NULL
    )
  ),
  ADD CONSTRAINT "BackgroundWorkerHeartbeat_smart_bot_digest_ck" CHECK (
    "smartBotBotDigest" IS NULL
    OR "smartBotBotDigest" ~ '^[0-9a-f]{64}$'
  );

COMMIT;
