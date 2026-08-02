import Decimal from 'decimal.js';
import {
  CsSalesEntryType,
  OrderBillingMode,
  OrderChangeRequestStatus,
  OrderStatus,
  Prisma,
  Role,
  TaskStatus,
} from '../../generated/prisma/client';
import type {
  CreateOrderChangeRequestInput,
  ReviewOrderChangeRequestInput,
} from '../auth/schemas';
import { db } from '../db';
import {
  assertCsOrderSalesLedgerReconciledInTx,
  CsSalesLedgerError,
  recordCsSalesEntryInTx,
} from '../salary/cs-sales';
import { orderCascadeLockKey } from './locks';

const CHANGEABLE_ORDER_STATUSES: OrderStatus[] = [
  OrderStatus.DRAFT,
  OrderStatus.SUBMITTED,
  OrderStatus.SCHEDULING,
  OrderStatus.IN_PRODUCTION,
];
const DECIMAL_12_2_MAX = new Decimal('9999999999.99');

export class OrderChangeRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OrderChangeRequestError';
  }
}

function assertCanRequest(
  actor: { id: string; role: Role },
  order: { submitterId: string; status: OrderStatus },
): void {
  if (
    actor.role !== Role.SALES &&
    actor.role !== Role.CUSTOMER_SERVICE
  ) {
    throw new OrderChangeRequestError('只有销售和客服可以提交工单修改申请');
  }
  if (order.submitterId !== actor.id) {
    throw new OrderChangeRequestError('只能修改自己提交的工单');
  }
  if (!CHANGEABLE_ORDER_STATUSES.includes(order.status)) {
    throw new OrderChangeRequestError('工单已完工，不能再提交修改申请');
  }
}

/**
 * Records a proposal only. The live order remains unchanged until an ADMIN
 * approves it, so every client keeps seeing one authoritative revision.
 */
export async function createOrderChangeRequest(
  input: CreateOrderChangeRequestInput,
  actor: { id: string; role: Role },
) {
  try {
    return await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orderCascadeLockKey(
        input.orderId,
      )}))`;

      const order = await tx.order.findUnique({
        where: { id: input.orderId },
        select: {
          id: true,
          orderNo: true,
          submitterId: true,
          status: true,
          revision: true,
          items: {
            orderBy: { sequence: 'asc' },
            select: {
              id: true,
              sequence: true,
              name: true,
              quantity: true,
              specification: true,
              foilColors: true,
            },
          },
          changeRequests: {
            where: { status: OrderChangeRequestStatus.PENDING },
            take: 1,
            select: { id: true },
          },
        },
      });
      if (!order) throw new OrderChangeRequestError('工单不存在');
      assertCanRequest(actor, order);
      if (order.changeRequests.length > 0) {
        throw new OrderChangeRequestError('该工单已有待审核申请，请等待管理员处理');
      }

      const itemIds = new Set(order.items.map((item) => item.id));
      for (const change of input.items) {
        const referencedId =
          change.operation === 'UPDATE' ? change.itemId : change.templateItemId;
        if (!itemIds.has(referencedId)) {
          throw new OrderChangeRequestError('申请中包含不属于该工单的款式');
        }
      }

      return tx.orderChangeRequest.create({
        data: {
          orderId: order.id,
          requesterId: actor.id,
          baseRevision: order.revision,
          reason: input.reason,
          beforeSnapshot: {
            orderNo: order.orderNo,
            revision: order.revision,
            status: order.status,
            items: order.items,
          },
          proposedChanges: { items: input.items },
        },
        include: {
          requester: { select: { displayName: true } },
          order: { select: { orderNo: true } },
        },
      });
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new OrderChangeRequestError('该工单已有待审核申请，请勿重复提交');
    }
    throw error;
  }
}

type ProposedItemChange = CreateOrderChangeRequestInput['items'][number];

function readProposedChanges(value: Prisma.JsonValue): ProposedItemChange[] {
  const parsed = value as { items?: ProposedItemChange[] } | null;
  if (!parsed || !Array.isArray(parsed.items)) {
    throw new OrderChangeRequestError('申请数据已损坏，无法审核');
  }
  return parsed.items;
}

function storableOrderSubtotal(
  unitPrice: Prisma.Decimal,
  quantity: number,
  itemName: string,
): string {
  const subtotal = new Decimal(unitPrice).times(quantity).toDecimalPlaces(2);
  if (!subtotal.isFinite() || subtotal.isNegative() || subtotal.gt(DECIMAL_12_2_MAX)) {
    throw new OrderChangeRequestError(
      `款式“${itemName}”金额超过可保存上限 9,999,999,999.99 元`,
    );
  }
  return subtotal.toFixed(2);
}

function orderTotal(items: Array<{ subtotal: Prisma.Decimal }>): string {
  const total = items.reduce(
    (sum, item) => sum.plus(item.subtotal),
    new Decimal(0),
  );
  if (!total.isFinite() || total.isNegative() || total.gt(DECIMAL_12_2_MAX)) {
    throw new OrderChangeRequestError(
      '工单总额超过可保存上限 9,999,999,999.99 元',
    );
  }
  return total.toFixed(2);
}

/**
 * Applies an approved proposal under the same per-order advisory lock used by
 * production/status writers. A revision mismatch is persisted as STALE rather
 * than throwing (throwing would roll the status update back).
 */
export async function reviewOrderChangeRequest(
  input: ReviewOrderChangeRequestInput,
  actor: { id: string; role: Role },
) {
  if (actor.role !== Role.ADMIN) {
    throw new OrderChangeRequestError('只有管理员可以审核工单修改申请');
  }

  const locator = await db.orderChangeRequest.findUnique({
    where: { id: input.requestId },
    select: { orderId: true },
  });
  if (!locator) throw new OrderChangeRequestError('修改申请不存在');

  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orderCascadeLockKey(
      locator.orderId,
    )}))`;

    const request = await tx.orderChangeRequest.findUnique({
      where: { id: input.requestId },
      include: {
        requester: { select: { id: true, displayName: true, role: true } },
        order: {
          include: {
            items: {
              orderBy: { sequence: 'asc' },
              include: {
                tasks: true,
                shipmentLines: {
                  include: {
                    shipment: { select: { id: true, sequence: true } },
                  },
                },
              },
            },
            outsourceOrders: {
              where: { status: { not: 'CANCELLED' } },
              select: { id: true, orderItemIds: true },
            },
            shipments: {
              orderBy: { sequence: 'asc' },
              select: { id: true, sequence: true },
            },
          },
        },
      },
    });
    if (!request) throw new OrderChangeRequestError('修改申请不存在');
    if (request.status !== OrderChangeRequestStatus.PENDING) {
      throw new OrderChangeRequestError('该申请已经处理，不能重复审核');
    }

    const reviewedAt = new Date();
    if (input.decision === 'REJECT') {
      return tx.orderChangeRequest.update({
        where: { id: request.id },
        data: {
          status: OrderChangeRequestStatus.REJECTED,
          reviewedById: actor.id,
          reviewRemark: input.reviewRemark,
          reviewedAt,
        },
      });
    }

    if (request.baseRevision !== request.order.revision) {
      return tx.orderChangeRequest.update({
        where: { id: request.id },
        data: {
          status: OrderChangeRequestStatus.STALE,
          reviewedById: actor.id,
          reviewRemark:
            input.reviewRemark ??
            `工单已从第 ${request.baseRevision} 版更新到第 ${request.order.revision} 版，请重新提交申请`,
          reviewedAt,
        },
      });
    }
    if (!CHANGEABLE_ORDER_STATUSES.includes(request.order.status)) {
      throw new OrderChangeRequestError('工单已完工，不能批准修改');
    }

    const changes = readProposedChanges(request.proposedChanges);
    const itemById = new Map(request.order.items.map((item) => [item.id, item]));
    const primaryShipment = request.order.shipments.find(
      (shipment) => shipment.sequence === 1,
    );
    if (!primaryShipment) {
      throw new OrderChangeRequestError('工单缺少主收货地址，不能安全更新数量');
    }

    let nextSequence =
      Math.max(0, ...request.order.items.map((item) => item.sequence)) + 1;
    for (const change of changes) {
      if (change.operation === 'UPDATE') {
        const item = itemById.get(change.itemId);
        if (!item) throw new OrderChangeRequestError('原款式已不存在，请重新申请');

        if (change.quantity !== undefined && change.quantity !== item.quantity) {
          const hasStartedTask = item.tasks.some(
            (task) =>
              task.status === TaskStatus.IN_PROGRESS ||
              task.status === TaskStatus.COMPLETED,
          );
          if (hasStartedTask) {
            throw new OrderChangeRequestError(
              `款式“${item.name}”已有开工或完工记录，不能再修改数量`,
            );
          }
          const extraShipmentQty = item.shipmentLines
            .filter((line) => line.shipment.sequence > 1)
            .reduce((sum, line) => sum + line.quantity, 0);
          if (change.quantity < extraShipmentQty) {
            throw new OrderChangeRequestError(
              `款式“${item.name}”的新数量不能少于多地址已分配数量 ${extraShipmentQty}`,
            );
          }
          await tx.orderShipmentLine.upsert({
            where: {
              shipmentId_orderItemId: {
                shipmentId: primaryShipment.id,
                orderItemId: item.id,
              },
            },
            create: {
              shipmentId: primaryShipment.id,
              orderItemId: item.id,
              quantity: change.quantity - extraShipmentQty,
            },
            update: { quantity: change.quantity - extraShipmentQty },
          });
          await tx.productionTask.updateMany({
            where: {
              orderItemId: item.id,
              status: TaskStatus.PENDING,
            },
            data: { plannedQty: change.quantity },
          });
        }

        const quantity = change.quantity ?? item.quantity;
        await tx.orderItem.update({
          where: { id: item.id },
          data: {
            name: change.name,
            quantity: change.quantity,
            specification: change.specification,
            foilColors: change.foilColors,
            subtotal: storableOrderSubtotal(item.unitPrice, quantity, item.name),
          },
        });
        continue;
      }

      const template = itemById.get(change.templateItemId);
      if (!template) throw new OrderChangeRequestError('参考款式已不存在，请重新申请');
      const created = await tx.orderItem.create({
        data: {
          orderId: request.order.id,
          sequence: nextSequence,
          name: change.name,
          productId: template.productId,
          specification: change.specification ?? template.specification,
          paperType: template.paperType,
          quantity: change.quantity,
          crafts: template.crafts,
          foilColors: change.foilColors,
          isDoubleSided: template.isDoubleSided,
          isDoubleColor: template.isDoubleColor,
          unitPrice: template.unitPrice,
          subtotal: storableOrderSubtotal(
            template.unitPrice,
            change.quantity,
            change.name,
          ),
          suggestedPrice: template.suggestedPrice,
          remark: template.remark,
        },
        select: { id: true },
      });
      nextSequence += 1;
      await tx.orderShipmentLine.create({
        data: {
          shipmentId: primaryShipment.id,
          orderItemId: created.id,
          quantity: change.quantity,
        },
      });
      if (template.tasks.length > 0) {
        await tx.productionTask.createMany({
          data: template.tasks.map((task) => ({
            orderItemId: created.id,
            craftId: task.craftId,
            workerId: task.workerId,
            workerType: task.workerType,
            machineType: task.machineType,
            status: TaskStatus.PENDING,
            plannedQty: change.quantity,
          })),
        });
      }
      for (const outsource of request.order.outsourceOrders) {
        if (!outsource.orderItemIds.includes(template.id)) continue;
        await tx.outsourceOrder.update({
          where: { id: outsource.id },
          data: { orderItemIds: { push: created.id } },
        });
      }
    }

    const refreshedItems = await tx.orderItem.findMany({
      where: { orderId: request.order.id },
      select: { subtotal: true },
    });
    const nextRevision = request.order.revision + 1;
    const nextTotal = orderTotal(refreshedItems);
    const salesDelta = new Decimal(nextTotal).minus(request.order.totalAmount);
    await tx.order.update({
      where: { id: request.order.id },
      data: { revision: nextRevision, totalAmount: nextTotal },
    });
    const reviewed = await tx.orderChangeRequest.update({
      where: { id: request.id },
      data: {
        status: OrderChangeRequestStatus.APPROVED,
        reviewedById: actor.id,
        reviewRemark: input.reviewRemark,
        reviewedAt,
      },
    });
    await tx.orderLog.create({
      data: {
        orderId: request.order.id,
        operatorId: actor.id,
        action: 'CHANGE_REQUEST_APPROVED',
        changedFields: {
          revision: { before: request.baseRevision, after: nextRevision },
          totalAmount: {
            before: String(request.order.totalAmount),
            after: nextTotal,
          },
          requestId: request.id,
        },
        remark: input.reviewRemark ?? request.reason,
      },
    });

    if (
      request.order.submitterRole === Role.CUSTOMER_SERVICE &&
      request.order.billingMode === OrderBillingMode.CHARGE &&
      request.order.status !== OrderStatus.DRAFT
    ) {
      try {
        await assertCsOrderSalesLedgerReconciledInTx(
          tx,
          request.order.id,
          request.order.totalAmount,
        );
        await recordCsSalesEntryInTx(tx, {
          eventKey: `order:${request.order.id}:revision:${nextRevision}:change`,
          csUserId: request.order.submitterId,
          orderId: request.order.id,
          orderRevision: nextRevision,
          type: CsSalesEntryType.ORDER_CHANGED,
          amount: salesDelta,
          occurredAt: reviewedAt,
          remark: `工单修改申请 ${request.id} 审核通过`,
        });
      } catch (error) {
        if (error instanceof CsSalesLedgerError) {
          throw new OrderChangeRequestError(error.message);
        }
        throw error;
      }
    }
    return reviewed;
  });
}

export async function listOrderChangeRequests(input?: {
  status?: OrderChangeRequestStatus;
  limit?: number;
}) {
  return db.orderChangeRequest.findMany({
    where: input?.status ? { status: input.status } : undefined,
    orderBy: { createdAt: 'desc' },
    take: input?.limit ?? 100,
    include: {
      requester: { select: { displayName: true, role: true } },
      reviewedBy: { select: { displayName: true } },
      order: {
        select: {
          id: true,
          orderNo: true,
          customName: true,
          status: true,
          revision: true,
        },
      },
    },
  });
}
