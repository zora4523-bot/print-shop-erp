import type { Prisma } from '@/generated/prisma/client';
import { hasPermission } from '@/lib/auth/permissions-dict';

export const WAREHOUSE_CONFIGURATION_LOCK = 'print-shop-erp:warehouse-configuration';

export class WarehouseInvariantError extends Error {
  constructor(message: string) { super(message); this.name = 'WarehouseInvariantError'; }
}

/** First lock of every inventory transaction. Never upgrade a shared lock. */
export async function acquireWarehouseStockLock(tx: Pick<Prisma.TransactionClient, '$executeRaw'>) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtextextended(${WAREHOUSE_CONFIGURATION_LOCK}, 0))`;
}

/** Configuration writers enter exclusively before reading availability or stock. */
export async function acquireWarehouseConfigurationLock(tx: Pick<Prisma.TransactionClient, '$executeRaw'>) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${WAREHOUSE_CONFIGURATION_LOCK}, 0))`;
}

export async function requireWarehouseActor(tx: Prisma.TransactionClient, actorId: string) {
  const actor = await tx.user.findUnique({ where: { id: actorId }, select: {
    id: true, role: true, username: true, displayName: true, isActive: true,
  } });
  if (!actor?.isActive || !hasPermission('warehouse:manage', actor.role)) {
    throw new WarehouseInvariantError('当前账号无权维护仓库，请重新登录有权限的账号');
  }
  return actor;
}
