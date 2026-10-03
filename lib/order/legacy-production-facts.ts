import { ProductionOperationMaterializationError } from '../production/operation-materialization-service';
import { workflowOrderSelect } from './factory-confirmation-facts';
import { buildTrustedAdminItemPricingSnapshot, isTrustedAdminItemPricingSnapshot } from './admin-pricing-snapshot';
import { appendOrderPricingRevisionInTx } from './pricing-revision';
import { isLegacyProductionFactsRepairAllowedStatus, legacyPackagingMode } from './legacy-production-facts-presentation';
import Decimal from 'decimal.js';
import { OrderPackagingMode, Role } from '@/generated/prisma/enums';
import type { Prisma } from '@/generated/prisma/client';
import { db } from '@/lib/db';
import type { RepairLegacyProductionFactsInput } from '@/lib/auth/schemas';
import { orderCascadeLockKey } from './locks';
import { isValidPackagingUnitsPerBag } from './packaging-units';
import { isMixedPackaging, packagingBoxType, packagingModeWithStyleCount } from './packaging-mode';
import { calculatePackagingBagCount } from './packaging-bag-count';
import { prepareOrderForProductionInTx, type ProductionReadinessResult } from './production-readiness';
import { dispatchProductionCompletionNotification } from '../production-completion';
import { dispatchPreparedProduction } from '../production/preparation-notification';

export class LegacyProductionFactsError extends Error {
  constructor(message: string) { super(message); this.name = 'LegacyProductionFactsError'; }
}

const repairSelect = {
  id: true, purpose: true, revision: true, priceRevision: true, pricingStatus: true, status: true, packageRequirement: true, packagingAmount: true,
  items: { orderBy: { sequence: 'asc' }, select: { ...workflowOrderSelect.items.select, sequence: true, name: true } },
  packagingGroups: { select: { id: true } },
  shipments: { select: { lines: { select: { orderItemId: true, quantity: true } } } },
} satisfies Prisma.OrderSelect;

export async function repairLegacyProductionFacts(input: RepairLegacyProductionFactsInput, actor: { id: string; role: Role }) {
  if (actor.role !== Role.ADMIN) throw new LegacyProductionFactsError('无权补录生产资料');
  const result = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orderCascadeLockKey(input.orderId)}))`;
    const order = await tx.order.findUnique({ where: { id: input.orderId }, select: repairSelect });
    if (!order) throw new LegacyProductionFactsError('工单不存在');
    if (order.purpose === 'SAMPLE_SHIPMENT') throw new LegacyProductionFactsError('寄样品无需补录生产资料');
    if (!isLegacyProductionFactsRepairAllowedStatus(order.status)) throw new LegacyProductionFactsError('工单已下发或当前状态不允许补录，请刷新工单');
    if (order.revision !== input.expectedOrderRevision) throw new LegacyProductionFactsError('工单已变化，请刷新后重新补录');
    const requested = new Map(input.items.map((item) => [item.itemId, item]));
    if (requested.size !== input.items.length) throw new LegacyProductionFactsError('款式不能重复');
    const craftChanges: Array<{ itemId: string; before: null; after: NonNullable<(typeof order.items)[number]['craft']> }> = [];
    for (const change of input.items) {
      const item = order.items.find((item) => item.id === change.itemId);
      if (!item) throw new LegacyProductionFactsError('款式不属于当前工单');
      if (change.craft !== undefined) {
        if (item.craft !== null) throw new LegacyProductionFactsError(`款式“${item.name}”已有工艺，不能覆盖`);
        craftChanges.push({ itemId: item.id, before: null, after: change.craft });
      }
    }
    const needsPackaging = order.packagingGroups.length === 0;
    if (!needsPackaging && (input.packagingMode !== undefined || input.items.some((item) => item.unitsPerBag !== undefined))) {
      throw new LegacyProductionFactsError('工单已有包装组，不能重复创建');
    }
    const groups: Array<{ sequence: number; name: string; mode: OrderPackagingMode; actualBagCount: number; subtotal: string; itemId: string; unitsPerBag: number }> = [];
    const mode = input.packagingMode ?? legacyPackagingMode(order.packageRequirement);
    if (needsPackaging) {
      if (!mode) throw new LegacyProductionFactsError('原单未记录明确包装方式，请选择包装方式');
      // 数据库约束 OrderPackagingGroup_count_by_mode_check 要求不包装组金额为 0；
      // 历史包装费非零时不能选不包装，在写入前给出业务错误而不是让约束报错回滚。
      if (mode === OrderPackagingMode.UNPACKED && !new Decimal(order.packagingAmount).isZero()) {
        throw new LegacyProductionFactsError('原单记录了包装费，不能补录为不包装，请先核对费用或选择实际包装方式');
      }
      if (order.items.length === 0) throw new LegacyProductionFactsError('工单没有款式，请先补录款式');
      const totalQuantity = order.items.reduce((sum, item) => sum.plus(item.quantity), new Decimal(0));
      let remaining = new Decimal(order.packagingAmount);
      // Each style is its own group, like legacy rework fallback. Allocate only
      // the existing packaging total; never add it to historical item prices.
      for (const [index, item] of order.items.entries()) {
        if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0) throw new LegacyProductionFactsError(`款式“${item.name}”数量非法，请先修正数量`);
        const unitsPerBag = isValidPackagingUnitsPerBag(item.pack) ? item.pack : requested.get(item.id)?.unitsPerBag;
        if (!isValidPackagingUnitsPerBag(unitsPerBag)) throw new LegacyProductionFactsError(`款式“${item.name}”未记录每包数量，请填写每包数量`);
        const groupMode = packagingModeWithStyleCount(mode, 1);
        let actualBagCount = groupMode === OrderPackagingMode.UNPACKED ? 0 : Math.ceil(item.quantity / unitsPerBag);
        if (packagingBoxType(groupMode)) {
          const count = calculatePackagingBagCount({ mode: groupMode, itemQuantities: [item.quantity], itemUnitsPerBag: [unitsPerBag],
            shipmentQuantities: order.shipments.length ? order.shipments.map((shipment) => [shipment.lines.filter((line) => line.orderItemId === item.id).reduce((sum, line) => sum + line.quantity, 0)]) : undefined });
          if (!count.complete) throw new LegacyProductionFactsError(count.errors.join('；'));
          actualBagCount = count.bagCount;
        }
        // Round down each preceding allocation so the final remainder can never
        // become negative on tiny historical amounts with many styles.
        const subtotal = index === order.items.length - 1 ? remaining : new Decimal(order.packagingAmount).times(item.quantity).div(totalQuantity).toDecimalPlaces(2, Decimal.ROUND_DOWN);
        remaining = remaining.minus(subtotal);
        groups.push({ sequence: index + 1, name: item.name, mode: groupMode, actualBagCount, subtotal: subtotal.toFixed(2), itemId: item.id, unitsPerBag });
      }
    }
    let packagingPlans = groups.map(({ itemId, unitsPerBag, ...group }) => ({ ...group, lines: [{ orderItemId: itemId, unitsPerBag }] }));
    if (needsPackaging && mode && isMixedPackaging(mode)) {
      const count = calculatePackagingBagCount({ mode, itemQuantities: order.items.map((item) => item.quantity), itemUnitsPerBag: groups.map((group) => group.unitsPerBag),
        shipmentQuantities: order.shipments.length ? order.shipments.map((shipment) => order.items.map((item) => shipment.lines.filter((line) => line.orderItemId === item.id).reduce((sum, line) => sum + line.quantity, 0))) : undefined });
      if (!count.complete) throw new LegacyProductionFactsError(count.errors.join('；'));
      packagingPlans = [{ sequence: 1, name: '补录包装', mode, actualBagCount: count.bagCount, subtotal: new Decimal(order.packagingAmount).toFixed(2), lines: packagingPlans.flatMap((group) => group.lines) }];
    }
    if (!craftChanges.length && !groups.length) throw new LegacyProductionFactsError('没有需要补录的资料');
    const now = new Date();
    const reboundSnapshots: Prisma.InputJsonObject[] = [];
    for (const change of craftChanges) {
      const item = order.items.find((item) => item.id === change.itemId)!;
      // A saved admin price binds craft too. Only an already-valid confirmation
      // may follow this authorized NULL -> craft repair; never bless stale prices.
      const pricingSnapshot = isTrustedAdminItemPricingSnapshot(item.pricingSnapshot, item)
        ? buildTrustedAdminItemPricingSnapshot({ previous: item.pricingSnapshot, now, actorId: actor.id, previousPriceRevision: order.priceRevision, item: { ...item, craft: change.after } })
        : undefined;
      if (pricingSnapshot) reboundSnapshots.push({ itemId: item.id, before: item.pricingSnapshot, after: pricingSnapshot });
      await tx.orderItem.update({ where: { id: change.itemId, orderId: order.id, craft: null }, data: { craft: change.after, ...(pricingSnapshot ? { pricingSnapshot } : {}) } });
    }
    for (const group of packagingPlans) {
      await tx.orderPackagingGroup.create({ data: {
        orderId: order.id, sequence: group.sequence, name: group.name, mode: group.mode,
        actualBagCount: group.actualBagCount, unitPrice: '0', subtotal: group.subtotal,
        pricingSnapshot: { source: 'LEGACY_PRODUCTION_FACTS_REPAIR', repairedBy: actor.id, repairedAt: now.toISOString(), note: '包装费已含在历史款式价内' },
        lines: { create: group.lines },
      } });
    }
    await tx.order.update({ where: { id: order.id, revision: input.expectedOrderRevision }, data: { revision: { increment: 1 } } });
    if (reboundSnapshots.length) await appendOrderPricingRevisionInTx(tx, {
      orderId: order.id, status: order.pricingStatus, source: 'LEGACY_PRODUCTION_FACTS_REPAIR', actorId: actor.id, now,
      expectedPriceRevision: order.priceRevision, incrementOrderRevision: false,
      remark: '补录工艺，保留已确认终价', metadata: { reboundSnapshots },
    });
    await tx.orderLog.create({ data: { orderId: order.id, operatorId: actor.id, action: 'LEGACY_PRODUCTION_FACTS_REPAIRED',
      changedFields: { crafts: craftChanges, packagingGroups: packagingPlans, reboundSnapshots }, remark: '管理员补录缺失的工艺与包装资料' } });
    let prepared: ProductionReadinessResult;
    try { prepared = await prepareOrderForProductionInTx(tx, order.id, actor, now); }
    catch (error) {
      if (error instanceof ProductionOperationMaterializationError) throw new LegacyProductionFactsError('生产记录与当前工单不一致，本次补录未保存，请核对原生产记录后重试。');
      throw error;
    }
    const saved = await tx.order.findUniqueOrThrow({ where: { id: order.id }, select: { revision: true } });
    return { orderId: order.id, revision: saved.revision, ...prepared };
  });
  const { notification, scheduledNotification, ...receipt } = result;
  await dispatchProductionCompletionNotification(notification);
  await dispatchPreparedProduction(scheduledNotification);
  return receipt;
}
