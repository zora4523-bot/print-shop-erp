-- Durable PostgreSQL-backed job ledger. This deliberately stays inside the
-- existing Pigsty database: no Redis or external message broker is required.

CREATE TYPE "BackgroundJobQueue" AS ENUM ('LIGHT', 'HEAVY');
CREATE TYPE "BackgroundJobStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'DEAD', 'CANCELLED');
CREATE TYPE "BackgroundJobAttemptStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED', 'ABANDONED');
CREATE TYPE "DesignBundleStatus" AS ENUM ('PENDING', 'READY', 'FAILED');

CREATE TABLE "BackgroundJob" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "queue" "BackgroundJobQueue" NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "result" JSONB,
    "status" "BackgroundJobStatus" NOT NULL DEFAULT 'PENDING',
    "priority" INTEGER NOT NULL DEFAULT 100,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedBy" TEXT,
    "lockedAt" TIMESTAMP(3),
    "heartbeatAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "lastErrorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BackgroundJob_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "BackgroundJob_attempts_check" CHECK ("attempts" >= 0),
    CONSTRAINT "BackgroundJob_maxAttempts_check" CHECK ("maxAttempts" > 0)
);

CREATE TABLE "BackgroundJobAttempt" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "workerId" TEXT NOT NULL,
    "status" "BackgroundJobAttemptStatus" NOT NULL DEFAULT 'RUNNING',
    "errorCode" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,

    CONSTRAINT "BackgroundJobAttempt_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "BackgroundJobAttempt_attempt_check" CHECK ("attempt" > 0),
    CONSTRAINT "BackgroundJobAttempt_duration_check" CHECK ("durationMs" IS NULL OR "durationMs" >= 0)
);

CREATE TABLE "BackgroundWorkerHeartbeat" (
    "workerId" TEXT NOT NULL,
    "queue" "BackgroundJobQueue" NOT NULL,
    "version" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BackgroundWorkerHeartbeat_pkey" PRIMARY KEY ("workerId")
);

CREATE UNIQUE INDEX "BackgroundJob_dedupeKey_key" ON "BackgroundJob"("dedupeKey");
CREATE INDEX "BackgroundJob_queue_status_priority_availableAt_idx"
    ON "BackgroundJob"("queue", "status", "priority", "availableAt");
CREATE INDEX "BackgroundJob_status_createdAt_idx" ON "BackgroundJob"("status", "createdAt");
CREATE INDEX "BackgroundJob_lockedAt_idx" ON "BackgroundJob"("lockedAt");
CREATE UNIQUE INDEX "BackgroundJobAttempt_jobId_attempt_key"
    ON "BackgroundJobAttempt"("jobId", "attempt");
CREATE INDEX "BackgroundJobAttempt_status_startedAt_idx"
    ON "BackgroundJobAttempt"("status", "startedAt");
CREATE INDEX "BackgroundWorkerHeartbeat_queue_lastSeenAt_idx"
    ON "BackgroundWorkerHeartbeat"("queue", "lastSeenAt");

ALTER TABLE "BackgroundJobAttempt"
    ADD CONSTRAINT "BackgroundJobAttempt_jobId_fkey"
    FOREIGN KEY ("jobId") REFERENCES "BackgroundJob"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DesignBundle"
    ADD COLUMN "status" "DesignBundleStatus" NOT NULL DEFAULT 'PENDING',
    ADD COLUMN "backgroundJobId" TEXT,
    ADD COLUMN "lastErrorCode" TEXT;

-- Existing bundles were produced synchronously and are already complete.
UPDATE "DesignBundle" SET "status" = 'READY'::"DesignBundleStatus";

CREATE UNIQUE INDEX "DesignBundle_backgroundJobId_key"
    ON "DesignBundle"("backgroundJobId");
CREATE INDEX "DesignBundle_status_createdAt_idx"
    ON "DesignBundle"("status", "createdAt");
