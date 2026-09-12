import { db } from '@/lib/db';
import { Role } from '@/generated/prisma/enums';
import { getOrderScopeFilter } from '@/lib/auth/order-scope';
import { roleLabel } from '@/lib/auth/role-labels';
import { formatDateTimeShanghai } from '@/lib/format/dates';
import { actionLabel } from './log-format';
import { presentActivityChanges, type ActivityCursor, type OrderActivityPage } from './activity-presentation';

export async function readOrderActivity(orderId: string, actor: { id: string; role: Role }, cursor: ActivityCursor | null = null): Promise<OrderActivityPage | null> {
  // This richer audit feed is administrator-only, including direct domain callers.
  if (actor.role !== Role.ADMIN) return null;
  const order = await db.order.findFirst({ where: { AND: [{ id: orderId }, getOrderScopeFilter(actor)] }, select: { id: true } });
  if (!order) return null;
  const logs = await db.orderLog.findMany({
    where: { orderId, ...(cursor ? { OR: [
      { createdAt: { lt: new Date(cursor.at) } },
      { createdAt: new Date(cursor.at), id: { lt: cursor.id } },
    ] } : {}) },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 21,
    select: { id: true, action: true, remark: true, changedFields: true, createdAt: true, operator: { select: { displayName: true, role: true } } },
  });
  const page = logs.slice(0, 20);
  const last = page.at(-1);
  return {
    events: page.map(log => {
      const dateTime = formatDateTimeShanghai(log.createdAt);
      const role = roleLabel(log.operator.role);
      return { id: log.id, at: log.createdAt.toISOString(), date: dateTime.slice(0, 10), time: dateTime.slice(11),
        title: actionLabel(log.action), actor: log.operator.displayName === role ? role : `${log.operator.displayName} · ${role}`,
        remark: log.remark, changes: presentActivityChanges(log.changedFields) };
    }),
    nextCursor: logs.length > 20 && last ? { at: last.createdAt.toISOString(), id: last.id } : null,
  };
}
