-- CreateTable
CREATE TABLE "ProductionReportDispute" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "status" "ProductionTaskDisputeStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT NOT NULL,
    "resolution" TEXT,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionReportDispute_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductionReportDispute_reportId_createdAt_idx" ON "ProductionReportDispute"("reportId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ProductionReportDispute_status_createdAt_idx" ON "ProductionReportDispute"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ProductionReportDispute_resolvedById_idx" ON "ProductionReportDispute"("resolvedById");

-- AddForeignKey
ALTER TABLE "ProductionReportDispute" ADD CONSTRAINT "ProductionReportDispute_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "ProductionReport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionReportDispute" ADD CONSTRAINT "ProductionReportDispute_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


CREATE UNIQUE INDEX "ProductionReportDispute_one_pending_per_report"
ON "ProductionReportDispute"("reportId") WHERE "status" = 'PENDING';
ALTER TABLE "ProductionReportDispute" ADD CONSTRAINT "ProductionReportDispute_reason_check"
CHECK (char_length(btrim("reason")) BETWEEN 5 AND 1000);
ALTER TABLE "ProductionReportDispute" ADD CONSTRAINT "ProductionReportDispute_resolution_check"
CHECK (("status" = 'PENDING' AND "resolution" IS NULL AND "resolvedById" IS NULL AND "resolvedAt" IS NULL)
OR ("status" IN ('RESOLVED', 'REJECTED') AND "resolution" IS NOT NULL AND char_length(btrim("resolution")) BETWEEN 2 AND 1000 AND "resolvedById" IS NOT NULL AND "resolvedAt" IS NOT NULL));
CREATE FUNCTION protect_production_report_dispute_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'ProductionReportDispute history cannot be deleted';
  END IF;
  IF OLD."status" <> 'PENDING' OR NEW."id" <> OLD."id" OR NEW."reportId" <> OLD."reportId"
    OR NEW."reason" <> OLD."reason" OR NEW."createdAt" <> OLD."createdAt" THEN
    RAISE EXCEPTION 'ProductionReportDispute history is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "ProductionReportDispute_protect_history" BEFORE UPDATE OR DELETE ON "ProductionReportDispute"
FOR EACH ROW EXECUTE FUNCTION protect_production_report_dispute_history();
