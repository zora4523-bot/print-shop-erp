import Decimal from 'decimal.js';
import { TxDirection, type Prisma } from '../generated/prisma/client';
import type { CreateStockTransferInput } from './auth/schemas';
import { db } from './db';
import {
  DailyDocumentNumberExhaustedError,
  nextDailyDocumentNumber,
} from './daily-document-number';
import { applyMaterialStockMovement, MaterialInvariantError } from './material';

export class StockTransferInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StockTransferInvariantError';
  }
}

const STOCK_TRANSFER_SELECT = {
  id: true,
  transferNo: true,
  materialId: true,
  sourceLocationId: true,
  destinationLocationId: true,
  quantity: true,
  operatorId: true,
  remark: true,
  occurredAt: true,
  material: { select: { code: true, name: true, unit: true } },
  sourceLocation: {
    select: {
      code: true,
      name: true,
      warehouse: { select: { code: true, name: true } },
    },
  },
  destinationLocation: {
    select: {
      code: true,
      name: true,
      warehouse: { select: { code: true, name: true } },
    },
  },
  operator: { select: { displayName: true } },
} satisfies Prisma.StockTransferSelect;

export type StockTransferSummary = Prisma.StockTransferGetPayload<{
  select: typeof STOCK_TRANSFER_SELECT;
}>;

// 幂等重放只回放「同一请求」：同键不同物料 / 库位 / 数量 / 备注 / 操作人
// 必须拒绝，否则操作员改过的内容会被旧调拨单静默顶替（与手工出入库
// lib/material.ts 的同键异载荷拒绝一致）。表里已存全部请求字段，不需要指纹列。
const STOCK_TRANSFER_REQUEST_SELECT = {
  id: true,
  materialId: true,
  sourceLocationId: true,
  destinationLocationId: true,
  quantity: true,
  remark: true,
  operatorId: true,
} satisfies Prisma.StockTransferSelect;

type StockTransferRequestRecord = Prisma.StockTransferGetPayload<{
  select: typeof STOCK_TRANSFER_REQUEST_SELECT;
}>;

function assertSameTransferRequest(
  existing: StockTransferRequestRecord,
  input: CreateStockTransferInput,
  quantity: Decimal,
  actor: { id: string },
): void {
  const same =
    existing.materialId === input.materialId &&
    existing.sourceLocationId === input.sourceLocationId &&
    existing.destinationLocationId === input.destinationLocationId &&
    new Decimal(existing.quantity.toString()).eq(quantity) &&
    (existing.remark ?? null) === (input.remark ?? null) &&
    existing.operatorId === actor.id;
  if (!same) {
    throw new StockTransferInvariantError(
      '调拨请求与原记录不一致，请刷新页面后重新核对',
    );
  }
}

export async function createStockTransfer(
  input: CreateStockTransferInput,
  actor: { id: string },
  now: Date = new Date(),
): Promise<StockTransferSummary> {
  if (input.sourceLocationId === input.destinationLocationId) {
    throw new StockTransferInvariantError('来源库位和目标库位不能相同');
  }
  const quantity = new Decimal(input.quantity);
  if (!quantity.isFinite() || quantity.lte(0)) {
    throw new StockTransferInvariantError('调拨数量必须大于 0');
  }

  const existingBeforeReservation = await db.stockTransfer.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
    select: STOCK_TRANSFER_REQUEST_SELECT,
  });
  if (existingBeforeReservation) {
    assertSameTransferRequest(existingBeforeReservation, input, quantity, actor);
    return readStockTransfer(existingBeforeReservation.id);
  }

  // 调拨单号在幂等快查后、锁事务前独立预留；后续校验失败，或
  // 并发重放在事务内命中 existing，都会留下空隙。调拨编号明确允许不连续。
  let reservedTransferNo: string;
  try {
    reservedTransferNo = await nextDailyDocumentNumber('STOCK_TRANSFER', now);
  } catch (error) {
    if (error instanceof DailyDocumentNumberExhaustedError) {
      throw new StockTransferInvariantError(error.message);
    }
    throw error;
  }

  const createdId = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`print-shop-erp:stock-transfer-request:${input.idempotencyKey}`}))`;
    const existing = await tx.stockTransfer.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      select: STOCK_TRANSFER_REQUEST_SELECT,
    });
    if (existing) {
      assertSameTransferRequest(existing, input, quantity, actor);
      return existing.id;
    }

    const [material, source, destination] = await Promise.all([
      tx.material.findUnique({
        where: { id: input.materialId },
        select: { id: true, isActive: true },
      }),
      tx.warehouseLocation.findUnique({
        where: { id: input.sourceLocationId },
        select: {
          id: true,
          isActive: true,
          warehouse: { select: { isActive: true } },
        },
      }),
      tx.warehouseLocation.findUnique({
        where: { id: input.destinationLocationId },
        select: {
          id: true,
          isActive: true,
          warehouse: { select: { isActive: true } },
        },
      }),
    ]);
    if (!material) throw new StockTransferInvariantError('物料不存在');
    if (!material.isActive) throw new StockTransferInvariantError('物料已停用');
    if (!source) throw new StockTransferInvariantError('来源库位不存在');
    if (!destination) throw new StockTransferInvariantError('目标库位不存在');
    if (!source.isActive || !source.warehouse.isActive) {
      throw new StockTransferInvariantError('来源库位或所属仓库已停用');
    }
    if (!destination.isActive || !destination.warehouse.isActive) {
      throw new StockTransferInvariantError('目标库位或所属仓库已停用');
    }

    const transfer = await tx.stockTransfer.create({
      data: {
        transferNo: reservedTransferNo,
        idempotencyKey: input.idempotencyKey,
        materialId: input.materialId,
        sourceLocationId: input.sourceLocationId,
        destinationLocationId: input.destinationLocationId,
        quantity: quantity.toFixed(2),
        operatorId: actor.id,
        remark: input.remark,
        occurredAt: now,
      },
      select: { id: true },
    });

    try {
      await applyMaterialStockMovement(tx, {
        materialId: input.materialId,
        locationId: input.sourceLocationId,
        direction: TxDirection.OUT,
        quantity: quantity.toFixed(2),
        reasonType: 'TRANSFER_OUT',
        stockTransferId: transfer.id,
        operatorId: actor.id,
        unitCost: null,
        remark: `库存调拨 ${reservedTransferNo} 出库`,
      });
      await applyMaterialStockMovement(tx, {
        materialId: input.materialId,
        locationId: input.destinationLocationId,
        direction: TxDirection.IN,
        quantity: quantity.toFixed(2),
        reasonType: 'TRANSFER_IN',
        stockTransferId: transfer.id,
        operatorId: actor.id,
        unitCost: null,
        remark: `库存调拨 ${reservedTransferNo} 入库`,
      });
    } catch (error) {
      if (error instanceof MaterialInvariantError) {
        throw new StockTransferInvariantError(error.message);
      }
      throw error;
    }
    return transfer.id;
  });

  return readStockTransfer(createdId);
}

async function readStockTransfer(id: string): Promise<StockTransferSummary> {
  const created = await db.stockTransfer.findUnique({
    where: { id },
    select: STOCK_TRANSFER_SELECT,
  });
  if (!created) throw new StockTransferInvariantError('调拨单创建后读取失败');
  return created;
}

export async function listRecentStockTransfers(
  limit = 20,
): Promise<StockTransferSummary[]> {
  return db.stockTransfer.findMany({
    select: STOCK_TRANSFER_SELECT,
    orderBy: [{ occurredAt: 'desc' }, { transferNo: 'desc' }],
    take: Math.min(Math.max(limit, 1), 100),
  });
}
