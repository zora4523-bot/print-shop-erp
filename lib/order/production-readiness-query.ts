import { db } from '@/lib/db';
import { inspectOrderProductionReadinessInTx } from './production-readiness';

/** Authorized admin pages use the same read-only readiness inspection as pricing. */
export async function getOrderProductionReadiness(orderId: string) {
  return db.$transaction(async (tx) => {
    const { ready, issues } = await inspectOrderProductionReadinessInTx(tx, orderId);
    return { ready, issues };
  });
}
