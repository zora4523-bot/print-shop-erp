import 'server-only';
import type { Role } from '@/generated/prisma/enums';
import { db } from '@/lib/db';
import { buildAdminWorkspaceResultWhere } from '@/lib/order/admin-workspace';
import { parseAdminOrderWorkspaceQuery, type AdminOrderSignal } from '@/lib/order/admin-workspace-query';

/** Count orders with the same actor scope and filters as each destination list. */
export async function getOrderAttentionCounts(
  actor: { id: string; role: Role },
  signals: readonly AdminOrderSignal[],
) {
  return Promise.all(signals.map((signal) => db.order.count({
    where: buildAdminWorkspaceResultWhere(
      actor, parseAdminOrderWorkspaceQuery({ queue: 'all', signal }).query,
    ),
  })));
}
