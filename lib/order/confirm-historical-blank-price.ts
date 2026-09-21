import type { Prisma } from '@/generated/prisma/client';
import { Role } from '@/generated/prisma/enums';
import { db } from '@/lib/db';
import { orderCascadeLockKey } from './locks';
import { appendOrderPricingRevisionInTx } from './pricing-revision';
import { ORDER_PRICING_STATUS, type OrderPricingStatusValue } from './pricing-status';
import { buildBlankMaterialConfirmation, readConfirmedHistoricalBlankPrice } from './historical-blank-price';
import { canConfirmHistoricalBlankPrice, confirmHistoricalBlankPriceSchema,
  type ConfirmHistoricalBlankPriceInput } from './historical-blank-price-input';

export class HistoricalBlankPriceError extends Error {}

/** Records one independently confirmed material price, leaving settled money intact. */
export async function confirmHistoricalBlankPrice(
  input: ConfirmHistoricalBlankPriceInput,
  actor: { id: string; role: Role },
  now = new Date(),
): Promise<{ orderId: string; priceRevision: number }> {
  if (actor.role !== Role.ADMIN) throw new HistoricalBlankPriceError('只有管理员可以确认材料单价');
  const parsed = confirmHistoricalBlankPriceSchema.safeParse(input);
  if (!parsed.success) throw new HistoricalBlankPriceError('材料单价或定价依据无效，请重新填写');
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orderCascadeLockKey(input.orderId)}))`;
    const order = await tx.order.findUnique({
      where: { id: input.orderId },
      select: { id: true, status: true, revision: true, priceRevision: true,
        pricingStatus: true, pricingConfirmedAt: true, pricingConfirmedById: true, items: { where: { id: input.itemId } } },
    });
    if (!order) throw new HistoricalBlankPriceError('工单不存在，请刷新后重试');
    if (!canConfirmHistoricalBlankPrice(order.status)) {
      throw new HistoricalBlankPriceError('该工单当前不能补录材料单价，请核对工单状态');
    }
    if (order.revision !== input.expectedOrderRevision || order.priceRevision !== input.expectedPriceRevision) {
      throw new HistoricalBlankPriceError('工单或价格已变更，请刷新后重新核对');
    }
    const item = order.items[0];
    if (!item || item.pricingRoute !== 'STOCK_BLANK') {
      throw new HistoricalBlankPriceError('该款式不是本工单的空白封款式，请刷新后重新选择');
    }
    if (!Object.values(ORDER_PRICING_STATUS).includes(order.pricingStatus as OrderPricingStatusValue)) {
      throw new HistoricalBlankPriceError('工单价格状态无法识别，请先核对价格记录');
    }
    let confirmation: Record<string, string | number | null>;
    try {
      confirmation = buildBlankMaterialConfirmation({ item, unitPrice: input.unitPrice,
        reason: input.reason, actorId: actor.id, previousPriceRevision: order.priceRevision, now });
    } catch (error) {
      throw new HistoricalBlankPriceError(error instanceof Error ? error.message : '材料单价无效，请重新填写');
    }
    const previous = item.pricingSnapshot && typeof item.pricingSnapshot === 'object' && !Array.isArray(item.pricingSnapshot)
      ? item.pricingSnapshot : {};
    const before = readConfirmedHistoricalBlankPrice(item);
    await tx.orderItem.update({ where: { id: item.id }, data: {
      pricingSnapshot: { ...previous, blankMaterialConfirmation: confirmation } as Prisma.InputJsonObject,
    } });
    // Pending modify/cancel requests deliberately remain. Their next preview reads
    // this new version under the same order lock; no price token survives this write.
    const revision = await appendOrderPricingRevisionInTx(tx, {
      orderId: order.id, status: order.pricingStatus as OrderPricingStatusValue,
      source: 'ADMIN_BLANK_MATERIAL_CONFIRMATION', actorId: actor.id, now,
      expectedPriceRevision: order.priceRevision, incrementOrderRevision: false,
      remark: input.reason, metadata: { itemId: item.id, confirmation },
    });
    await tx.order.update({ where: { id: order.id }, data: {
      pricingConfirmedAt: order.pricingConfirmedAt, pricingConfirmedById: order.pricingConfirmedById,
    } });
    await tx.orderLog.create({ data: { orderId: order.id, operatorId: actor.id,
      action: 'BLANK_MATERIAL_PRICE_CONFIRMED', remark: input.reason,
      changedFields: { itemId: item.id,
        materialUnitPrice: { before: before?.unitPrice ?? null, after: confirmation.unitPrice },
        priceRevision: { before: order.priceRevision, after: revision.priceRevision } },
    } });
    return { orderId: order.id, priceRevision: revision.priceRevision };
  });
}

export async function readHistoricalBlankPriceEditor(orderId: string, actor: { id: string; role: Role }) {
  if (actor.role !== Role.ADMIN) throw new HistoricalBlankPriceError('只有管理员可以查看材料单价');
  const order = await db.order.findUnique({ where: { id: orderId }, select: {
    id: true, status: true, revision: true, priceRevision: true,
    items: { where: { pricingRoute: 'STOCK_BLANK' }, orderBy: { sequence: 'asc' } },
  } });
  if (!order || !canConfirmHistoricalBlankPrice(order.status) || order.items.length === 0) return null;
  return { orderId: order.id, orderRevision: order.revision, priceRevision: order.priceRevision,
    items: order.items.map((item) => ({ id: item.id, name: item.name,
      unitPrice: readConfirmedHistoricalBlankPrice(item)?.unitPrice ?? null })),
  };
}
