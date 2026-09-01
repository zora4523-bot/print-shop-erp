import type { Prisma } from '../../generated/prisma/client';
import { db } from '../db';

type RetentionClient = Pick<Prisma.TransactionClient, '$executeRaw'>;

export async function scrubAgentMonthlyBillExportFiltersForBackgroundJob(
  backgroundJobId: string,
  client: RetentionClient = db,
): Promise<number> {
  return client.$executeRaw`
    UPDATE "AgentMonthlyBillExport"
       SET "filters" = '{}'::jsonb,
           "updatedAt" = NOW()
     WHERE "backgroundJobId" = ${backgroundJobId}
       AND "status" = 'FAILED'::"AgentMonthlyBillExportStatus"
       AND "filters" IS DISTINCT FROM '{}'::jsonb
  `;
}

export async function scrubTerminalAgentMonthlyBillExportFilters(
  client: RetentionClient = db,
): Promise<number> {
  return client.$executeRaw`
    UPDATE "AgentMonthlyBillExport"
       SET "filters" = '{}'::jsonb,
           "updatedAt" = NOW()
     WHERE "status" IN (
       'READY'::"AgentMonthlyBillExportStatus",
       'FAILED'::"AgentMonthlyBillExportStatus",
       'EXPIRED'::"AgentMonthlyBillExportStatus"
     )
       AND "filters" IS DISTINCT FROM '{}'::jsonb
  `;
}
