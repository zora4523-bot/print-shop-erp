import type { Prisma } from '../../generated/prisma/client';
import {
  OrderStatus,
  ProductionOperationStatus,
  Role,
} from '../../generated/prisma/enums';
import { db } from '../db';
import { operationTypeForReporterAccount } from '../production/reporter-operation-lane';

export type PrintActor = { id: string; role: Role };

/** Shared by the browser sheet, its metadata and inline/background PDFs. */
export async function getOrderPrintScope(
  orderId: string,
  actor: PrintActor,
  // 打印记录在持有工单锁的事务里读取，须用同一事务客户端，不另占连接（业主 2026-10-02 点打印即记已打印）。
  client: Pick<Prisma.TransactionClient, 'user' | 'order'> = db,
): Promise<Prisma.OrderWhereInput | null> {
  if (actor.role !== Role.ADMIN && actor.role !== Role.WORKER) return null;

  // Background jobs carry an old actor snapshot. Recheck the account instead
  // of trusting a role that may have changed while the job was queued.
  const account = await client.user.findUnique({
    where: { id: actor.id },
    select: {
      role: true,
      isActive: true,
      workerType: true,
      machineType: true,
    },
  });
  if (!account?.isActive || account.role !== actor.role) return null;
  if (actor.role === Role.ADMIN) return { id: orderId };

  const current = await client.order.findFirst({
    where: { id: orderId, status: { not: OrderStatus.SUBMITTED } },
    select: { workOrderVersion: true, simpleProduction: true },
  });
  if (!current) return null;
  if (current.simpleProduction) return { id: orderId, productionJobs: { some: { workerId: actor.id, workOrderVersion: current.workOrderVersion } } };

  const operationType = operationTypeForReporterAccount(account);
  const currentStep = {
    workOrderVersion: current.workOrderVersion,
    status: { not: ProductionOperationStatus.CANCELLED },
  };
  return {
    id: orderId,
    workOrderVersion: current.workOrderVersion,
    status: { not: OrderStatus.SUBMITTED },
    OR: [
      ...(operationType
        ? [{ productionOperations: { some: { ...currentStep, operationType } } }]
        : []),
      // Public progress is available to every active worker, as in the
      // current reporting portal; paid operations use the fixed account lane.
      { productionProgressSteps: { some: currentStep } },
    ],
  };
}

export async function getOrderPrintTitleRef(id: string, actor: PrintActor) {
  const where = await getOrderPrintScope(id, actor);
  if (!where) return null;
  return db.order.findFirst({ where, select: { orderNo: true } });
}
