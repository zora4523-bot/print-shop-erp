import Decimal from 'decimal.js';
import { OutsourceStatus, Role } from '../generated/prisma/enums';
import { db } from './db';
import {
  transitionOutsource,
  InvalidOutsourceTransitionError,
} from './outsource/status-machine';
import { canAttachOutsource } from './order/status-machine';
import type {
  CreateOutsourceInput,
  MarkOutsourceReceivedInput,
} from './auth/schemas';

export class OutsourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OutsourceError';
  }
}

export type CreatedOutsource = { id: string };

// Simple non-transactional create — one INSERT. We verify the order
// exists and keep orderItemIds as a plain string[] (no FK relation
// table). Prisma already rejects a missing orderId FK, so we don't
// redundantly findFirst; the error maps cleanly to { status: 'error' }.
//
// Actor is taken but not used today — kept in the signature for
// forward-compat when we start writing an audit log for
// outsource-order mutations.
export async function createOutsourceOrder(
  input: CreateOutsourceInput,
  actor: { id: string; role: Role },
): Promise<CreatedOutsource> {
  void actor;
  // Reject when the parent order is no longer in a production-active
  // state — SHIPPED / FINISHED / CANCELLED orders shouldn't accept
  // new production work (Codex round 87 / P2). Lib layer is the real
  // gate; the order detail page also hides the entry button for the
  // same statuses, but that UI hint isn't authoritative.
  const order = await db.order.findUnique({
    where: { id: input.orderId },
    select: { status: true },
  });
  if (!order) throw new OutsourceError('工单不存在');
  if (!canAttachOutsource(order.status)) {
    throw new OutsourceError(
      `工单状态 ${order.status} 不允许新建外协（已发货 / 已完成 / 已取消）`,
    );
  }

  const row = await db.outsourceOrder.create({
    data: {
      orderId: input.orderId,
      orderItemIds: input.orderItemIds,
      supplierName: input.supplierName,
      supplierContact: input.supplierContact,
      craftDescription: input.craftDescription,
      specialRequirement: input.specialRequirement,
      totalQty: input.totalQty ?? null,
      expectedDate: input.expectedDate ?? null,
      amount:
        input.amount === null || input.amount === undefined
          ? null
          : new Decimal(input.amount).toFixed(2),
      remark: input.remark,
      status: OutsourceStatus.SENT,
    },
    select: { id: true },
  });
  return row;
}

export type OutsourceMutationResult = {
  id: string;
  status: OutsourceStatus;
};

// SENT / IN_PROGRESS → RECEIVED, stamps actualDate. The lib layer
// does NOT cascade into the Order status — the outsource gate SPEC
// describes (§3.2) is intentionally deferred for MVP, since internal
// scheduling has been happening in parallel anyway.
export async function markOutsourceReceived(
  id: string,
  input: MarkOutsourceReceivedInput,
  actor: { id: string; role: Role },
  now: Date = new Date(),
): Promise<OutsourceMutationResult> {
  void actor;
  const row = await db.outsourceOrder.findUnique({
    where: { id },
    select: { id: true, status: true },
  });
  if (!row) throw new OutsourceError('外协单不存在');
  transitionOutsource(row.status, OutsourceStatus.RECEIVED);

  const updated = await db.outsourceOrder.update({
    where: { id },
    data: {
      status: OutsourceStatus.RECEIVED,
      actualDate: input.actualDate ?? now,
    },
    select: { id: true, status: true },
  });
  return updated;
}

export async function cancelOutsourceOrder(
  id: string,
  actor: { id: string; role: Role },
): Promise<OutsourceMutationResult> {
  void actor;
  const row = await db.outsourceOrder.findUnique({
    where: { id },
    select: { id: true, status: true },
  });
  if (!row) throw new OutsourceError('外协单不存在');
  transitionOutsource(row.status, OutsourceStatus.CANCELLED);
  return db.outsourceOrder.update({
    where: { id },
    data: { status: OutsourceStatus.CANCELLED },
    select: { id: true, status: true },
  });
}

// ─────────────────────────────────────────────────────────────────────
// Reads
// ─────────────────────────────────────────────────────────────────────

export async function listOutsourceOrders(
  filter: { status?: OutsourceStatus } = {},
) {
  return db.outsourceOrder.findMany({
    where: filter.status ? { status: filter.status } : undefined,
    orderBy: [{ createdAt: 'desc' }],
    select: {
      id: true,
      status: true,
      supplierName: true,
      craftDescription: true,
      totalQty: true,
      expectedDate: true,
      actualDate: true,
      amount: true,
      createdAt: true,
      order: { select: { id: true, orderNo: true, isUrgent: true } },
    },
  });
}

export async function getOutsourceOrderDetail(id: string) {
  return db.outsourceOrder.findUnique({
    where: { id },
    select: {
      id: true,
      orderId: true,
      orderItemIds: true,
      supplierName: true,
      supplierContact: true,
      craftDescription: true,
      specialRequirement: true,
      totalQty: true,
      expectedDate: true,
      actualDate: true,
      amount: true,
      status: true,
      remark: true,
      createdAt: true,
      updatedAt: true,
      order: { select: { id: true, orderNo: true, isUrgent: true } },
    },
  });
}

export { InvalidOutsourceTransitionError };
