import type { Prisma } from '@/generated/prisma/client';
import { DAILY_MINIMUM } from './daily-minimum';

/** Use the immutable attendance identity, including workers who later changed roles. */
export async function dailyMinimumAttendance(tx: Pick<Prisma.TransactionClient, 'attendance'>, workDate: string, workerId?: string) {
  if (workDate < DAILY_MINIMUM.effectiveFrom) return [];
  return tx.attendance.findMany({
    where: { date: new Date(`${workDate}T00:00:00Z`), roleSnapshot: 'WORKER', workerTypeSnapshot: { not: null },
      identitySnapshotVerified: true, workUnits: { gt: 0 }, ...(workerId ? { workerId } : {}) },
    select: { id: true, workerId: true, workUnits: true, roleSnapshot: true, workerTypeSnapshot: true,
      worker: { select: { displayName: true, username: true } } },
  });
}
