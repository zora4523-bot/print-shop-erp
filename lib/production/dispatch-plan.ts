import { createHash } from 'node:crypto';
import Decimal from 'decimal.js';
import type { Prisma } from '@/generated/prisma/client';
import { deriveProductionOperationPlan } from './operation-materializer';
import { deriveProductionProgressPlan } from './progress-materializer';

const dispatchOrderInclude = {
  items: { orderBy: { sequence: 'asc' as const }, include: { designs: true } },
  shipments: { include: { lines: true } },
  packagingGroups: { include: { lines: true } },
} satisfies Prisma.OrderInclude;
export { dispatchOrderInclude };
type DispatchOrder = Prisma.OrderGetPayload<{ include: typeof dispatchOrderInclude }>;
export type DispatchTarget = {
  key: string; label: string; operationType: 'PARTIAL' | 'FULL' | null;
  craftId: string | null; itemIds: string[]; quantity: string; fingerprint: string;
  snapshot: Prisma.InputJsonObject;
};
export function productionSourceKey(lane: string, ids: readonly string[]) {
  return `${lane}:${[...ids].sort().join(',')}`;
}
export function dispatchTargets(order: DispatchOrder, crafts: Parameters<typeof deriveProductionProgressPlan>[0]['crafts']): DispatchTarget[] {
  const plan = deriveProductionOperationPlan({ ...order, orderId: order.id });
  const progress = deriveProductionProgressPlan({ items: order.items, crafts });
  if (!plan.ok || !progress.ok) throw new Error([...plan.issues, ...progress.issues].map(issue => issue.message).join('；'));
  const target = (lane: string, itemIds: string[], quantity: string, label: string, operationType: DispatchTarget['operationType'], craftId: string | null): DispatchTarget => {
    const items = order.items.filter(item => itemIds.includes(item.id)).map(item => ({
      id: item.id, name: item.name, quantity: item.quantity,
      productId: item.productId, craft: item.craft, productStructure: item.productStructure,
      artworkVersion: item.artworkVersion, specification: item.specification,
      actualWidthMm: item.actualWidthMm?.toString() ?? null, actualHeightMm: item.actualHeightMm?.toString() ?? null,
      paperType: item.paperType, paperWeightGsm: item.paperWeightGsm,
      frontFoilColors: item.frontFoilColors, backFoilColors: item.backFoilColors,
      foilTechnique: item.foilTechnique, hasLocalFoil: item.hasLocalFoil, isDoubleSided: item.isDoubleSided, isDoubleColor: item.isDoubleColor,
      lamination: item.lamination, printColors: item.printColors,
      designs: item.designs.map(design => design.fileUrl).sort(),
    }));
    // Names, quantities and customer prices are not physical production identity.
    const identity = items.map(item => Object.fromEntries(Object.entries(item).filter(([key]) => key !== 'name' && key !== 'quantity')));
    const fingerprint = createHash('sha256').update(JSON.stringify([lane, identity])).digest('hex');
    const itemFingerprints = Object.fromEntries(identity.map(item => [String(item.id), createHash('sha256').update(JSON.stringify(item)).digest('hex')]));
    return { key: productionSourceKey(lane, itemIds), label, operationType, craftId, itemIds, quantity, fingerprint,
      snapshot: { schemaVersion: 1, fingerprint, lane, itemFingerprints, items, totalQuantity: quantity } };
  };
  return [
    ...plan.specs.filter(spec => spec.operationType !== 'PACKING').map(spec => {
      const type = spec.operationType as 'PARTIAL' | 'FULL';
      return target(type, spec.sources.flatMap(source => source.orderItemId ? [source.orderItemId] : []),
        spec.sources.reduce((sum, source) => sum.plus(source.completedPieceQty), new Decimal(0)).toString(),
        type === 'PARTIAL' ? '局部烫金' : '专版烫金', type, null);
    }),
    ...progress.specs.map(spec => target(`CRAFT:${spec.craftId}`, [spec.orderItemId], spec.plannedQty, spec.craftName, null, spec.craftId)),
  ];
}
