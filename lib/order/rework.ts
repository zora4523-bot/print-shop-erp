import {
  OrderBillingMode,
  OrderKind,
  OrderSettlementType,
  OrderStatus,
  Role,
  ShipmentStatus,
} from '../../generated/prisma/enums';
import { db } from '../db';
import type { CreateReworkOrderInput } from '../auth/schemas';
import {
  nextOrderNumber,
  type OrderSeqTxClient,
} from './order-number';
import { orderCascadeLockKey } from './locks';
import { dispatchNotification } from '../notification/dispatch';
import { enqueueNotificationInTransaction } from '../notification/transactional-outbox';
import type { EnqueueClient } from '../background-jobs/repository';
import { backgroundJobsMode } from '../background-jobs/mode';
import { ORDER_PRICING_STATUS } from './pricing-status';

export class ReworkOrderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReworkOrderError';
  }
}

export type ReworkCraftOption = {
  id: string;
  name: string;
  isOutsource: boolean;
};

type ReworkPricingRevisionTxClient = {
  order: {
    create: (args: {
      data: unknown;
      select: unknown;
    }) => Promise<{
      id: string;
      orderNo: string;
      items: Array<{ id: string; sequence: number }>;
    }>;
  };
  orderPricingRevision: {
    create: (args: { data: unknown }) => Promise<unknown>;
  };
};

export async function getReworkCraftOptions(
  craftIds: string[],
): Promise<ReworkCraftOption[]> {
  const ids = [...new Set(craftIds)];
  if (ids.length === 0) return [];
  return db.craft.findMany({
    where: { id: { in: ids }, isActive: true },
    select: { id: true, name: true, isOutsource: true },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  });
}

export async function createReworkOrder(
  input: CreateReworkOrderInput,
  actor: { id: string; role: Role },
  now: Date = new Date(),
): Promise<{ id: string; orderNo: string }> {
  if (actor.role !== Role.ADMIN) {
    throw new ReworkOrderError('只有管理员可以创建重做工单');
  }

  let notificationQueued = false;
  const created = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orderCascadeLockKey(
      input.sourceOrderId,
    )}))`;
    const source = await tx.order.findUnique({
      where: { id: input.sourceOrderId },
      include: {
        items: {
          orderBy: { sequence: 'asc' },
          include: {
            designs: { orderBy: { uploadedAt: 'asc' } },
          },
        },
        shipments: {
          orderBy: { sequence: 'asc' },
        },
      },
    });
    if (!source) throw new ReworkOrderError('原工单不存在');
    if (source.kind === OrderKind.REWORK) {
      throw new ReworkOrderError(
        '重做工单不能再次发起重做，请返回原工单创建新的重做单',
      );
    }
    if (
      source.status !== OrderStatus.SHIPPED &&
      source.status !== OrderStatus.FINISHED
    ) {
      throw new ReworkOrderError('只有已发货或已完成工单可以发起重做');
    }

    const primarySourceShipment = source.shipments.find(
      (shipment) => shipment.sequence === 1,
    );
    // 历史数据可能只有工单或主发货记录的一边有地址。
    // 以实际履约的主发货地址优先，另一边作为可验证回退，
    // 并把同一值同时写入新工单和新主发货记录。
    const receiverAddress =
      primarySourceShipment?.receiverAddress?.trim() ||
      source.receiverAddress?.trim();
    if (!receiverAddress) {
      throw new ReworkOrderError(
        '原工单和主发货记录均缺少收货地址，请先补全原工单地址再创建重做单',
      );
    }

    const selectedIds = input.items.map((item) => item.sourceOrderItemId);
    if (new Set(selectedIds).size !== selectedIds.length) {
      throw new ReworkOrderError('同一款式不能重复加入重做单');
    }
    const sourceItemById = new Map(source.items.map((item) => [item.id, item]));
    const requestedCraftIds = new Set<string>();
    for (const item of input.items) {
      const sourceItem = sourceItemById.get(item.sourceOrderItemId);
      if (!sourceItem) throw new ReworkOrderError('所选款式不属于原工单');
      if (item.quantity > sourceItem.quantity) {
        throw new ReworkOrderError(
          `款式“${sourceItem.name}”重做数量不能超过原数量 ${sourceItem.quantity}`,
        );
      }
      const sourceCrafts = new Set(sourceItem.crafts);
      for (const craftId of item.craftIds) {
        if (!sourceCrafts.has(craftId)) {
          throw new ReworkOrderError(
            `款式“${sourceItem.name}”不包含所选重做工艺`,
          );
        }
        requestedCraftIds.add(craftId);
      }
    }
    const activeCrafts = await tx.craft.findMany({
      where: { id: { in: [...requestedCraftIds] }, isActive: true },
      select: { id: true },
    });
    if (activeCrafts.length !== requestedCraftIds.size) {
      throw new ReworkOrderError('所选重做工艺不存在或已停用');
    }

    const orderNo = await nextOrderNumber(
      tx as unknown as OrderSeqTxClient,
      now,
    );
    const pricingTx = tx as unknown as ReworkPricingRevisionTxClient;
    const createdOrder = await pricingTx.order.create({
      data: {
        orderNo,
        submitterId: actor.id,
        submitterRole: actor.role,
        createdById: actor.id,
        customerPartyId: source.customerPartyId,
        status: OrderStatus.SUBMITTED,
        kind: OrderKind.REWORK,
        billingMode: OrderBillingMode.NO_CHARGE,
        settlementType: OrderSettlementType.NO_CHARGE,
        pricingStatus: ORDER_PRICING_STATUS.AUTO_CONFIRMED,
        priceRevision: 1,
        pricingConfirmedAt: now,
        pricingConfirmedById: null,
        sourceOrderId: source.id,
        reworkCause: input.cause,
        reworkReason: input.reason,
        isUrgent: source.isUrgent,
        isSfCollect: source.isSfCollect,
        customName: `重做 · ${source.customName ?? source.orderNo}`,
        customerRef: source.customerRef,
        receiverName: source.receiverName,
        receiverPhone: source.receiverPhone,
        receiverAddress,
        expressCode: source.expressCode,
        packageRequirement: source.packageRequirement,
        remark: `原单 ${source.orderNo}；重做原因：${input.reason}`,
        promisedDate: null,
        processingAmount: '0.00',
        totalAmount: '0.00',
        submittedAt: now,
        items: {
          create: input.items.map((requested, index) => {
            const sourceItem = sourceItemById.get(
              requested.sourceOrderItemId,
            )!;
            return {
              sequence: index + 1,
              name: sourceItem.name,
              productId: sourceItem.productId,
              specification: sourceItem.specification,
              paperType: sourceItem.paperType,
              quantity: requested.quantity,
              crafts: requested.craftIds,
              foilColors: sourceItem.foilColors,
              lamination: sourceItem.lamination,
              isDoubleSided: sourceItem.isDoubleSided,
              isDoubleColor: sourceItem.isDoubleColor,
              unitPrice: '0',
              fixedFee: '0',
              subtotal: '0',
              suggestedSubtotal: null,
              pricingSnapshot: {
                version: 1,
                source: 'FREE_REWORK',
                sourceOrderId: source.id,
                sourceOrderItemId: sourceItem.id,
              },
              priceOverrideReason: '免费重做，不计加工费',
              remark: sourceItem.remark,
              designs: {
                create: sourceItem.designs.map((design) => ({
                  fileType: design.fileType,
                  fileUrl: design.fileUrl,
                  fileName: design.fileName,
                  fileSize: design.fileSize,
                  thumbnailUrl: design.thumbnailUrl,
                  uploadedBy: design.uploadedBy,
                  uploadedAt: design.uploadedAt,
                })),
              },
            };
          }),
        },
        logs: {
          create: {
            operatorId: actor.id,
            action: 'CREATE_REWORK',
            changedFields: {
              sourceOrderId: { before: null, after: source.id },
              billingMode: {
                before: null,
                after: OrderBillingMode.NO_CHARGE,
              },
            },
            remark: `由原工单 ${source.orderNo} 创建重做单：${input.reason}`,
          },
        },
      },
      select: {
        id: true,
        orderNo: true,
        items: { select: { id: true, sequence: true } },
      },
    });

    const shipment = await tx.orderShipment.create({
      data: {
        orderId: createdOrder.id,
        sequence: 1,
        receiverName:
          primarySourceShipment?.receiverName ?? source.receiverName,
        receiverPhone:
          primarySourceShipment?.receiverPhone ?? source.receiverPhone,
        receiverAddress,
        expressCode: primarySourceShipment?.expressCode ?? source.expressCode,
        status: ShipmentStatus.PLANNED,
      },
      select: { id: true },
    });
    await tx.orderShipmentLine.createMany({
      data: createdOrder.items.map((item, index) => ({
        shipmentId: shipment.id,
        orderItemId: item.id,
        quantity: input.items[index]!.quantity,
      })),
    });
    await pricingTx.orderPricingRevision.create({
      data: {
        orderId: createdOrder.id,
        revision: 1,
        status: ORDER_PRICING_STATUS.AUTO_CONFIRMED,
        source: 'REWORK_ORDER_CREATED_NO_CHARGE',
        createdById: actor.id,
        createdAt: now,
        snapshot: {
          version: 1,
          source: 'REWORK_ORDER_CREATED_NO_CHARGE',
          pricedAt: now.toISOString(),
          order: {
            id: createdOrder.id,
            orderNo: createdOrder.orderNo,
            settlementType: OrderSettlementType.NO_CHARGE,
            pricingStatus: ORDER_PRICING_STATUS.AUTO_CONFIRMED,
            priceRevision: 1,
            processingAmount: '0.00',
            totalAmount: '0.00',
          },
          items: input.items.map((requested, index) => {
            const sourceItem = sourceItemById.get(
              requested.sourceOrderItemId,
            )!;
            return {
              id: createdOrder.items[index]?.id ?? null,
              sequence: index + 1,
              name: sourceItem.name,
              quantity: requested.quantity,
              unitPrice: '0',
              fixedFee: '0',
              subtotal: '0',
              suggestedSubtotal: null,
              priceOverrideReason: '免费重做，不计加工费',
              requiresAdminConfirmation: false,
              pricingSnapshot: {
                version: 1,
                source: 'FREE_REWORK',
                sourceOrderId: source.id,
                sourceOrderItemId: sourceItem.id,
              },
            };
          }),
          customerCharges: [],
        },
      },
    });
    await tx.orderLog.create({
      data: {
        orderId: source.id,
        operatorId: actor.id,
        action: 'CREATE_REWORK',
        changedFields: {
          reworkOrderId: { before: null, after: createdOrder.id },
        },
        remark: `创建重做工单 ${createdOrder.orderNo}：${input.reason}`,
      },
    });

    if (backgroundJobsMode() === 'durable') {
      const payload = await tx.order.findUniqueOrThrow({
        where: { id: createdOrder.id },
        select: {
          id: true,
          orderNo: true,
          customerRef: true,
          totalAmount: true,
          isUrgent: true,
          submitter: { select: { displayName: true } },
        },
      });
      notificationQueued = await enqueueNotificationInTransaction(
        tx as unknown as EnqueueClient,
        'ORDER_SUBMITTED',
        {
          orderId: payload.id,
          orderNo: payload.orderNo,
          submitterName: payload.submitter.displayName,
          customerRef: payload.customerRef,
          totalAmount: String(payload.totalAmount),
          urgentMark: payload.isUrgent ? '🚨 急单' : '',
        },
        { dedupeKey: `notification:ORDER_SUBMITTED:${payload.id}` },
      );
      if (payload.isUrgent) {
        const urgentQueued = await enqueueNotificationInTransaction(
          tx as unknown as EnqueueClient,
          'URGENT_ORDER',
          {
            orderId: payload.id,
            orderNo: payload.orderNo,
            submitterName: payload.submitter.displayName,
            customerRef: payload.customerRef,
          },
          { dedupeKey: `notification:URGENT_ORDER:${payload.id}` },
        );
        notificationQueued = notificationQueued && urgentQueued;
      }
    }

    return createdOrder;
  });

  const payload = notificationQueued ? null : await db.order.findUnique({
    where: { id: created.id },
    select: {
      id: true,
      orderNo: true,
      customerRef: true,
      totalAmount: true,
      isUrgent: true,
      submitter: { select: { displayName: true } },
    },
  });
  if (payload) {
    await dispatchNotification(
      'ORDER_SUBMITTED',
      {
        orderId: payload.id,
        orderNo: payload.orderNo,
        submitterName: payload.submitter.displayName,
        customerRef: payload.customerRef,
        totalAmount: String(payload.totalAmount),
        urgentMark: payload.isUrgent ? '🚨 急单' : '',
      },
      { dedupeKey: `notification:ORDER_SUBMITTED:${payload.id}` },
    );
    if (payload.isUrgent) {
      await dispatchNotification(
        'URGENT_ORDER',
        {
          orderId: payload.id,
          orderNo: payload.orderNo,
          submitterName: payload.submitter.displayName,
          customerRef: payload.customerRef,
        },
        { dedupeKey: `notification:URGENT_ORDER:${payload.id}` },
      );
    }
  }

  return { id: created.id, orderNo: created.orderNo };
}
