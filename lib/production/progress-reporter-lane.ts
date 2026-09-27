import type { Prisma } from '../../generated/prisma/client';
import { WorkerType } from '../../generated/prisma/enums';
import type { OperationReporterAccount } from './reporter-operation-lane';

/** Progress follows the craft's configured job/machine lane, not personal assignments. */
export async function progressCraftIdsForReporter(
  client: Pick<Prisma.TransactionClient, 'craft'>,
  account: OperationReporterAccount,
): Promise<string[]> {
  if (account.role !== 'WORKER' || !account.isActive || !account.workerType) return [];
  if (account.workerType === WorkerType.MACHINE && !account.machineType) return [];
  const rows = await client.craft.findMany({
    where: {
      isActive: true,
      isOutsource: false,
      defaultWorkerType: account.workerType,
      ...(account.workerType === WorkerType.MACHINE ? {
        OR: [
          { inHouseMachineTypes: { has: account.machineType! } },
          { inHouseMachineTypes: { isEmpty: true }, defaultMachineType: account.machineType },
        ],
      } : {}),
    },
    select: { id: true },
  });
  return rows.map(row => row.id);
}
