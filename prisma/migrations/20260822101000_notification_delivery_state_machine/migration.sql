-- A uniqueness constraint on a post-send log cannot prevent duplicate external
-- delivery. Reserve each (deliveryKey, channelId) before HTTP, fence the owner
-- with a random attempt token, and make ambiguous outcomes explicit.
ALTER TYPE "NotificationStatus" ADD VALUE IF NOT EXISTS 'SENDING';
ALTER TYPE "NotificationStatus" ADD VALUE IF NOT EXISTS 'UNKNOWN';

ALTER TABLE "NotificationLog"
  ADD COLUMN "deliveryAttemptId" TEXT,
  ADD COLUMN "deliveryJobAttempt" INTEGER,
  ADD COLUMN "deliveryStateVersion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastAttemptAt" TIMESTAMP(3),
  ADD COLUMN "updatedAt" TIMESTAMP(3);

UPDATE "NotificationLog"
SET
  "lastAttemptAt" = COALESCE("sentAt", "createdAt"),
  "updatedAt" = "createdAt";

ALTER TABLE "NotificationLog"
  ALTER COLUMN "lastAttemptAt" SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "lastAttemptAt" SET NOT NULL,
  ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "updatedAt" SET NOT NULL;

CREATE INDEX "NotificationLog_status_lastAttemptAt_idx"
  ON "NotificationLog"("status", "lastAttemptAt");
