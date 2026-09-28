import type { Prisma } from '@/generated/prisma/client';
import { hasPermission } from '@/lib/auth/permissions-dict';
import { isDatabaseBusyError } from '@/lib/database-errors';

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
  // Leave time for rollback before the default interactive transaction budget.
  // A queued exclusive waiter must not hold up later stock writers indefinitely.
  await tx.$executeRaw`SET LOCAL lock_timeout = '3s'`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${WAREHOUSE_CONFIGURATION_LOCK}, 0))`;
}

export function rethrowWarehouseWriteError(error: unknown): never {
  const meta = errorProperty(error, 'meta');
  const adapterCause = errorProperty(errorProperty(meta, 'driverAdapterError'), 'cause');
  if (isDatabaseBusyError(error) || errorProperty(meta, 'code') === '55P03' || errorProperty(adapterCause, 'originalCode') === '55P03') {
    throw new WarehouseInvariantError('仓库正在处理出入库，请稍后重试');
  }
  throw error;
}

function errorProperty(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null && key in value ? (value as Record<string, unknown>)[key] : undefined;
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
