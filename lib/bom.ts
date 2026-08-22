import Decimal from 'decimal.js';
import { Prisma } from '../generated/prisma/client';
import type { CreateBomInput } from './auth/schemas';
import {
  paginatedResult,
  paginationWindow,
  type PaginatedResult,
} from './admin/table';
import { db } from './db';

export class BomInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BomInvariantError';
  }
}

const BOM_DETAIL_SELECT = {
  id: true,
  productId: true,
  categoryNodeId: true,
  name: true,
  version: true,
  baseQuantity: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  product: {
    select: {
      id: true,
      code: true,
      name: true,
      isActive: true,
      categoryNode: { select: { id: true, name: true, isActive: true } },
    },
  },
  categoryNode: {
    select: {
      id: true,
      path: true,
      name: true,
      isActive: true,
    },
  },
  items: {
    select: {
      id: true,
      bomId: true,
      materialId: true,
      quantity: true,
      sortOrder: true,
      remark: true,
      createdAt: true,
      updatedAt: true,
      material: {
        select: {
          id: true,
          code: true,
          name: true,
          unit: true,
          isActive: true,
        },
      },
    },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  },
} satisfies Prisma.BillOfMaterialSelect;

export type BomDetail = Prisma.BillOfMaterialGetPayload<{
  select: typeof BOM_DETAIL_SELECT;
}>;

const BOM_SUMMARY_SELECT = {
  id: true,
  productId: true,
  categoryNodeId: true,
  name: true,
  version: true,
  baseQuantity: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  product: {
    select: {
      id: true,
      code: true,
      name: true,
      isActive: true,
      categoryNode: { select: { id: true, name: true, isActive: true } },
    },
  },
  categoryNode: {
    select: {
      id: true,
      path: true,
      name: true,
      isActive: true,
    },
  },
  _count: { select: { items: true } },
} satisfies Prisma.BillOfMaterialSelect;

export type BomSummary = Prisma.BillOfMaterialGetPayload<{
  select: typeof BOM_SUMMARY_SELECT;
}>;

const BOM_LIST_ORDER = [
  { isActive: 'desc' as const },
  { product: { name: 'asc' as const } },
  { categoryNode: { path: 'asc' as const } },
  { version: 'desc' as const },
  { id: 'asc' as const },
];

export async function listBoms(): Promise<BomSummary[]> {
  return db.billOfMaterial.findMany({
    select: BOM_SUMMARY_SELECT,
    orderBy: BOM_LIST_ORDER,
  });
}

export async function listBomsPage(opts: {
  page: number;
  pageSize: number;
}): Promise<PaginatedResult<BomSummary>> {
  const total = await db.billOfMaterial.count();
  const window = paginationWindow(total, opts.page, opts.pageSize);
  const rows = await db.billOfMaterial.findMany({
    select: BOM_SUMMARY_SELECT,
    orderBy: BOM_LIST_ORDER,
    skip: window.skip,
    take: window.take,
  });
  return paginatedResult(rows, total, window);
}

export async function getBomDetail(id: string): Promise<BomDetail | null> {
  return db.billOfMaterial.findUnique({
    where: { id },
    select: BOM_DETAIL_SELECT,
  });
}

function targetWhere(data: CreateBomInput): {
  productId: string | null;
  categoryNodeId: string | null;
} {
  if (data.targetType === 'PRODUCT') {
    return { productId: data.productId, categoryNodeId: null };
  }
  return { productId: null, categoryNodeId: data.categoryNodeId };
}

async function assertActiveTarget(data: CreateBomInput) {
  if (data.targetType === 'PRODUCT') {
    const product = await db.product.findUnique({
      where: { id: data.productId ?? '' },
      select: {
        id: true,
        isActive: true,
        categoryNode: { select: { isActive: true } },
      },
    });
    if (!product || !product.isActive || !product.categoryNode.isActive) {
      throw new BomInvariantError('产品不存在或已停用');
    }
    return;
  }

  const categoryNode = await db.productCategoryNode.findUnique({
    where: { id: data.categoryNodeId ?? '' },
    select: { id: true, isActive: true },
  });
  if (!categoryNode || !categoryNode.isActive) {
    throw new BomInvariantError('产品分类不存在或已停用');
  }
}

async function assertActiveMaterials(materialIds: readonly string[]) {
  const uniqueIds = [...new Set(materialIds)];
  const rows = await db.material.findMany({
    where: { id: { in: uniqueIds }, isActive: true },
    select: { id: true },
  });
  if (rows.length !== uniqueIds.length) {
    const found = new Set(rows.map((row) => row.id));
    const missing = uniqueIds.filter((id) => !found.has(id));
    throw new BomInvariantError(`物料不存在或已停用：${missing.join(', ')}`);
  }
}

export async function createBom(data: CreateBomInput): Promise<BomDetail> {
  await assertActiveTarget(data);
  await assertActiveMaterials(data.items.map((item) => item.materialId));
  const target = targetWhere(data);

  return db.billOfMaterial.create({
    data: {
      productId: target.productId,
      categoryNodeId: target.categoryNodeId,
      name: data.name,
      version: data.version,
      baseQuantity: data.baseQuantity,
      isActive: true,
      items: {
        create: data.items.map((item, index) => ({
          materialId: item.materialId,
          quantity: item.quantity,
          sortOrder: (index + 1) * 10,
          remark: item.remark,
        })),
      },
    },
    select: BOM_DETAIL_SELECT,
  });
}

export async function setBomActive(
  id: string,
  isActive: boolean,
): Promise<BomDetail> {
  const target = await getBomDetail(id);
  if (!target) throw new BomInvariantError('BOM 不存在');
  if (target.isActive === isActive) return target;

  if (isActive) {
    if (target.productId) {
      if (
        !target.product?.isActive ||
        !target.product.categoryNode.isActive
      ) {
        throw new BomInvariantError('产品不存在或已停用');
      }
      const existing = await db.billOfMaterial.findFirst({
        where: {
          id: { not: id },
          productId: target.productId,
          isActive: true,
        },
        select: { id: true },
      });
      if (existing) throw new BomInvariantError('该产品已有启用 BOM');
    }
    if (target.categoryNodeId) {
      if (!target.categoryNode?.isActive) {
        throw new BomInvariantError('产品分类不存在或已停用');
      }
      const existing = await db.billOfMaterial.findFirst({
        where: {
          id: { not: id },
          categoryNodeId: target.categoryNodeId,
          isActive: true,
        },
        select: { id: true },
      });
      if (existing) throw new BomInvariantError('该产品分类已有启用 BOM');
    }
  }

  return db.billOfMaterial.update({
    where: { id },
    data: { isActive },
    select: BOM_DETAIL_SELECT,
  });
}

export type OrderItemForMaterialEstimate = {
  id: string;
  sequence: number;
  name: string;
  quantity: number;
  productId: string | null;
  product?: {
    id: string;
    name: string;
    categoryNodeId: string;
    categoryNode: { id: string; name: string };
  } | null;
};

export type OrderMaterialUsageEstimate = {
  items: Array<{
    orderItemId: string;
    sequence: number;
    itemName: string;
    quantity: number;
    source: 'PRODUCT' | 'CATEGORY' | 'NONE';
    bom: Pick<
      BomDetail,
      'id' | 'name' | 'version' | 'baseQuantity' | 'productId' | 'categoryNodeId'
    > | null;
    materials: Array<{
      materialId: string;
      code: string;
      name: string;
      unit: string;
      quantity: string;
      bomQuantity: string;
    }>;
  }>;
  totals: Array<{
    materialId: string;
    code: string;
    name: string;
    unit: string;
    quantity: string;
  }>;
};

export async function estimateMaterialUsageForOrderItems(
  items: readonly OrderItemForMaterialEstimate[],
): Promise<OrderMaterialUsageEstimate> {
  const productIds = [
    ...new Set(items.map((item) => item.productId).filter((id): id is string => Boolean(id))),
  ];
  const categoryNodeIds = [
    ...new Set(
      items
        .map((item) => item.product?.categoryNodeId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  if (productIds.length === 0 && categoryNodeIds.length === 0) {
    return { items: [], totals: [] };
  }

  const targetFilters: Prisma.BillOfMaterialWhereInput[] = [];
  if (productIds.length > 0) {
    targetFilters.push({ productId: { in: productIds } });
  }
  if (categoryNodeIds.length > 0) {
    targetFilters.push({ categoryNodeId: { in: categoryNodeIds } });
  }

  const boms = await db.billOfMaterial.findMany({
    where: {
      isActive: true,
      OR: targetFilters,
    },
    select: BOM_DETAIL_SELECT,
  });
  const byProduct = new Map(
    boms
      .filter((bom) => bom.productId)
      .map((bom) => [bom.productId!, bom] as const),
  );
  const byCategory = new Map(
    boms
      .filter((bom) => bom.categoryNodeId)
      .map((bom) => [bom.categoryNodeId!, bom] as const),
  );
  const totals = new Map<
    string,
    { code: string; name: string; unit: string; quantity: Decimal }
  >();

  const estimatedItems = items.map((item) => {
    const productBom = item.productId ? byProduct.get(item.productId) : undefined;
    const categoryBom = item.product?.categoryNodeId
      ? byCategory.get(item.product.categoryNodeId)
      : undefined;
    const bom = productBom ?? categoryBom ?? null;
    const source: OrderMaterialUsageEstimate['items'][number]['source'] =
      productBom ? 'PRODUCT' : categoryBom ? 'CATEGORY' : 'NONE';
    if (!bom) {
      return {
        orderItemId: item.id,
        sequence: item.sequence,
        itemName: item.name,
        quantity: item.quantity,
        source,
        bom: null,
        materials: [],
      };
    }

    const orderQuantity = new Decimal(item.quantity);
    const baseQuantity = new Decimal(bom.baseQuantity);
    const materials = bom.items.map((bomItem) => {
      const required = new Decimal(String(bomItem.quantity))
        .times(orderQuantity)
        .div(baseQuantity);
      const currentTotal = totals.get(bomItem.materialId) ?? {
        code: bomItem.material.code,
        name: bomItem.material.name,
        unit: bomItem.material.unit,
        quantity: new Decimal(0),
      };
      currentTotal.quantity = currentTotal.quantity.plus(required);
      totals.set(bomItem.materialId, currentTotal);

      return {
        materialId: bomItem.materialId,
        code: bomItem.material.code,
        name: bomItem.material.name,
        unit: bomItem.material.unit,
        quantity: required.toFixed(4),
        bomQuantity: String(bomItem.quantity),
      };
    });

    return {
      orderItemId: item.id,
      sequence: item.sequence,
      itemName: item.name,
      quantity: item.quantity,
      source,
      bom: {
        id: bom.id,
        name: bom.name,
        version: bom.version,
        baseQuantity: bom.baseQuantity,
        productId: bom.productId,
        categoryNodeId: bom.categoryNodeId,
      },
      materials,
    };
  });

  return {
    items: estimatedItems,
    totals: [...totals.entries()]
      .map(([materialId, total]) => ({
        materialId,
        code: total.code,
        name: total.name,
        unit: total.unit,
        quantity: total.quantity.toFixed(4),
      }))
      .sort((a, b) => a.code.localeCompare(b.code, 'zh-Hans-CN')),
  };
}
