import { db } from '@/lib/db';
import { parseStrictYmd } from '@/lib/auth/schemas';
import { DailySalaryError } from './daily-common';
import { findDailySalaryRoster } from './daily-roster';

export type DailySalaryRecomputeImpact = {
  candidateWorkerCount: number;
  affectedWorkerCount: number;
  createCount: number;
  overwriteUnpaidCount: number;
  paidSkippedCount: number;
};

/**
 * Read-only confirmation summary for the owner's L3 recompute action.
 * It deliberately does not predict amounts or run salary rules. The actual
 * write path re-checks paid rows under its existing per-worker locks, so a row
 * becoming paid after this preview is still skipped safely.
 */
export async function getDailySalaryRecomputeImpact(
  date: string,
  workerId?: string,
): Promise<DailySalaryRecomputeImpact> {
  const dateCol = parseStrictYmd(date);
  if (!dateCol) throw new DailySalaryError('日期不是合法日历日期');

  const workerIds = workerId
    ? [workerId]
    : (await findDailySalaryRoster(date)).map((worker) => worker.workerId);
  if (workerIds.length === 0) {
    return {
      candidateWorkerCount: 0,
      affectedWorkerCount: 0,
      createCount: 0,
      overwriteUnpaidCount: 0,
      paidSkippedCount: 0,
    };
  }

  const existing = await db.dailyWorkerSalary.findMany({
    where: {
      date: dateCol,
      workerId: { in: workerIds },
    },
    select: { workerId: true, isPaid: true },
  });
  const existingByWorker = new Map(
    existing.map((row) => [row.workerId, row.isPaid] as const),
  );
  const paidSkippedCount = workerIds.filter(
    (id) => existingByWorker.get(id) === true,
  ).length;
  const overwriteUnpaidCount = workerIds.filter(
    (id) => existingByWorker.get(id) === false,
  ).length;
  const createCount = workerIds.filter(
    (id) => !existingByWorker.has(id),
  ).length;

  return {
    candidateWorkerCount: workerIds.length,
    affectedWorkerCount: createCount + overwriteUnpaidCount,
    createCount,
    overwriteUnpaidCount,
    paidSkippedCount,
  };
}
