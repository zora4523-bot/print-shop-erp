import {
  Prisma,
  type PriceAdjustment,
  type PriceTier,
  type Product,
  type ProductCategoryNode,
} from '../generated/prisma/client';
import { db } from './db';
import { acquirePriceRuleSnapshotWriteLock } from './price/rule-snapshot-lock';
import { sortBySearchRelevance } from './search-ranking';

export class PriceDictionaryInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PriceDictionaryInvariantError';
  }
}

export type PriceTierSummary = Pick<
  PriceTier,
  | 'id'
  | 'productId'
  | 'minQty'
  | 'unitPrice'
  | 'effectiveFrom'
  | 'effectiveTo'
  | 'createdAt'
> & {
  product: Pick<Product, 'id' | 'code' | 'name' | 'isActive'> & {
    categoryNode: Pick<ProductCategoryNode, 'name'>;
  };
};

export type PriceAdjustmentSummary = Pick<
  PriceAdjustment,
  | 'id'
  | 'name'
  | 'adjustmentType'
  | 'amount'
  | 'triggerCondition'
  | 'isActive'
  | 'createdAt'
  | 'updatedAt'
>;

const PRICE_TIER_SELECT = {
  id: true,
  productId: true,
  minQty: true,
  unitPrice: true,
  effectiveFrom: true,
  effectiveTo: true,
  createdAt: true,
  product: {
    select: {
      id: true,
      code: true,
      name: true,
      isActive: true,
      categoryNode: {
        select: {
          name: true,
        },
      },
    },
  },
} as const;

const PRICE_ADJUSTMENT_SELECT = {
  id: true,
  name: true,
  adjustmentType: true,
  amount: true,
  triggerCondition: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;

function normalizeSearchQuery(q?: string | null): string | null {
  const trimmed = q?.trim();
  return trimmed ? trimmed.slice(0, 80) : null;
}

function priceTierSearchFilter(
  q?: string | null,
): Prisma.PriceTierWhereInput | undefined {
  const query = normalizeSearchQuery(q);
  if (!query) return undefined;
  return {
    OR: [
      { product: { is: { code: { contains: query, mode: 'insensitive' } } } },
      { product: { is: { name: { contains: query, mode: 'insensitive' } } } },
      {
        product: {
          is: {
            categoryNode: { is: { name: { contains: query, mode: 'insensitive' } } },
          },
        },
      },
    ],
  };
}

function priceAdjustmentSearchFilter(
  q?: string | null,
): Prisma.PriceAdjustmentWhereInput | undefined {
  const query = normalizeSearchQuery(q);
  if (!query) return undefined;
  return {
    OR: [{ name: { contains: query, mode: 'insensitive' } }],
  };
}

export async function listPriceTiers(
  opts: { q?: string | null } = {},
): Promise<PriceTierSummary[]> {
  const query = normalizeSearchQuery(opts.q);
  const rows = await db.priceTier.findMany({
    where: priceTierSearchFilter(query),
    select: PRICE_TIER_SELECT,
    orderBy: [{ productId: 'asc' }, { minQty: 'asc' }, { effectiveFrom: 'desc' }],
  });
  return sortBySearchRelevance(rows, query, (row) => ({
    fields: [
      row.product.code,
      row.product.name,
      row.product.categoryNode.name,
      String(row.minQty),
    ],
  }));
}

export async function getPriceTierSummary(
  id: string,
): Promise<PriceTierSummary | null> {
  return db.priceTier.findUnique({
    where: { id },
    select: PRICE_TIER_SELECT,
  });
}

export async function listPriceAdjustments(
  opts: { q?: string | null } = {},
): Promise<PriceAdjustmentSummary[]> {
  const query = normalizeSearchQuery(opts.q);
  const rows = await db.priceAdjustment.findMany({
    where: priceAdjustmentSearchFilter(query),
    select: PRICE_ADJUSTMENT_SELECT,
    orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
  });
  return sortBySearchRelevance(rows, query, (row) => ({
    fields: [row.name, row.adjustmentType],
  }));
}

export async function getPriceAdjustmentSummary(
  id: string,
): Promise<PriceAdjustmentSummary | null> {
  return db.priceAdjustment.findUnique({
    where: { id },
    select: PRICE_ADJUSTMENT_SELECT,
  });
}

async function requireProduct(
  client: Prisma.TransactionClient,
  productId: string,
): Promise<void> {
  const product = await client.product.findUnique({
    where: { id: productId },
    select: { id: true },
  });
  if (!product) {
    throw new PriceDictionaryInvariantError('产品不存在');
  }
}

export type CreatePriceTierData = {
  productId: string;
  minQty: number;
  unitPrice: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
};

export type UpdatePriceTierData = CreatePriceTierData;

export async function createPriceTier(
  data: CreatePriceTierData,
): Promise<PriceTierSummary> {
  return db.$transaction(async (tx) => {
    await acquirePriceRuleSnapshotWriteLock(tx);
    await requireProduct(tx, data.productId);
    return tx.priceTier.create({
      data: {
        productId: data.productId,
        minQty: data.minQty,
        unitPrice: data.unitPrice,
        effectiveFrom: data.effectiveFrom,
        effectiveTo: data.effectiveTo,
      },
      select: PRICE_TIER_SELECT,
    });
  });
}

export async function updatePriceTier(
  id: string,
  data: UpdatePriceTierData,
): Promise<PriceTierSummary> {
  return db.$transaction(async (tx) => {
    await acquirePriceRuleSnapshotWriteLock(tx);
    const existing = await tx.priceTier.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) {
      throw new PriceDictionaryInvariantError('价格阶梯不存在');
    }
    await requireProduct(tx, data.productId);
    return tx.priceTier.update({
      where: { id },
      data: {
        productId: data.productId,
        minQty: data.minQty,
        unitPrice: data.unitPrice,
        effectiveFrom: data.effectiveFrom,
        effectiveTo: data.effectiveTo,
      },
      select: PRICE_TIER_SELECT,
    });
  });
}

export type CreatePriceAdjustmentData = {
  name: string;
  adjustmentType: PriceAdjustment['adjustmentType'];
  amount: string;
  triggerCondition: Record<string, unknown> | null;
};

export type UpdatePriceAdjustmentData = CreatePriceAdjustmentData;

function jsonObjectOrDbNull(
  value: Record<string, unknown> | null,
): Prisma.NullableJsonNullValueInput | Prisma.InputJsonObject {
  return value === null ? Prisma.DbNull : (value as Prisma.InputJsonObject);
}

export async function createPriceAdjustment(
  data: CreatePriceAdjustmentData,
): Promise<PriceAdjustmentSummary> {
  return db.$transaction(async (tx) => {
    await acquirePriceRuleSnapshotWriteLock(tx);
    return tx.priceAdjustment.create({
      data: {
        name: data.name,
        adjustmentType: data.adjustmentType,
        amount: data.amount,
        triggerCondition: jsonObjectOrDbNull(data.triggerCondition),
        isActive: true,
      },
      select: PRICE_ADJUSTMENT_SELECT,
    });
  });
}

export async function updatePriceAdjustment(
  id: string,
  data: UpdatePriceAdjustmentData,
): Promise<PriceAdjustmentSummary> {
  return db.$transaction(async (tx) => {
    await acquirePriceRuleSnapshotWriteLock(tx);
    const existing = await tx.priceAdjustment.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) {
      throw new PriceDictionaryInvariantError('加价规则不存在');
    }
    return tx.priceAdjustment.update({
      where: { id },
      data: {
        name: data.name,
        adjustmentType: data.adjustmentType,
        amount: data.amount,
        triggerCondition: jsonObjectOrDbNull(data.triggerCondition),
      },
      select: PRICE_ADJUSTMENT_SELECT,
    });
  });
}

export async function setPriceAdjustmentActive(
  id: string,
  isActive: boolean,
): Promise<PriceAdjustmentSummary> {
  return db.$transaction(async (tx) => {
    await acquirePriceRuleSnapshotWriteLock(tx);
    const existing = await tx.priceAdjustment.findUnique({
      where: { id },
      select: PRICE_ADJUSTMENT_SELECT,
    });
    if (!existing) {
      throw new PriceDictionaryInvariantError('加价规则不存在');
    }
    if (existing.isActive === isActive) return existing;
    return tx.priceAdjustment.update({
      where: { id },
      data: { isActive },
      select: PRICE_ADJUSTMENT_SELECT,
    });
  });
}
