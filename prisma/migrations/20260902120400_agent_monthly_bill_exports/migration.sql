-- Independent durable export ledger for v2 agent monthly bills. This is an
-- additive migration and deliberately does not reuse or reinterpret
-- OrderExport / OrderExportStatus.

CREATE TYPE "AgentMonthlyBillExportStatus" AS ENUM (
  'PENDING',
  'READY',
  'FAILED',
  'EXPIRED'
);

CREATE TABLE "AgentMonthlyBillExport" (
  "id" TEXT NOT NULL,
  "requestKey" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "filters" JSONB NOT NULL,
  "snapshotAt" TIMESTAMPTZ(3) NOT NULL,
  "schemaVersion" INTEGER NOT NULL DEFAULT 1,
  "status" "AgentMonthlyBillExportStatus" NOT NULL DEFAULT 'PENDING',
  "backgroundJobId" TEXT,
  "matchedBillCount" INTEGER NOT NULL DEFAULT 0,
  "rowCounts" JSONB,
  "artifactName" TEXT,
  "fileName" TEXT NOT NULL,
  "byteSize" BIGINT,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "downloadCount" INTEGER NOT NULL DEFAULT 0,
  "lastErrorCode" TEXT,
  "completedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "AgentMonthlyBillExport_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AgentMonthlyBillExport_counters_check" CHECK (
    "schemaVersion" >= 1
    AND "matchedBillCount" >= 0
    AND "downloadCount" >= 0
    AND ("byteSize" IS NULL OR "byteSize" >= 0)
  ),
  CONSTRAINT "AgentMonthlyBillExport_time_check" CHECK (
    "expiresAt" > "snapshotAt"
    AND ("completedAt" IS NULL OR "completedAt" >= "snapshotAt")
  ),
  CONSTRAINT "AgentMonthlyBillExport_state_shape_check" CHECK (
    (
      "status" = 'PENDING'::"AgentMonthlyBillExportStatus"
      AND "artifactName" IS NULL
      AND "byteSize" IS NULL
      AND "completedAt" IS NULL
    )
    OR (
      "status" = 'READY'::"AgentMonthlyBillExportStatus"
      AND "artifactName" IS NOT NULL
      AND "byteSize" IS NOT NULL
      AND "completedAt" IS NOT NULL
      AND "lastErrorCode" IS NULL
    )
    OR (
      "status" = 'FAILED'::"AgentMonthlyBillExportStatus"
      AND "artifactName" IS NULL
      AND "byteSize" IS NULL
    )
    OR "status" = 'EXPIRED'::"AgentMonthlyBillExportStatus"
  )
);

CREATE UNIQUE INDEX "AgentMonthlyBillExport_requestKey_key"
  ON "AgentMonthlyBillExport"("requestKey");
CREATE UNIQUE INDEX "AgentMonthlyBillExport_backgroundJobId_key"
  ON "AgentMonthlyBillExport"("backgroundJobId");
CREATE INDEX "AgentMonthlyBillExport_createdById_createdAt_idx"
  ON "AgentMonthlyBillExport"("createdById", "createdAt" DESC);
CREATE INDEX "AgentMonthlyBillExport_status_createdAt_idx"
  ON "AgentMonthlyBillExport"("status", "createdAt" DESC);
CREATE INDEX "AgentMonthlyBillExport_expiresAt_idx"
  ON "AgentMonthlyBillExport"("expiresAt");

ALTER TABLE "AgentMonthlyBillExport"
  ADD CONSTRAINT "AgentMonthlyBillExport_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
