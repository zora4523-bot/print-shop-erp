import Decimal from 'decimal.js';
import type { Prisma } from '@/generated/prisma/client';

/** Different crafts process the same piece; successive real batches in one craft add. */
export function productionMinimumByItem(jobs: ReadonlyArray<{ status: string; completedQty: Decimal | null; sourceKey: string; snapshot: Prisma.JsonValue }>) {
  const byItem = new Map<string, Map<string, Decimal>>();
  for (const job of jobs) {
    if (job.status !== 'COMPLETED' || !job.completedQty) continue;
    const snapshot = job.snapshot as Prisma.JsonObject;
    const items = snapshot.items as Array<{ id: string; quantity: number }> | undefined;
    if (!items?.length) throw new Error('原生产款式资料缺失，请先核对实际生产');
    const quantities = snapshot.actualItemQuantities as Record<string, string> | undefined
      ?? (items.length === 1 ? { [items[0].id]: job.completedQty.toString() }
        : snapshot.productionQuantities as Record<string, string> | undefined ?? Object.fromEntries(items.map(item => [item.id, String(item.quantity)])));
    if (!Object.values(quantities).reduce((sum, qty) => sum.plus(qty), new Decimal(0)).eq(job.completedQty)) throw new Error('原任务只登记了合计数量，请先逐款核对实际生产');
    const lane = typeof snapshot.lane === 'string' ? snapshot.lane : job.sourceKey.split(':').slice(0, -1).join(':');
    for (const item of items) {
      if (quantities[item.id] === undefined) throw new Error('原生产款式数量缺失，请先核对');
      const lanes = byItem.get(item.id) ?? new Map<string, Decimal>();
      lanes.set(lane, (lanes.get(lane) ?? new Decimal(0)).plus(quantities[item.id]));
      byItem.set(item.id, lanes);
    }
  }
  return new Map([...byItem].map(([id, lanes]) => [id, Decimal.max(...lanes.values())]));
}
