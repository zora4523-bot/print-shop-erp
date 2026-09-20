import Decimal from 'decimal.js';
import { Prisma } from '../generated/prisma/client';
import { createBomSchema, type CreateBomInput } from './auth/schemas';
import { blankSpecificationKey, BLANK_SPECIFICATIONS } from '@/lib/price/blank-paper';
import { catalogPaperIdentityKeys, findCatalogPaperIdentityMatches } from '@/lib/order/catalog-paper-identity';

export const BLANK_BOM_CATEGORY_SETTING = 'blank_stock_bom_category_node_id';
const HISTORICAL_BLANK_BOM_MESSAGE = '历史空白封产品物料清单只读，请按纸张和规格新建物料清单';
import {
  paginatedResult,
  paginationWindow,
  type PaginatedResult,
} from './admin/table';
import { db } from './db';
import { acquirePriceRuleSnapshotWriteLock } from '@/lib/price/rule-snapshot-lock';

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
  blankPaperMaterialId: true,
  blankSpecificationKey: true,
  blankPaperMaterial: { select: { id: true, name: true, specification: true, category: true, isActive: true } },
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
      category: true,
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
  blankPaperMaterialId: true,
  blankSpecificationKey: true,
  blankPaperMaterial: { select: { id: true, name: true, specification: true, category: true, isActive: true } },
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
      category: true,
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

export async function listBomProductOptions() {
  return db.product.findMany({
    where: { category: { not: 'BLANK_STOCK' }, isActive: true, categoryNode: { isActive: true } },
    select: { id: true, code: true, name: true, categoryNode: { select: { name: true } } },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
  });
}

export async function getBomDetail(id: string): Promise<BomDetail | null> {
  return db.billOfMaterial.findUnique({
    where: { id },
    select: BOM_DETAIL_SELECT,
  });
}

function targetWhere(data: CreateBomInput) {
  return {
    productId: data.targetType === 'PRODUCT' ? data.productId : null,
    categoryNodeId: data.targetType === 'CATEGORY' ? data.categoryNodeId : null,
    blankPaperMaterialId: data.targetType === 'BLANK' ? data.blankPaperMaterialId ?? null : null,
    blankSpecificationKey: data.targetType === 'BLANK' ? data.blankSpecificationKey ?? null : null,
  };
}

async function assertActiveTarget(client: Prisma.TransactionClient, data: Pick<CreateBomInput, 'targetType' | 'productId' | 'categoryNodeId' | 'blankPaperMaterialId'> & { blankSpecificationKey?: string | null }) {
  if (data.targetType === 'BLANK') {
    const paper = await client.material.findUnique({ where: { id: data.blankPaperMaterialId ?? '' } });
    if (!paper || paper.category !== 'PAPER' || !paper.isActive ||
        catalogPaperIdentityKeys(paper).size !== 1 ||
        !BLANK_SPECIFICATIONS.some((spec) => spec.key === data.blankSpecificationKey)) {
      throw new BomInvariantError('请选择身份明确的启用纸张与标准规格');
    }
    const papers = await client.material.findMany({ where: { category: 'PAPER' } });
    if (findCatalogPaperIdentityMatches(papers, paper).length !== 1) {
      throw new BomInvariantError('纸张身份重复，请先检查纸张资料');
    }
    return;
  }
  if (data.targetType === 'PRODUCT') {
    const product = await client.product.findUnique({
      where: { id: data.productId ?? '' },
      select: { id: true, category: true, isActive: true, categoryNode: { select: { isActive: true } } },
    });
    if (product?.category === 'BLANK_STOCK') throw new BomInvariantError(HISTORICAL_BLANK_BOM_MESSAGE);
    if (!product || !product.isActive || !product.categoryNode.isActive) {
      throw new BomInvariantError('产品不存在或已停用');
    }
    return;
  }
  const categoryNode = await client.productCategoryNode.findUnique({
    where: { id: data.categoryNodeId ?? '' }, select: { id: true, isActive: true },
  });
  if (!categoryNode || !categoryNode.isActive) throw new BomInvariantError('产品分类不存在或已停用');
}

async function assertActiveMaterials(client: Prisma.TransactionClient, materialIds: readonly string[]) {
  const uniqueIds = [...new Set(materialIds)];
  const rows = await client.material.findMany({
    where: { id: { in: uniqueIds }, isActive: true },
    select: { id: true },
  });
  if (rows.length !== uniqueIds.length) {
    const found = new Set(rows.map((row) => row.id));
    const missing = uniqueIds.filter((id) => !found.has(id));
    throw new BomInvariantError(`物料不存在或已停用：${missing.join(', ')}`);
  }
}

export async function createBom(raw: CreateBomInput): Promise<BomDetail> {
  const parsed = createBomSchema.safeParse(raw);
  if (!parsed.success) throw new BomInvariantError(parsed.error.issues[0]?.message ?? '物料清单输入无效');
  const data = parsed.data;
  return db.$transaction(async (client) => {
    await acquirePriceRuleSnapshotWriteLock(client);
    await assertActiveTarget(client, data);
    await assertActiveMaterials(client, data.items.map((item) => item.materialId));
    const target = targetWhere(data);

    return client.billOfMaterial.create({
      data: {
        ...target,
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
  });
}

export async function setBomActive(
  id: string,
  isActive: boolean,
): Promise<BomDetail> {
  return db.$transaction(async (client) => {
    await acquirePriceRuleSnapshotWriteLock(client);
    const target = await client.billOfMaterial.findUnique({ where: { id }, select: BOM_DETAIL_SELECT });
    if (!target) throw new BomInvariantError('BOM 不存在');
    if (target.product?.category === 'BLANK_STOCK') throw new BomInvariantError(HISTORICAL_BLANK_BOM_MESSAGE);
    if (target.isActive === isActive) return target;

    if (isActive) {
      if (target.blankPaperMaterialId) {
        await assertActiveTarget(client, { targetType: 'BLANK', blankPaperMaterialId: target.blankPaperMaterialId,
          blankSpecificationKey: target.blankSpecificationKey, productId: null, categoryNodeId: null });
        const existing = await client.billOfMaterial.findFirst({
          where: { id: { not: id }, blankPaperMaterialId: target.blankPaperMaterialId,
            blankSpecificationKey: target.blankSpecificationKey, isActive: true }, select: { id: true },
        });
        if (existing) throw new BomInvariantError('该纸张规格已有启用 BOM');
      }
      if (target.productId) {
        if (
          !target.product?.isActive ||
          !target.product.categoryNode.isActive
        ) {
          throw new BomInvariantError('产品不存在或已停用');
        }
        const existing = await client.billOfMaterial.findFirst({
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
        const existing = await client.billOfMaterial.findFirst({
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

    return client.billOfMaterial.update({
      where: { id },
      data: { isActive },
      select: BOM_DETAIL_SELECT,
    });
  });
}


export type OrderItemForMaterialEstimate = {
  id: string;
  sequence: number;
  name: string;
  quantity: number;
  productId: string | null;
  pricingRoute?: string;
  paperType?: string | null;
  paperWeightGsm?: number | null;
  specification?: string | null;
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
    source: 'PRODUCT' | 'CATEGORY' | 'BLANK' | 'NONE';
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

  const blankItems = items.filter((item) => !item.productId && item.pricingRoute === 'STOCK_BLANK');
  const blankTargets = new Map<string, { paperId: string; specificationKey: string }>();
  let blankCategoryId: string | null = null;
  if (blankItems.length) {
    const [papers, setting] = await Promise.all([
      db.material.findMany({ where: { category: 'PAPER' } }),
      db.setting.findUnique({ where: { key: BLANK_BOM_CATEGORY_SETTING } }),
    ]);
    if (setting && setting.value !== null) {
      if (typeof setting.value !== 'string' || !setting.value) throw new BomInvariantError('空白封默认用料分类配置无效');
      const category = await db.productCategoryNode.findUnique({ where: { id: setting.value } });
      if (!category?.isActive || category.legacyCategory !== 'BLANK_STOCK') {
        throw new BomInvariantError('空白封默认用料分类不存在或已失效');
      }
      blankCategoryId = category.id;
      if (!categoryNodeIds.includes(category.id)) categoryNodeIds.push(category.id);
    }
    for (const item of blankItems) {
      const matches = findCatalogPaperIdentityMatches(papers, {
        name: item.paperType ?? '', specification: item.paperWeightGsm ? `${item.paperWeightGsm}g` : null,
      });
      if (matches.length > 1) throw new BomInvariantError('空白封用料纸张身份重复，请先检查纸张资料');
      const specificationKey = blankSpecificationKey(item.specification);
      if (matches.length === 1 && specificationKey && catalogPaperIdentityKeys(matches[0]!).size === 1) {
        blankTargets.set(item.id, { paperId: matches[0]!.id, specificationKey });
      }
    }
  }

  const targetFilters: Prisma.BillOfMaterialWhereInput[] = [];
  if (productIds.length > 0) {
    targetFilters.push({ productId: { in: productIds } });
  }
  if (categoryNodeIds.length > 0) {
    targetFilters.push({ categoryNodeId: { in: categoryNodeIds } });
  }

  for (const target of blankTargets.values()) {
    targetFilters.push({ blankPaperMaterialId: target.paperId, blankSpecificationKey: target.specificationKey });
  }
  const boms = targetFilters.length ? await db.billOfMaterial.findMany({
    where: {
      isActive: true,
      OR: targetFilters,
    },
    select: BOM_DETAIL_SELECT,
  }) : [];
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
  const byBlank = new Map(boms.filter((bom) => bom.blankPaperMaterialId)
    .map((bom) => [`${bom.blankPaperMaterialId}:${bom.blankSpecificationKey}`, bom] as const));
  const totals = new Map<
    string,
    { code: string; name: string; unit: string; quantity: Decimal }
  >();

  const estimatedItems = items.map((item) => {
    const productBom = item.productId ? byProduct.get(item.productId) : undefined;
    const blankTarget = blankTargets.get(item.id);
    const blankBom = blankTarget ? byBlank.get(`${blankTarget.paperId}:${blankTarget.specificationKey}`) : undefined;
    const categoryId = item.product?.categoryNodeId ?? (blankTarget ? blankCategoryId : null);
    const categoryBom = categoryId ? byCategory.get(categoryId) : undefined;
    const bom = productBom ?? blankBom ?? categoryBom ?? null;
    const source: OrderMaterialUsageEstimate['items'][number]['source'] =
      productBom ? 'PRODUCT' : blankBom ? 'BLANK' : categoryBom ? 'CATEGORY' : 'NONE';
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
