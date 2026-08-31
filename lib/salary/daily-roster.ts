import type { Prisma } from '../../generated/prisma/client';
import {
  MachineType,
  Role,
  WorkerType,
} from '../../generated/prisma/enums';
import { db } from '../db';
import { parseStrictYmd } from '../auth/schemas';
import { DailySalaryError, shanghaiDayRange } from './daily-common';

export type DailySalaryRosterEntry = {
  workerId: string;
  workerName: string;
  /** Machine eligibility frozen before the first durable cron write. */
  eligibleMachineType: MachineType | null;
};

type DailyRosterClient = Pick<Prisma.TransactionClient, 'user'>;

/**
 * Resolves the authoritative worker set at one instant. Durable cron stores
 * this result before writing any salary row; owner-initiated recomputes call it
 * afresh so a deliberate later backfill can include newly reported workers.
 */
export async function findDailySalaryRoster(
  date: string,
  client: DailyRosterClient = db,
): Promise<DailySalaryRosterEntry[]> {
  const { start, end } = shanghaiDayRange(date);
  const dateCol = parseStrictYmd(date)!;
  const workers = await client.user.findMany({
    where: {
      OR: [
        {
          role: Role.WORKER,
          workerType: WorkerType.MACHINE,
          isActive: true,
          machineType: { not: null },
        },
        {
          assignedTasks: {
            some: {
              status: 'COMPLETED',
              completedAt: { gte: start, lt: end },
              OR: [
                { workerType: WorkerType.MACHINE },
                // Legacy machine tasks may predate workerType while still
                // carrying their machine snapshot. Include them so the
                // single-worker path emits an explicit reconciliation error.
                { workerType: null, machineType: { not: null } },
              ],
            },
          },
        },
        // Committed rows from an earlier attempt remain in the roster even if
        // the account was subsequently deactivated.
        { dailyWorkerSalaries: { some: { date: dateCol } } },
      ],
    },
    select: {
      id: true,
      displayName: true,
      role: true,
      workerType: true,
      isActive: true,
      machineType: true,
    },
    orderBy: { id: 'asc' },
  });
  return workers.map((worker) => ({
    workerId: worker.id,
    workerName: worker.displayName,
    eligibleMachineType:
      worker.role === Role.WORKER &&
      worker.workerType === WorkerType.MACHINE &&
      worker.isActive
        ? worker.machineType
        : null,
  }));
}

export function parseDailySalaryRoster(
  value: unknown,
): DailySalaryRosterEntry[] {
  if (!Array.isArray(value)) {
    throw new DailySalaryError('持久化日薪 roster 非法，已拒绝继续结算');
  }
  const seen = new Set<string>();
  return value.map((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new DailySalaryError('持久化日薪 roster 非法，已拒绝继续结算');
    }
    const entry = raw as Partial<DailySalaryRosterEntry>;
    const eligibleMachineType = entry.eligibleMachineType;
    const validMachineType =
      eligibleMachineType === null ||
      (typeof eligibleMachineType === 'string' &&
        Object.values(MachineType).includes(
          eligibleMachineType as MachineType,
        ));
    if (
      typeof entry.workerId !== 'string' ||
      entry.workerId.length === 0 ||
      typeof entry.workerName !== 'string' ||
      entry.workerName.length === 0 ||
      !validMachineType ||
      seen.has(entry.workerId)
    ) {
      throw new DailySalaryError('持久化日薪 roster 非法，已拒绝继续结算');
    }
    seen.add(entry.workerId);
    return {
      workerId: entry.workerId,
      workerName: entry.workerName,
      eligibleMachineType: eligibleMachineType as MachineType | null,
    };
  });
}
