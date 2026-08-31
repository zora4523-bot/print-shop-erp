import Decimal from 'decimal.js';
import { Prisma } from '../../generated/prisma/client';
import { db } from '../db';
import { parseStrictYmd } from '../auth/schemas';
import { databaseNow } from '../background-jobs/clock';
import { backgroundJobsMode } from '../background-jobs/mode';
import { formatMoneyPlain } from '../dashboard/format';
import { isFutureShanghaiDate } from '../dashboard/shanghai-clock';
import {
  assertExecutionFence,
  type ExecutionFence,
} from '../execution-fence';
import type { NotificationPayloadFor } from '../notification/events';
import { enqueueNotificationInTransaction } from '../notification/transactional-outbox';
import {
  findDailySalaryRoster,
  parseDailySalaryRoster,
  type DailySalaryRosterEntry,
} from '../salary/daily-roster';

export const dailySalaryNotificationKey = (date: string) =>
  // v1 could contain only the settled subset while worker-level business
  // errors were present. v2 is paired with DailySalaryCronRun's durable roster
  // and completion checkpoint, so an old partial notification is never treated
  // as proof that the new all-or-error batch completed.
  `notification:DAILY_WORKER_SALARY:v2:${date}`;

type DailySalaryPayload = NotificationPayloadFor<'DAILY_WORKER_SALARY'>;

export type DailySalarySummary = DailySalaryPayload & {
  notificationQueued: boolean;
};

/** Persist the first durable attempt's roster before any salary row is written. */
export async function getOrCreateDailySalaryRoster(
  date: string,
  fence?: ExecutionFence,
): Promise<DailySalaryRosterEntry[]> {
  const dateCol = assertSettleableDate(date);
  if (backgroundJobsMode() !== 'durable') {
    return findDailySalaryRoster(date);
  }

  return db.$transaction(async (tx) => {
    const existing = await tx.dailySalaryCronRun.findUnique({
      where: { date: dateCol },
      select: { roster: true },
    });
    if (existing) return parseDailySalaryRoster(existing.roster);

    await assertExecutionFence(fence);
    const candidate = await findDailySalaryRoster(date, tx);
    const roster = parseDailySalaryRoster(candidate);
    await assertExecutionFence(fence);
    await tx.dailySalaryCronRun.createMany({
      data: [
        {
          date: dateCol,
          roster: JSON.parse(JSON.stringify(roster)) as Prisma.InputJsonValue,
        },
      ],
      skipDuplicates: true,
    });
    const stored = await tx.dailySalaryCronRun.findUnique({
      where: { date: dateCol },
      select: { roster: true },
    });
    if (!stored) {
      throw new DailySalarySummaryInvariantError(
        'daily salary roster insert was not observable',
      );
    }
    return parseDailySalaryRoster(stored.roster);
  });
}

/**
 * The run row—not mere notification-job existence—is the completion proof.
 * This avoids mistaking a historical v1 partial notification for a completed
 * salary batch after a parent worker crash.
 */
export async function readDailySalaryRunCheckpoint(
  date: string,
): Promise<DailySalaryPayload | null> {
  const dateCol = assertSettleableDate(date);
  if (backgroundJobsMode() !== 'durable') return null;

  const run = await db.dailySalaryCronRun.findUnique({
    where: { date: dateCol },
    select: {
      completedAt: true,
      summaryWorkerCount: true,
      summaryTotalAmount: true,
      notificationDedupeKey: true,
    },
  });
  if (!run || run.completedAt === null) return null;
  if (
    run.summaryWorkerCount === null ||
    run.summaryWorkerCount < 0 ||
    run.summaryTotalAmount === null ||
    run.notificationDedupeKey !== dailySalaryNotificationKey(date)
  ) {
    throw new DailySalarySummaryInvariantError(
      'completed daily salary checkpoint is malformed',
    );
  }
  return {
    date,
    workerCount: run.summaryWorkerCount,
    totalAmount: formatMoneyPlain(run.summaryTotalAmount),
  };
}

/**
 * Re-read the finance rows for the frozen roster, enqueue the notification,
 * and mark the cron run complete in one short transaction. A crash can leave
 * either all three effects committed or none of them.
 */
export async function prepareDailySalarySummary(
  date: string,
  fixedRoster: readonly DailySalaryRosterEntry[],
  fence?: ExecutionFence,
): Promise<DailySalarySummary> {
  const dateCol = assertSettleableDate(date);
  const roster = parseDailySalaryRoster(fixedRoster);
  const workerIds = roster.map((entry) => entry.workerId);
  const durable = backgroundJobsMode() === 'durable';

  return db.$transaction(async (tx) => {
    if (durable) {
      const run = await tx.dailySalaryCronRun.findUnique({
        where: { date: dateCol },
        select: {
          roster: true,
          completedAt: true,
          summaryWorkerCount: true,
          summaryTotalAmount: true,
          notificationDedupeKey: true,
        },
      });
      if (!run) {
        throw new DailySalarySummaryInvariantError(
          'daily salary summary has no durable roster',
        );
      }
      assertSameRoster(run.roster, roster);
      if (run.completedAt !== null) {
        if (
          run.summaryWorkerCount === null ||
          run.summaryTotalAmount === null ||
          run.notificationDedupeKey !== dailySalaryNotificationKey(date)
        ) {
          throw new DailySalarySummaryInvariantError(
            'completed daily salary checkpoint is malformed',
          );
        }
        return {
          date,
          workerCount: run.summaryWorkerCount,
          totalAmount: formatMoneyPlain(run.summaryTotalAmount),
          notificationQueued: true,
        };
      }
    }

    await assertExecutionFence(fence);
    const rows = await tx.dailyWorkerSalary.findMany({
      where: { date: dateCol, workerId: { in: workerIds } },
      select: { workerId: true, actualSalary: true },
    });
    assertCompleteRosterRows(roster, rows);
    const total = rows.reduce<Decimal>(
      (sum, row) => sum.plus(new Decimal(row.actualSalary)),
      new Decimal(0),
    );
    const payload: DailySalaryPayload = {
      date,
      workerCount: rows.length,
      totalAmount: formatMoneyPlain(total),
    };

    await assertExecutionFence(fence);
    const notificationQueued =
      rows.length > 0
        ? await enqueueNotificationInTransaction(
            tx,
            'DAILY_WORKER_SALARY',
            payload,
            { dedupeKey: dailySalaryNotificationKey(date) },
          )
        : false;

    if (durable) {
      if (rows.length > 0 && !notificationQueued) {
        throw new DailySalarySummaryInvariantError(
          'durable daily salary notification was not queued',
        );
      }
      const completedAt = await databaseNow(tx);
      const completed = await tx.dailySalaryCronRun.updateMany({
        where: { date: dateCol, completedAt: null },
        data: {
          completedAt,
          summaryWorkerCount: rows.length,
          summaryTotalAmount: total.toFixed(2),
          notificationDedupeKey: dailySalaryNotificationKey(date),
        },
      });
      if (completed.count !== 1) {
        throw new DailySalarySummaryInvariantError(
          'daily salary completion checkpoint lost its generation',
        );
      }
    }

    return { ...payload, notificationQueued };
  });
}

function assertCompleteRosterRows(
  roster: readonly DailySalaryRosterEntry[],
  rows: readonly { workerId: string }[],
): void {
  const expected = new Set(roster.map((entry) => entry.workerId));
  if (
    rows.length !== expected.size ||
    rows.some((row) => !expected.delete(row.workerId)) ||
    expected.size !== 0
  ) {
    throw new DailySalarySummaryInvariantError(
      'daily salary rows do not exactly cover the frozen roster',
    );
  }
}

function assertSameRoster(
  stored: Prisma.JsonValue,
  expected: readonly DailySalaryRosterEntry[],
): void {
  const parsed = parseDailySalaryRoster(stored);
  if (JSON.stringify(parsed) !== JSON.stringify(expected)) {
    throw new DailySalarySummaryInvariantError(
      'daily salary roster changed after the run started',
    );
  }
}

function assertSettleableDate(date: string): Date {
  const dateCol = parseStrictYmd(date);
  if (!dateCol) {
    throw new DailySalarySummaryInvariantError('invalid daily salary date');
  }
  if (isFutureShanghaiDate(date)) {
    throw new DailySalarySummaryInvariantError(
      'future daily salary date cannot have a completion checkpoint',
    );
  }
  return dateCol;
}

export class DailySalarySummaryInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DailySalarySummaryInvariantError';
  }
}
