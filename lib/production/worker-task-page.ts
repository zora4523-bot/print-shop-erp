import { Prisma } from '@/generated/prisma/client';
import type { Role } from '@/generated/prisma/enums';
import { db } from '@/lib/db';
import { paginationWindow, paginatedResult, parsePositiveInt } from '@/lib/admin/table';
import { getReporterOperationTypeOrNull, listProductionOperationsForReporter, listProductionProgressForReporter } from './operation-portal';
import { assertWorkerPortalActor } from './worker-report-portal';

/** Page current-version IDs before hydrating report aggregates and design labels. */
export async function listWorkerTaskPage(actor: { id: string; role: Role }, filters: { view: 'paid' | 'progress'; q: string; page?: string }) {
  await assertWorkerPortalActor(actor);
  const lane = await getReporterOperationTypeOrNull(actor);
  if (filters.view === 'paid' && !lane) return { ...paginatedResult([], 0, paginationWindow(0, 1, 20)), operations: [], progressSteps: [] };
  const table = filters.view === 'paid' ? Prisma.sql`"ProductionOperation"` : Prisma.sql`"ProductionProgressStep"`;
  const q = `%${filters.q.trim().slice(0, 100).replace(/[\\%_]/g, '\\$&')}%`;
  const lanePredicate = filters.view === 'paid' ? Prisma.sql`AND step."operationType"::text = ${lane}` : Prisma.empty;
  const sourcePredicate = filters.view === 'paid'
    ? Prisma.sql`EXISTS (SELECT 1 FROM "ProductionOperationSource" src JOIN "OrderItem" item ON item.id=src."orderItemId" WHERE src."operationId"=step.id AND item.name ILIKE ${q})`
    : Prisma.sql`EXISTS (SELECT 1 FROM "OrderItem" item WHERE item.id=step."orderItemId" AND item.name ILIKE ${q})`;
  const where = Prisma.sql`step."workOrderVersion" = current_order."workOrderVersion"
    AND step.status::text IN ('PENDING', 'IN_PROGRESS')
    AND current_order.status::text IN ('RELEASED','FOILING','PACKING','SCHEDULING','IN_PRODUCTION')
    ${lanePredicate}
    AND (current_order."orderNo" ILIKE ${q} OR current_order."customName" ILIKE ${q} OR ${sourcePredicate})`;
  const result = await db.$transaction(async (tx) => {
    const counts = await tx.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`SELECT count(*) FROM ${table} step JOIN "Order" current_order ON current_order.id=step."orderId" WHERE ${where}`);
    const total = Number(counts[0]?.count ?? 0);
    const window = paginationWindow(total, parsePositiveInt(filters.page, { defaultValue: 1 }), 20);
    const ids = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT step.id FROM ${table} step JOIN "Order" current_order ON current_order.id=step."orderId" WHERE ${where} ORDER BY current_order."isUrgent" DESC, step."createdAt", step.id OFFSET ${window.skip} LIMIT ${window.take}`);
    return { ids: ids.map((row) => row.id), total, window };
  }, { isolationLevel: 'RepeatableRead' });
  const operations = filters.view === 'paid' && result.ids.length ? await listProductionOperationsForReporter(actor, result.ids) : [];
  const progressSteps = filters.view === 'progress' && result.ids.length ? await listProductionProgressForReporter(actor, result.ids) : [];
  return { ...paginatedResult(result.ids, result.total, result.window), operations, progressSteps };
}
