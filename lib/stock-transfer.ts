import Decimal from 'decimal.js';
import { TxDirection, type Prisma } from '../generated/prisma/client';
import type { CreateStockTransferInput } from './auth/schemas';
import { db } from './db';
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

function ymd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

async function nextTransferNo(
  tx: Prisma.TransactionClient,
  now: Date,
): Promise<string> {
  const prefix = `ST${ymd(now)}-`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`print-shop-erp:stock-transfer-no:${prefix}`}))`;
  const last = await tx.stockTransfer.findFirst({
    where: { transferNo: { startsWith: prefix } },
    orderBy: { transferNo: 'desc' },
    select: { transferNo: true },
  });
  const previous = last?.transferNo.slice(prefix.length) ?? '0000';
  return `${prefix}${String(Number.parseInt(previous, 10) + 1).padStart(4, '0')}`;
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

  const createdId = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`print-shop-erp:stock-transfer-request:${input.idempotencyKey}`}))`;
    const existing = await tx.stockTransfer.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      select: { id: true },
    });
    if (existing) return existing.id;

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

    const transferNo = await nextTransferNo(tx, now);
    const transfer = await tx.stockTransfer.create({
      data: {
        transferNo,
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
        remark: `库存调拨 ${transferNo} 出库`,
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
        remark: `库存调拨 ${transferNo} 入库`,
      });
    } catch (error) {
      if (error instanceof MaterialInvariantError) {
        throw new StockTransferInvariantError(error.message);
      }
      throw error;
    }
    return transfer.id;
  });

  const created = await db.stockTransfer.findUnique({
    where: { id: createdId },
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
