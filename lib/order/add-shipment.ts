import 'server-only';
import { createHash } from 'node:crypto';
import Decimal from 'decimal.js';
import { Role, type Prisma } from '@/generated/prisma/client';
import { db } from '@/lib/db';
import { resolveExternalOrderChargesForFinalization, type ResolvedOrderCustomerCharge } from '@/lib/price/order-charge-service';
import { editableFieldsetForStatus } from './editable-fields';
import { orderCascadeLockKey } from './locks';
import { appendOrderPricingRevisionInTx } from './pricing-revision';
import { repriceShipmentBoxes } from './shipment-box-pricing';
import { packagingBoxType } from './packaging-mode';
import {
  addOrderShipmentSchema,
  type AddOrderShipmentInput,
  type AddOrderShipmentPreview,
} from './add-shipment-schema';

export class AddOrderShipmentError extends Error {}

function isPendingCharge(charge: ResolvedOrderCustomerCharge): boolean {
  const snapshot = charge.pricingSnapshot as Prisma.InputJsonObject;
  const actual = snapshot.actual as Prisma.InputJsonObject;
  return charge.suggestedAmount === null && !charge.overrideReason && actual?.requiresAdminConfirmation === true;
}

function previewChargeAmount(charge: ResolvedOrderCustomerCharge): string | null {
  return isPendingCharge(charge) ? null : charge.amount;
}

/** Split one unregistered delivery; never rewrite existing fulfillment evidence. */
export async function addOrderShipment(
  raw: AddOrderShipmentInput,
  actor: { id: string; role: Role },
  mode: 'preview' | 'save',
) {
  if (actor.role !== Role.ADMIN && actor.role !== Role.SALES && actor.role !== Role.CUSTOMER_SERVICE)
    throw new AddOrderShipmentError('当前账号不能添加发货地址');
  const input = addOrderShipmentSchema.parse(raw);
  if (actor.role !== Role.ADMIN && (input.shippingFee !== undefined || input.packingMaterialFee !== undefined || input.overrideReason !== undefined))
    throw new AddOrderShipmentError('当前账号不能录入人工物流费用');
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orderCascadeLockKey(input.orderId)}))`;
    await tx.$executeRaw`SELECT id FROM "Order" WHERE id = ${input.orderId} FOR UPDATE`;
    const order = await tx.order.findUnique({
      where: { id: input.orderId },
      include: {
        items: true,
        packagingGroups: { include: { lines: true } },
        shipments: { orderBy: { sequence: 'asc' }, include: { lines: true } },
        customerCharges: { include: { category: true } },
        _count: {
          select: { changeRequests: { where: { status: 'PENDING' } } },
        },
      },
    });
    if (!order) throw new AddOrderShipmentError('工单不存在，请刷新页面');
    if (actor.role !== Role.ADMIN && order.submitterId !== actor.id)
      throw new AddOrderShipmentError('只能为自己创建的工单添加地址');
    if (
      order.revision !== input.expectedRevision ||
      order.editVersion !== input.expectedEditVersion ||
      order.workOrderVersion !== input.expectedWorkOrderVersion ||
      order.priceRevision !== input.expectedPriceRevision
    )
      throw new AddOrderShipmentError('工单或价格已变化，请刷新后重新添加地址');
    if (
      editableFieldsetForStatus(order.status) === 'NONE' ||
      order.settledAt ||
      order.settledFee !== null ||
      order.shipments.some((row) => row.status === 'SHIPPED')
    )
      throw new AddOrderShipmentError('工单已发货或已结算，不能添加地址');
    if (order._count.changeRequests)
      throw new AddOrderShipmentError('请先处理待审批申请，再添加地址');
    if (order.shipments.length >= 10)
      throw new AddOrderShipmentError('单工单最多 10 个收货地址');
    const source = order.shipments.find(
      (row) => row.id === input.sourceShipmentId,
    );
    if (!source)
      throw new AddOrderShipmentError('分货地址不属于该工单，请重新选择');
    if (
      source.trackingNo ||
      source.weightKg !== null ||
      source.registrationVersion > 0
    )
      throw new AddOrderShipmentError(
        '该地址已登记物流，请选择尚未登记的地址分货',
      );
    assertShipmentAllocationConserved(order);
    const transferred = new Map(
      input.lines.map((line) => [line.orderItemId, line.quantity]),
    );
    if (
      input.lines.some(
        (line) =>
          !source.lines.some(
            (stored) => stored.orderItemId === line.orderItemId,
          ) ||
          line.quantity >
            (source.lines.find(
              (stored) => stored.orderItemId === line.orderItemId,
            )?.quantity ?? 0),
      )
    )
      throw new AddOrderShipmentError('分货数量超出原地址数量，请核对各款数量');
    const remaining = source.lines.map((line) => ({
      orderItemId: line.orderItemId,
      quantity: line.quantity - (transferred.get(line.orderItemId) ?? 0),
    }));
    if (!remaining.some((line) => line.quantity > 0))
      throw new AddOrderShipmentError('原地址至少保留一件，请调整分货数量');
    const sequence =
      Math.max(...order.shipments.map((row) => row.sequence)) + 1;
    let packaging: ReturnType<typeof repriceShipmentBoxes>;
    try {
      packaging = repriceShipmentBoxes({
        items: order.items,
        groups: order.packagingGroups,
        shipments: [
          ...order.shipments.map((shipment) => shipment.id === source.id ? { lines: remaining } : shipment),
          { lines: input.lines },
        ],
      });
    } catch (error) {
      throw new AddOrderShipmentError(error instanceof Error ? error.message : '装盒数量无法计算，请核对分货');
    }
    if (packaging.length && await tx.productionOperation.count({
      where: { orderId: order.id, workOrderVersion: order.workOrderVersion },
    })) {
      throw new AddOrderShipmentError('分货会改变盒数；工单已下发生产，请通过工单修改申请调整包装和地址');
    }
    const packagingDelta = packaging.reduce((sum, group) => sum.plus(group.delta), new Decimal(0));
    const standard = order.customerCharges.filter((charge) =>
      ['SHIPPING_FEE', 'PACKING_MATERIAL'].includes(
        String(charge.category.code),
      ),
    );
    const pricingMode =
      order.billingMode === 'NO_CHARGE' ||
      order.settlementType !== 'EXTERNAL_SALES'
        ? 'UNCHANGED'
        : order.status === 'DRAFT' && standard.length === 0
          ? 'ON_SUBMIT'
          : 'REQUOTE';
    if (
      pricingMode !== 'REQUOTE' &&
      (input.shippingFee !== undefined ||
        input.packingMaterialFee !== undefined)
    )
      throw new AddOrderShipmentError(
        '当前工单不支持单独录入物流费用，请清空人工物流费用',
      );
    const books = [...new Set(standard.map((charge) => charge.priceBookId))];
    if (
      pricingMode === 'REQUOTE' &&
      (books.length !== 1 ||
        !books[0] ||
        standard.length !== order.shipments.length * 2)
    )
      throw new AddOrderShipmentError(
        '原物流费用不完整，请先核对费用再添加地址',
      );
    for (const shipment of pricingMode === 'REQUOTE' ? order.shipments : []) {
      for (const code of ['SHIPPING_FEE', 'PACKING_MATERIAL']) {
        if (
          standard.filter(
            (charge) =>
              charge.shipmentId === shipment.id &&
              charge.category.code === code &&
              charge.businessKey.toUpperCase() ===
                `SHIPMENT:${shipment.sequence}:${code}`,
          ).length !== 1
        )
          throw new AddOrderShipmentError('物流收费与地址不一致，请先核对费用');
      }
    }
    const affected = standard.filter(
      (charge) => charge.shipmentId === source.id,
    );
    if (
      order.isSfCollect &&
      input.shippingFee !== undefined &&
      !new Decimal(input.shippingFee).isZero()
    )
      throw new AddOrderShipmentError('顺丰到付快递费须为 0，请修改费用');
    const now = new Date();
    const quote =
      pricingMode === 'REQUOTE'
        ? await resolveExternalOrderChargesForFinalization(
            tx,
            {
              isSfCollect: order.isSfCollect,
              shipments: [
                {
                  sequence: source.sequence,
                  province: source.destinationProvince,
                  lines: remaining,
                },
                {
                  sequence,
                  province: input.destinationProvince,
                  lines: input.lines,
                },
              ].map((shipment) => {
                const preserved =
                  shipment.sequence === source.sequence
                    ? affected.filter(
                        (charge) =>
                          charge.amount !== null &&
                          (charge.status === 'FINAL' ||
                            charge.status === 'WAIVED' ||
                            charge.overrideReason),
                      )
                    : [];
                const weightItems = shipment.lines
                  .filter((line) => line.quantity > 0)
                  .map((line) => {
                    const item = order.items.find(
                      (item) => item.id === line.orderItemId,
                    );
                    if (!item)
                      throw new AddOrderShipmentError(
                        '分货包含其他工单的款式，请刷新页面',
                      );
                    return {
                      itemKey: item.id,
                      quantity: line.quantity,
                      paperWeightGsm: item.paperWeightGsm,
                      paperType: item.paperType,
                      productStructure: item.productStructure,
                    };
                  });
                return {
                  shipmentKey: String(shipment.sequence),
                  province: shipment.province,
                  billableWeightKg: null,
                  requiresActualWeight: order.packagingGroups.some((group) =>
                    packagingBoxType(group.mode) && group.lines.some((line) =>
                      shipment.lines.some((allocation) => allocation.orderItemId === line.orderItemId && allocation.quantity > 0),
                    ),
                  ),
                  itemQuantity: weightItems.reduce(
                    (sum, line) => sum + line.quantity,
                    0,
                  ),
                  weightItems,
                  shippingFee:
                    shipment.sequence === sequence
                      ? (input.shippingFee ?? null)
                      : (preserved
                          .find(
                            (charge) => charge.category.code === 'SHIPPING_FEE',
                          )
                          ?.amount?.toString() ?? null),
                  packingMaterialFee:
                    shipment.sequence === sequence
                      ? (input.packingMaterialFee ?? null)
                      : (preserved
                          .find(
                            (charge) =>
                              charge.category.code === 'PACKING_MATERIAL',
                          )
                          ?.amount?.toString() ?? null),
                  overrideReason:
                    shipment.sequence === sequence
                      ? (input.overrideReason ?? null)
                      : preserved.length
                        ? '新增地址分货，保留原地址已确认费用'
                        : null,
                };
              }),
            },
            books[0]!,
            now,
            { allowPending: true },
          )
        : null;
    const oldAffected = affected.reduce(
      (sum, charge) => sum.plus(charge.amount?.toString() ?? 0),
      new Decimal(0),
    );
    let total = quote
      ? new Decimal(order.totalAmount.toString())
          .minus(oldAffected)
          .plus(quote.totalAmount)
      : new Decimal(order.totalAmount.toString());
    total = total.plus(packagingDelta);
    if (!total.isFinite() || total.isNegative() || total.gt('9999999999.99'))
      throw new AddOrderShipmentError('工单金额超出范围，请核对费用');
    const preview: AddOrderShipmentPreview = {
      token: '',
      pricingMode,
      requiresPriceReview: pricingMode === 'REQUOTE' || (packaging.length > 0 && order.billingMode !== 'NO_CHARGE' && order.settlementType !== 'NO_CHARGE'),
      sequence,
      oldTotal: order.totalAmount.toFixed(2),
      newTotal: total.toFixed(2),
      delta: total.minus(order.totalAmount.toString()).toFixed(2),
      packaging,
      charges: quote
        ? [source.sequence, sequence].map((seq) => ({
            sequence: seq,
            shippingFee: previewChargeAmount(quote.charges.find(
              (charge) =>
                charge.shipmentKey === String(seq) &&
                charge.categoryCode === 'SHIPPING_FEE',
            )!),
            packingMaterialFee: previewChargeAmount(quote.charges.find(
              (charge) =>
                charge.shipmentKey === String(seq) &&
                charge.categoryCode === 'PACKING_MATERIAL',
            )!),
          }))
        : [],
    };
    preview.token = shipmentPreviewToken(input, preview, quote);
    if (mode === 'preview') return preview;
    if (input.previewToken !== preview.token)
      throw new AddOrderShipmentError('费用或分货信息已变化，请重新预览后保存');
    return persistAddedShipment(tx, { order, source, remaining, input, quote, preview, sequence, actor, now, affected });
  });
}

type ShipmentOrder = Prisma.OrderGetPayload<{
  include: {
    items: true;
    shipments: { include: { lines: true } };
    packagingGroups: { include: { lines: true } };
    customerCharges: { include: { category: true } };
  };
}>;

/** Persist the validated preview under the caller's transaction and locks. */
async function persistAddedShipment(
  tx: Prisma.TransactionClient,
  {
    order,
    source,
    remaining,
    input,
    quote,
    preview,
    sequence,
    actor,
    now,
    affected,
  }: {
    order: ShipmentOrder;
    source: ShipmentOrder['shipments'][number];
    remaining: { orderItemId: string; quantity: number }[];
    input: AddOrderShipmentInput;
    quote: Awaited<
      ReturnType<typeof resolveExternalOrderChargesForFinalization>
    > | null;
    preview: AddOrderShipmentPreview;
    sequence: number;
    actor: { id: string; role: Role };
    now: Date;
    affected: ShipmentOrder['customerCharges'];
  },
) {
  const noCharge =
    order.billingMode === 'NO_CHARGE' || order.settlementType === 'NO_CHARGE';
  const packagingDelta = preview.packaging.reduce(
    (sum, group) => sum.plus(group.delta),
    new Decimal(0),
  );
  for (const change of preview.packaging) {
    const previous = order.packagingGroups.find(
      (group) => group.id === change.groupId,
    )!;
    await tx.orderPackagingGroup.update({
      where: { id: change.groupId },
      data: {
        actualBagCount: change.boxCount,
        ...(noCharge
          ? {}
          : {
              subtotal: change.subtotal,
              suggestedSubtotal: null,
              priceOverrideReason: null,
              pricingSnapshot: {
                source: 'SHIPMENT_SPLIT',
                quotedAt: now.toISOString(),
                previousSnapshot: previous.pricingSnapshot,
                previousPriceRevision: order.priceRevision,
                actual: {
                  actualBagCount: change.boxCount,
                  unitPrice: change.unitPrice,
                  subtotal: change.subtotal,
                },
              },
            }),
      },
    });
  }
  const created = await tx.orderShipment.create({
    data: {
      orderId: order.id,
      sequence,
      receiverName: input.receiverName,
      receiverPhone: input.receiverPhone,
      receiverAddress: input.receiverAddress,
      destinationProvince: input.destinationProvince,
      carrierCode: order.isSfCollect ? 'SF' : 'ZTO',
      lines: { create: input.lines.filter((line) => line.quantity > 0) },
    },
  });
  for (const line of remaining) {
    const where = {
      shipmentId_orderItemId: {
        shipmentId: source.id,
        orderItemId: line.orderItemId,
      },
    };
    if (line.quantity === 0) await tx.orderShipmentLine.delete({ where });
    else
      await tx.orderShipmentLine.update({
        where,
        data: { quantity: line.quantity },
      });
  }
  await tx.orderShipment.update({
    where: { id: source.id },
    data: { quotedWeightKg: null },
  });
  for (const charge of quote?.charges ?? []) {
    const { shipmentKey, categoryCode, ...quotedData } = charge;
    const snapshot = quotedData.pricingSnapshot as Prisma.InputJsonObject;
    const actual = snapshot.actual as Prisma.InputJsonObject;
    const pending = isPendingCharge(charge);
    const data = pending
      ? {
          ...quotedData,
          amount: null,
          status: 'PENDING_AMOUNT' as const,
          pricingSnapshot: { ...snapshot, actual: { ...actual, amount: null } },
        }
      : quotedData;
    void categoryCode;
    const existing = affected.find(
      (row) => row.businessKey.toUpperCase() === charge.businessKey,
    );
    if (existing) {
      // Confirmed amounts and evidence remain untouched; only estimates change.
      if (
        existing.amount !== null &&
        (existing.status === 'FINAL' ||
          existing.status === 'WAIVED' ||
          existing.overrideReason)
      )
        continue;
      await tx.orderCustomerCharge.update({
        where: { id: existing.id },
        data,
      });
    } else {
      if (shipmentKey !== String(sequence))
        throw new AddOrderShipmentError('原地址收费记录缺失，请刷新页面');
      await tx.orderCustomerCharge.create({
        data: {
          ...data,
          orderId: order.id,
          shipmentId: created.id,
          createdById: actor.id,
        },
      });
    }
  }
  if (quote || (preview.packaging.length && !noCharge)) {
    await tx.order.update({
      where: { id: order.id },
      data: {
        totalAmount: preview.newTotal,
        ...(preview.packaging.length
          ? {
              packagingAmount: new Decimal(order.packagingAmount.toString())
                .plus(packagingDelta)
                .toFixed(2),
              processingAmount: new Decimal(order.processingAmount.toString())
                .plus(packagingDelta)
                .toFixed(2),
            }
          : {}),
        confirmedFee: null,
        settledFee: null,
      },
    });
    const revision = await appendOrderPricingRevisionInTx(tx, {
      orderId: order.id,
      status: 'PENDING_ADMIN_CONFIRMATION',
      source: 'SHIPMENT_ADDED',
      metadata: {
        sourceShipmentId: source.id,
        sourceSequence: source.sequence,
        sourceBefore: source.lines.map(({ orderItemId, quantity }) => ({
          orderItemId,
          quantity,
        })),
        sourceAfter: remaining,
        addedSequence: sequence,
        addedLines: input.lines,
        packaging: preview.packaging,
      },
      orderFeeSnapshot: {
        quotedFee: preview.newTotal,
        confirmedFee: null,
        settledFee: null,
      },
      actorId: actor.id,
      now,
      expectedPriceRevision: order.priceRevision,
      incrementOrderRevision: true,
      remark: `添加地址 ${sequence}，从地址 ${source.sequence} 分货`,
    });
    await tx.order.update({
      where: { id: order.id },
      data: {
        quotedFee: preview.newTotal,
        quotedFeeCompleteness: quote?.requiresAdminConfirmation
          ? 'EXCLUDES_MANUAL_ITEMS'
          : (order.quotedFeeCompleteness ?? 'EXCLUDES_MANUAL_ITEMS'),
        quotedPricingRevisionId: revision.pricingRevisionId,
      },
    });
  } else {
    await tx.order.update({
      where: { id: order.id },
      data: { revision: { increment: 1 } },
    });
  }
  await tx.orderLog.create({
    data: {
      orderId: order.id,
      operatorId: actor.id,
      action: 'UPDATE',
      remark: `添加地址 ${sequence}：${input.receiverName} ${input.receiverPhone} ${input.receiverAddress}；从地址 ${source.sequence} 分货，工单金额 ${preview.oldTotal} → ${preview.newTotal}`,
      changedFields: {
        packaging: preview.packaging,
        totalAmount: { before: preview.oldTotal, after: preview.newTotal },
        shipments: [
          {
            sequence,
            before: null,
            after: {
              receiverName: input.receiverName,
              receiverPhone: input.receiverPhone,
              receiverAddress: input.receiverAddress,
              lines: input.lines,
            },
          },
        ],
      } as Prisma.InputJsonObject,
    },
  });
  return null;
}

function shipmentPreviewToken(
  input: AddOrderShipmentInput,
  preview: AddOrderShipmentPreview,
  quote: Awaited<
    ReturnType<typeof resolveExternalOrderChargesForFinalization>
  > | null,
): string {
  const facts = { ...input, previewToken: undefined };
  return createHash('sha256')
    .update(
      JSON.stringify({
        facts,
        preview,
        book: quote?.priceBook,
        charges: quote?.charges.map((charge) => ({
          ...charge,
          pricingSnapshot: undefined,
        })),
      }),
    )
    .digest('hex');
}

function assertShipmentAllocationConserved(
  order: Pick<ShipmentOrder, 'items' | 'shipments'>,
) {
  for (const item of order.items) {
    const total = order.shipments
      .flatMap((row) => row.lines)
      .filter((line) => line.orderItemId === item.id)
      .reduce((sum, line) => sum + line.quantity, 0);
    if (total !== item.quantity)
      throw new AddOrderShipmentError(
        '已有分货数量与工单不一致，请先核对分货记录',
      );
  }
}
