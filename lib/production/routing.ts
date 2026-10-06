import type { Prisma } from '@/generated/prisma/client';
import { deriveProductionOperationPlan } from './operation-materializer';
import { deriveProductionProgressPlan } from './progress-materializer';
import { productionPlanIssueMessages } from './dispatch-plan-error';

export type ProductionRouting = {
  kind: 'ASSIGN' | 'SAMPLE' | 'OUTSOURCE' | 'PACKING' | 'READY' | 'BLOCKED';
  issues: string[];
};

/** 按保存的工艺和包装事实判断下一步，不能把资料错误当作没有生产任务。 */
export async function readProductionRouting(tx: Pick<Prisma.TransactionClient, 'order' | 'craft'>, ids: string[]) {
  const orders = await tx.order.findMany({ where: { id: { in: ids } }, select: {
    id: true, purpose: true,
    items: { select: { id: true, sequence: true, craft: true, crafts: true, quantity: true,
      frontFoilColors: true, backFoilColors: true, hasLocalFoil: true } },
    packagingGroups: { select: { id: true, sequence: true, mode: true, actualBagCount: true,
      lines: { select: { orderItemId: true, unitsPerBag: true } } } },
    shipments: { select: { lines: { select: { orderItemId: true, quantity: true } } } },
  } });
  const craftIds = [...new Set(orders.filter(order => order.purpose !== 'SAMPLE_SHIPMENT').flatMap(order => order.items.flatMap(item => item.crafts)))];
  const crafts = craftIds.length ? await tx.craft.findMany({ where: { id: { in: craftIds } },
    select: { id: true, code: true, name: true, isActive: true, isOutsource: true } }) : [];
  return new Map<string, ProductionRouting>(orders.map(order => {
    if (order.purpose === 'SAMPLE_SHIPMENT') return [order.id, { kind: 'SAMPLE', issues: [] }];
    const operations = deriveProductionOperationPlan({ ...order, orderId: order.id });
    const progress = deriveProductionProgressPlan({ items: order.items, crafts });
    if (!operations.ok || !progress.ok) return [order.id, { kind: 'BLOCKED', issues: productionPlanIssueMessages([...operations.issues, ...progress.issues]) }];
    const assigned = operations.specs.some(op => op.operationType !== 'PACKING') || progress.specs.length > 0;
    const outsourced = crafts.some(craft => craft.isOutsource && order.items.some(item => item.crafts.includes(craft.id)));
    return [order.id, { kind: assigned ? 'ASSIGN' : outsourced ? 'OUTSOURCE' : operations.specs.length ? 'PACKING' : 'READY', issues: [] }];
  }));
}
