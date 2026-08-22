-- A22: Business audit log standardization.
--
-- This table is application-level business audit evidence. It complements
-- Pigsty/pgaudit database logging and does not replace existing domain logs
-- such as OrderLog or NotificationLog.

CREATE TABLE "BusinessAuditLog" (
  "id" TEXT NOT NULL,
  "actorId" TEXT,
  "actorRole" "Role",
  "actorUsername" TEXT,
  "actorDisplayName" TEXT,
  "action" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "before" JSONB,
  "after" JSONB,
  "diff" JSONB,
  "requestMetadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "BusinessAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BusinessAuditLog_actorId_idx" ON "BusinessAuditLog"("actorId");
CREATE INDEX "BusinessAuditLog_action_idx" ON "BusinessAuditLog"("action");
CREATE INDEX "BusinessAuditLog_entityType_entityId_idx"
  ON "BusinessAuditLog"("entityType", "entityId");
CREATE INDEX "BusinessAuditLog_createdAt_idx" ON "BusinessAuditLog"("createdAt");

ALTER TABLE "BusinessAuditLog"
  ADD CONSTRAINT "BusinessAuditLog_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
