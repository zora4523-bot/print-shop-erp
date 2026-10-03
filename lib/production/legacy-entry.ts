import { db } from '@/lib/db';
import { orderCascadeLockKey } from '@/lib/order/locks';
import { inspectOrderProductionReadinessInTx, prepareOrderForProductionInTx } from '@/lib/order/production-readiness';
import { dispatchProductionCompletionNotification } from '@/lib/production-completion';
import { assertProductionAdmin, type ProductionActor } from './dispatch';
import { readProductionRouting } from './routing';
import { dispatchPreparedProduction } from './preparation-notification';

/** Deployment repair only: no page reads mutate orders and no admin release button is needed. */
export async function repairLegacyProductionEntry(orderId: string, actor: ProductionActor, apply = false) {
  const result = await db.$transaction(async tx => {
    await assertProductionAdmin(tx, actor);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orderCascadeLockKey(orderId)}))`;
    const { order, ready, issues } = await inspectOrderProductionReadinessInTx(tx, orderId);
    if (!['PENDING_FACTORY', 'SUBMITTED', 'CONFIRMED'].includes(order.status)) return { orderId, before: order.status, after: order.status, changed: false, issues: [] };
    const routing = (await readProductionRouting(tx, [orderId])).get(orderId);
    if (!ready || !routing || routing.kind === 'BLOCKED' || routing.kind === 'ASSIGN') {
      return { orderId, before: order.status, after: order.status, changed: false, issues };
    }
    if (!apply) return { orderId, before: order.status, after: order.status, changed: false, eligible: true, kind: routing.kind, issues: [] };
    const prepared = await prepareOrderForProductionInTx(tx, orderId, actor, new Date());
    return { orderId, before: order.status, after: prepared.status, changed: order.status !== prepared.status, issues: prepared.issues, notification: prepared.notification, scheduledNotification: prepared.scheduledNotification };
  });
  if ('notification' in result) await dispatchProductionCompletionNotification(result.notification);
  if ('scheduledNotification' in result) await dispatchPreparedProduction(result.scheduledNotification);
  return { orderId: result.orderId, before: result.before, after: result.after, changed: result.changed, issues: result.issues,
    ...('eligible' in result ? { eligible: result.eligible, kind: result.kind } : {}) };
}
