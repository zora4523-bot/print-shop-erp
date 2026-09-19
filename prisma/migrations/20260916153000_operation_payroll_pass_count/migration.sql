-- AlterTable
ALTER TABLE "ProductionOperation" ADD COLUMN     "payrollPassCount" INTEGER,
ADD COLUMN     "payrollRevision" INTEGER NOT NULL DEFAULT 0;

-- Nullable preserves the existing colour-derived default without changing history.
ALTER TABLE "ProductionOperation" ADD CONSTRAINT "ProductionOperation_payroll_pass_check"
CHECK ("payrollRevision" >= 0 AND ("payrollPassCount" IS NULL OR
  ("operationType" = 'PARTIAL' AND "payrollPassCount" BETWEEN 1 AND 999)));
