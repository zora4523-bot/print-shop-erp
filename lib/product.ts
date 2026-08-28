import { randomUUID } from 'node:crypto';
import {
  Prisma,
  ProductCategory,
  type Product,
  type ProductCategoryNode,
} from '../generated/prisma/client';
import {
  CustomerPriceBookPurpose,
  CustomerPriceRuleKind,
  OrderSettlementType,
} from '../generated/prisma/enums';
import { db } from './db';
import {
  paginatedResult,
  paginationWindow,
  type PaginatedResult,
} from './admin/table';
import { resolveBusinessCode } from './business-code';
import {
  acquirePriceRuleSnapshotReadLock,
  acquirePriceRuleSnapshotWriteLock,
} from './price/rule-snapshot-lock';
import { sortBySearchRelevance } from './search-ranking';
import {
  writeAuditLogInTx,
  type AuditActor,
} from './audit-log';
import { isRetiredProductCategory } from './rules/retired-catalog';

export { isRetiredProductCategory } from './rules/retired-catalog';

export class ProductInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProductInvariantError';
  }
}

export type ProductSummary = Pick<
  Product,
  | 'id'
  | 'code'
  | 'category'
  | 'categoryNodeId'
  | 'name'
  | 'specification'
  | 'paperType'
  | 'searchPinyin'
  | 'searchPinyinInitials'
  | 'baseUnitPrice'
  | 'minOrderQty'
  | 'isActive'
  | 'createdAt'
  | 'updatedAt'
> & {
  categoryNode: Pick<
    ProductCategoryNode,
    'id' | 'path' | 'name' | 'legacyCategory' | 'isActive'
  >;
};

export type ProductActiveStatusFilter = 'all' | 'active' | 'inactive';

/**
 * 工单、BOM 和自动价共用的报价 SKU 范围。
 *
 * STOCK_FOIL_ADD 是旧的“现货加烫”同义分类，现已归并到通版现货；
 * BYO_MATERIAL 需人工确认纸料，不作为新报价 SKU 创建选项。
 */
export const QUOTE_PRODUCT_CATEGORIES = [
  ProductCategory.BLANK_STOCK,
  ProductCategory.GENERIC_STOCK,
  ProductCategory.CUSTOM_FLAT_FOIL,
  ProductCategory.COLOR_PRINT,
] as const;

export type ProductReferenceImpact = {
  /** Distinct orders, not order-item rows. */
  orderCount: number;
  bomCount: number;
  /** Enabled rules belonging to a currently effective, enabled price book. */
  currentExternalPriceRuleCount: number;
  /** Internal price tiers whose effective interval contains `now`. */
  currentInternalPriceTierCount: number;
};

export type ProductListRow = ProductSummary & {
  referenceImpact: ProductReferenceImpact;
};

export type ProductCategoryOption = Pick<
  ProductCategoryNode,
  'id' | 'path' | 'name' | 'legacyCategory' | 'sortOrder' | 'isActive'
>;

export type ProductOption = Pick<
  Product,
  'id' | 'code' | 'name' | 'isActive'
> & {
  categoryNode: Pick<ProductCategoryNode, 'name'>;
};

export type ProductOrderOption = Pick<
  Product,
  'id' | 'code' | 'name' | 'category' | 'specification' | 'paperType'
>;

/**
 * 外部销售建单的产品配置事实。产品目录与是否存在自动价格规则解耦；
 * 缺价由计费引擎返回 MANUAL_PRICING_REQUIRED，而不是在这里隐藏选项。
 */
export type ExternalCreateOrderProductOption = Pick<
  Product,
  | 'id'
  | 'code'
  | 'name'
  | 'category'
  | 'specification'
  | 'paperType'
  | 'paperMaterialId'
  | 'weight'
>;

export type CreateOrderProductReadClient = Pick<
  Prisma.TransactionClient,
  'product'
>;

export type ProductCategoryNodeSummary = Pick<
  ProductCategoryNode,
  | 'id'
  | 'path'
  | 'name'
  | 'legacyCategory'
  | 'sortOrder'
  | 'isActive'
  | 'createdAt'
  | 'updatedAt'
> & {
  _count: { products: number };
};

const RETIRED_PRODUCT_LEGACY_CATEGORIES: ReadonlySet<ProductCategory> = new Set([
  ProductCategory.GENERIC_STOCK,
  ProductCategory.STOCK_FOIL_ADD,
  ProductCategory.BYO_MATERIAL,
]);

const SUMMARY_SELECT = {
  id: true,
  code: true,
  category: true,
  categoryNodeId: true,
  name: true,
  specification: true,
  paperType: true,
  searchPinyin: true,
  searchPinyinInitials: true,
  baseUnitPrice: true,
  minOrderQty: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  categoryNode: {
    select: {
      id: true,
      path: true,
      name: true,
      legacyCategory: true,
      isActive: true,
    },
  },
} as const;

const CATEGORY_OPTION_SELECT = {
  id: true,
  path: true,
  name: true,
  legacyCategory: true,
  sortOrder: true,
  isActive: true,
} as const;

const CATEGORY_NODE_SUMMARY_SELECT = {
  id: true,
  path: true,
  name: true,
  legacyCategory: true,
  sortOrder: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { products: true } },
} as const;

const PRODUCT_OPTION_SELECT = {
  id: true,
  code: true,
  name: true,
  isActive: true,
  categoryNode: {
    select: {
      name: true,
    },
  },
} as const;

type ProductReferenceImpactRaw = {
  productId: string;
  orderCount: bigint | number;
  bomCount: bigint | number;
  currentExternalPriceRuleCount: bigint | number;
  currentInternalPriceTierCount: bigint | number;
};

type ProductReferenceReadClient = Pick<
  Prisma.TransactionClient,
  '$queryRaw'
>;

function emptyProductReferenceImpact(): ProductReferenceImpact {
  return {
    orderCount: 0,
    bomCount: 0,
    currentExternalPriceRuleCount: 0,
    currentInternalPriceTierCount: 0,
  };
}

function referenceCount(value: bigint | number): number {
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new ProductInvariantError('产品引用数超出可安全展示范围');
  }
  return count;
}

async function readProductReferenceImpacts(
  client: ProductReferenceReadClient,
  productIds: readonly string[],
  now: Date,
): Promise<Map<string, ProductReferenceImpact>> {
  const ids = [...new Set(productIds)].filter(Boolean);
  const impacts = new Map(
    ids.map((id) => [id, emptyProductReferenceImpact()] as const),
  );
  if (ids.length === 0) return impacts;

  // A single indexed aggregate query keeps a 100-row list from turning into
  // hundreds of count calls.  Order references are counted by DISTINCT
  // orderId because one order may contain the same product in several items.
  const rows = await client.$queryRaw<ProductReferenceImpactRaw[]>(Prisma.sql`
    SELECT
      product."id" AS "productId",
      (
        SELECT COUNT(DISTINCT item."orderId")
        FROM "OrderItem" AS item
        WHERE item."productId" = product."id"
      ) AS "orderCount",
      (
        SELECT COUNT(*)
        FROM "BillOfMaterial" AS bom
        WHERE bom."productId" = product."id"
      ) AS "bomCount",
      (
        SELECT COUNT(*)
        FROM "CustomerPriceRule" AS rule
        INNER JOIN "CustomerPriceBook" AS book
          ON book."id" = rule."priceBookId"
        WHERE rule."productId" = product."id"
          AND rule."isActive" = true
          AND book."isActive" = true
          AND book."settlementType" = 'EXTERNAL_SALES'
          AND book."purpose" = 'PROCESSING'
          AND book."effectiveFrom" <= ${now}
          AND (book."effectiveTo" IS NULL OR book."effectiveTo" > ${now})
      ) AS "currentExternalPriceRuleCount",
      (
        SELECT COUNT(*)
        FROM "PriceTier" AS tier
        WHERE tier."productId" = product."id"
          AND tier."effectiveFrom" <= ${now}
          AND (tier."effectiveTo" IS NULL OR tier."effectiveTo" > ${now})
      ) AS "currentInternalPriceTierCount"
    FROM "Product" AS product
    WHERE product."id" IN (${Prisma.join(ids)})
  `);

  for (const row of rows) {
    impacts.set(row.productId, {
      orderCount: referenceCount(row.orderCount),
      bomCount: referenceCount(row.bomCount),
      currentExternalPriceRuleCount: referenceCount(
        row.currentExternalPriceRuleCount,
      ),
      currentInternalPriceTierCount: referenceCount(
        row.currentInternalPriceTierCount,
      ),
    });
  }
  return impacts;
}

export async function getProductReferenceImpacts(
  productIds: readonly string[],
  now: Date = new Date(),
): Promise<Map<string, ProductReferenceImpact>> {
  return readProductReferenceImpacts(db, productIds, now);
}

export async function getProductReferenceImpact(
  productId: string,
  now: Date = new Date(),
): Promise<ProductReferenceImpact> {
  const impacts = await readProductReferenceImpacts(db, [productId], now);
  return impacts.get(productId) ?? emptyProductReferenceImpact();
}

function normalizeSearchQuery(q?: string | null): string | null {
  const trimmed = q?.trim();
  return trimmed ? trimmed.slice(0, 80) : null;
}

function productSearchFilter(
  q?: string | null,
  status: ProductActiveStatusFilter = 'all',
  categories?: readonly ProductCategory[],
): Prisma.ProductWhereInput | undefined {
  const query = normalizeSearchQuery(q);
  const activeFilter =
    status === 'active'
      ? { isActive: true }
      : status === 'inactive'
        ? { isActive: false }
        : {};
  const categoryFilter =
    categories && categories.length > 0
      ? { category: { in: [...categories] } }
      : {};
  const baseFilter = { ...activeFilter, ...categoryFilter };
  if (!query) {
    return Object.keys(baseFilter).length > 0 ? baseFilter : undefined;
  }
  return {
    ...baseFilter,
    OR: [
      { name: { contains: query, mode: 'insensitive' } },
      { code: { contains: query, mode: 'insensitive' } },
      { categoryNode: { is: { name: { contains: query, mode: 'insensitive' } } } },
      { specification: { contains: query, mode: 'insensitive' } },
      { paperType: { contains: query, mode: 'insensitive' } },
      { searchPinyin: { contains: query, mode: 'insensitive' } },
      { searchPinyinInitials: { contains: query, mode: 'insensitive' } },
    ],
  };
}

export async function listProducts(
  opts: {
    q?: string | null;
    status?: ProductActiveStatusFilter;
    categories?: readonly ProductCategory[];
  } = {},
): Promise<ProductSummary[]> {
  const query = normalizeSearchQuery(opts.q);
  const where = productSearchFilter(query, opts.status, opts.categories);
  const rows = await db.product.findMany({
    where,
    select: SUMMARY_SELECT,
    orderBy: [{ isActive: 'desc' }, { category: 'asc' }, { name: 'asc' }],
  });
  return sortBySearchRelevance(rows, query, (row) => ({
    fields: [
      row.code,
      row.name,
      row.categoryNode.name,
      row.specification,
      row.paperType,
    ],
    pinyinFields: [row.searchPinyin, row.searchPinyinInitials],
  }));
}

export async function listProductsPage(opts: {
  q?: string | null;
  status?: ProductActiveStatusFilter;
  categories?: readonly ProductCategory[];
  page: number;
  pageSize: number;
}): Promise<PaginatedResult<ProductListRow>> {
  const where = productSearchFilter(opts.q, opts.status, opts.categories);
  const total = await db.product.count({ where });
  const window = paginationWindow(total, opts.page, opts.pageSize);
  const rows = await db.product.findMany({
    where,
    select: SUMMARY_SELECT,
    orderBy: [
      { isActive: 'desc' },
      { category: 'asc' },
      { name: 'asc' },
      { id: 'asc' },
    ],
    skip: window.skip,
    take: window.take,
  });
  const impacts = await readProductReferenceImpacts(
    db,
    rows.map((row) => row.id),
    new Date(),
  );
  return paginatedResult(
    rows.map((row) => ({
      ...row,
      referenceImpact: impacts.get(row.id) ?? emptyProductReferenceImpact(),
    })),
    total,
    window,
  );
}

export async function listActiveProductOrderOptions(): Promise<
  ProductOrderOption[]
> {
  return db.product.findMany({
    where: { isActive: true },
    select: {
      id: true,
      code: true,
      name: true,
      category: true,
      specification: true,
      paperType: true,
    },
    orderBy: [{ category: 'asc' }, { name: 'asc' }, { id: 'asc' }],
  });
}

const EXTERNAL_CREATE_ORDER_PRODUCT_CATEGORIES = [
  ProductCategory.BLANK_STOCK,
  ProductCategory.CUSTOM_FLAT_FOIL,
  ProductCategory.COLOR_PRINT,
] as const;

/**
 * 返回所有启用、分类有效且属于三条新建单路线的产品配置。
 *
 * 这里刻意不读取 CustomerPriceRule：合法配置即使暂时缺价也必须可以
 * 建单，随后由纯函数引擎明确转人工核价。
 */
export async function listExternalCreateOrderProductOptions(
  client: CreateOrderProductReadClient = db,
): Promise<ExternalCreateOrderProductOption[]> {
  const rows = await client.product.findMany({
    where: {
      isActive: true,
      category: { in: [...EXTERNAL_CREATE_ORDER_PRODUCT_CATEGORIES] },
      categoryNode: { is: { isActive: true } },
    },
    select: {
      id: true,
      code: true,
      name: true,
      category: true,
      specification: true,
      paperType: true,
      paperMaterialId: true,
      weight: true,
      categoryNode: {
        select: {
          path: true,
          legacyCategory: true,
        },
      },
    },
    orderBy: [{ category: 'asc' }, { name: 'asc' }, { id: 'asc' }],
  });

  return rows.flatMap(({ categoryNode, ...product }) =>
    isRetiredProductCategory(categoryNode) ? [] : [product],
  );
}

/**
 * Return only products that can anchor a quote in the unique currently active
 * external-sales processing price book.
 *
 * Product codes are internal identifiers, not catalog membership flags. The
 * published BASE-rule productId is the authoritative binding used by the quote
 * engine, so the new-order catalog must be derived from the same snapshot.
 */
export async function listCurrentExternalSalesProductOrderOptions(
  now: Date = new Date(),
): Promise<ProductOrderOption[]> {
  return db.$transaction(async (tx) => {
    await acquirePriceRuleSnapshotReadLock(tx);
    const books = await tx.customerPriceBook.findMany({
      where: {
        settlementType: OrderSettlementType.EXTERNAL_SALES,
        purpose: CustomerPriceBookPurpose.PROCESSING,
        isActive: true,
        effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
      },
      select: { id: true },
      orderBy: [{ effectiveFrom: 'desc' }, { version: 'desc' }],
      take: 2,
    });
    if (books.length === 0) return [];
    if (books.length > 1) {
      throw new ProductInvariantError(
        '同一结算方向同时存在多个生效加工费价目簿，请管理员修正有效期',
      );
    }

    const rules = await tx.customerPriceRule.findMany({
      where: {
        priceBookId: books[0]!.id,
        kind: CustomerPriceRuleKind.BASE,
        isActive: true,
        category: { isActive: true },
        product: { is: { isActive: true } },
        NOT: {
          triggerCondition: {
            path: ['target'],
            equals: 'PACKAGING_GROUP',
          },
        },
      },
      select: {
        product: {
          select: {
            id: true,
            code: true,
            name: true,
            category: true,
            specification: true,
            paperType: true,
          },
        },
      },
      orderBy: [
        { product: { category: 'asc' } },
        { product: { name: 'asc' } },
        { product: { id: 'asc' } },
        { minQty: 'asc' },
        { id: 'asc' },
      ],
    });

    const products = new Map<string, ProductOrderOption>();
    for (const rule of rules) {
      if (rule.product) products.set(rule.product.id, rule.product);
    }
    return [...products.values()];
  });
}

export async function listProductCategoryOptions(
  opts: { includeInactiveIds?: readonly string[] } = {},
): Promise<ProductCategoryOption[]> {
  const includeInactiveIds = [...new Set(opts.includeInactiveIds ?? [])].filter(
    Boolean,
  );
  const where =
    includeInactiveIds.length > 0
      ? { OR: [{ isActive: true }, { id: { in: includeInactiveIds } }] }
      : { isActive: true };
  const rows = await db.productCategoryNode.findMany({
    where,
    select: CATEGORY_OPTION_SELECT,
    orderBy: [{ sortOrder: 'asc' }, { path: 'asc' }],
  });
  const explicitlyIncludedIds = new Set(includeInactiveIds);
  return rows.filter(
    (node) =>
      explicitlyIncludedIds.has(node.id) ||
      !isRetiredProductCategory(node),
  );
}

export async function listProductOptions(
  opts: { includeInactiveIds?: readonly string[] } = {},
): Promise<ProductOption[]> {
  const includeInactiveIds = [...new Set(opts.includeInactiveIds ?? [])].filter(
    Boolean,
  );
  const where =
    includeInactiveIds.length > 0
      ? { OR: [{ isActive: true }, { id: { in: includeInactiveIds } }] }
      : { isActive: true };
  return db.product.findMany({
    where,
    select: PRODUCT_OPTION_SELECT,
    orderBy: [{ name: 'asc' }, { code: 'asc' }],
  });
}

// 树序（DFS）：父节点在前、子节点紧随其后，兄弟按 sortOrder → 名称。
// 列表/选择器的层级只靠缩进表达（path 不展示），全局按 sortOrder 排
// 会让 sortOrder 小的子节点漂到父节点上面变成"悬空缩进行"。孤儿节点
// （父被删/脏数据）兜底追加到末尾，保证不丢行。
export function orderCategoryNodesAsTree<
  T extends { path: string; sortOrder: number; name: string },
>(nodes: T[]): T[] {
  const byParent = new Map<string, T[]>();
  for (const n of nodes) {
    const idx = n.path.lastIndexOf('.');
    const parent = idx >= 0 ? n.path.slice(0, idx) : '';
    const bucket = byParent.get(parent);
    if (bucket) bucket.push(n);
    else byParent.set(parent, [n]);
  }
  const bySibling = (a: T, b: T) =>
    a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'zh-CN');
  const out: T[] = [];
  const visit = (parentPath: string) => {
    const kids = byParent.get(parentPath);
    if (!kids) return;
    for (const kid of [...kids].sort(bySibling)) {
      out.push(kid);
      visit(kid.path);
    }
  };
  visit('product');
  if (out.length !== nodes.length) {
    const seen = new Set(out);
    for (const n of nodes) if (!seen.has(n)) out.push(n);
  }
  return out;
}

// 分类的用户可读层级标签（如"定制 / 平面烫金"）——分类名允许跨父级
// 重名，非树形展示的场景（BOM 目标标签等）用名称链消歧，取代内部
// ltree 路径。祖先名缺失（脏数据/未加载）时退回自身名。
export function categoryChainLabelMap(
  nodes: ReadonlyArray<{ id: string; path: string; name: string }>,
): Map<string, string> {
  const nameByPath = new Map(nodes.map((n) => [n.path, n.name]));
  const labels = new Map<string, string>();
  for (const n of nodes) {
    const segments = n.path.split('.');
    const names: string[] = [];
    for (let depth = 2; depth <= segments.length; depth++) {
      const ancestorPath = segments.slice(0, depth).join('.');
      const name = nameByPath.get(ancestorPath);
      if (name) names.push(name);
    }
    labels.set(n.id, names.length > 0 ? names.join(' / ') : n.name);
  }
  return labels;
}

export async function listProductCategoryNodes(): Promise<
  ProductCategoryNodeSummary[]
> {
  const rows = await db.productCategoryNode.findMany({
    select: CATEGORY_NODE_SUMMARY_SELECT,
    orderBy: [{ sortOrder: 'asc' }, { path: 'asc' }],
  });
  return orderCategoryNodesAsTree(rows);
}

export async function getProductCategoryNodeSummary(
  id: string,
): Promise<ProductCategoryNodeSummary | null> {
  return db.productCategoryNode.findUnique({
    where: { id },
    select: CATEGORY_NODE_SUMMARY_SELECT,
  });
}

async function requireActiveCategoryNode(
  client: Prisma.TransactionClient,
  categoryNodeId: string,
): Promise<Pick<ProductCategoryNode, 'id' | 'path' | 'legacyCategory'>> {
  const node = await client.productCategoryNode.findUnique({
    where: { id: categoryNodeId },
    select: { id: true, path: true, legacyCategory: true, isActive: true },
  });
  if (!node || !node.isActive) {
    throw new ProductInvariantError('产品分类不存在或已停用');
  }
  if (isRetiredProductCategory(node)) {
    throw new ProductInvariantError('历史产品分类已退役，不能用于新业务');
  }
  return node;
}

export async function getProductSummary(id: string): Promise<ProductSummary | null> {
  return db.product.findUnique({ where: { id }, select: SUMMARY_SELECT });
}

export type CreateProductCategoryNodeData = {
  // null = 顶级分类
  parentId: string | null;
  name: string;
  legacyCategory: ProductCategory;
  sortOrder: number;
};

export type UpdateProductCategoryNodeData = {
  name: string;
  legacyCategory: ProductCategory;
  sortOrder: number;
};

// ltree path 是纯内部实现（树索引 + 唯一性），段名自动生成，UI 不
// 展示也不让用户填。段字符集限 [a-z0-9_]（ltree label 约束）。
function generateCategoryPathSegment(): string {
  return `n${randomUUID().replace(/-/g, '').slice(0, 10)}`;
}

export async function createProductCategoryNode(
  data: CreateProductCategoryNodeData,
): Promise<ProductCategoryNodeSummary> {
  if (RETIRED_PRODUCT_LEGACY_CATEGORIES.has(data.legacyCategory)) {
    throw new ProductInvariantError('历史产品分类已退役，不能新建或重新启用');
  }

  let parentPath = 'product';
  if (data.parentId) {
    const parent = await db.productCategoryNode.findUnique({
      where: { id: data.parentId },
      select: { path: true, legacyCategory: true, isActive: true },
    });
    if (!parent) throw new ProductInvariantError('上级分类不存在');
    if (!parent.isActive) {
      throw new ProductInvariantError('上级分类已停用，不能在其下新建子分类');
    }
    if (isRetiredProductCategory(parent)) {
      throw new ProductInvariantError('历史产品分类已退役，不能在其下新建子分类');
    }
    parentPath = parent.path;
  }

  return db.productCategoryNode.create({
    data: {
      path: `${parentPath}.${generateCategoryPathSegment()}`,
      name: data.name,
      legacyCategory: data.legacyCategory,
      sortOrder: data.sortOrder,
      isActive: true,
    },
    select: CATEGORY_NODE_SUMMARY_SELECT,
  });
}

export async function updateProductCategoryNode(
  id: string,
  data: UpdateProductCategoryNodeData,
): Promise<ProductCategoryNodeSummary> {
  const target = await getProductCategoryNodeSummary(id);
  if (!target) throw new ProductInvariantError('目标产品分类不存在');

  if (
    isRetiredProductCategory(target) &&
    data.legacyCategory !== target.legacyCategory
  ) {
    throw new ProductInvariantError('历史产品分类已退役，不能改变其兼容分类');
  }
  if (
    !isRetiredProductCategory(target) &&
    RETIRED_PRODUCT_LEGACY_CATEGORIES.has(data.legacyCategory)
  ) {
    throw new ProductInvariantError('不能将现行产品分类改为已退役分类');
  }

  // 刻意不允许改 path：移动子树需要级联改所有后代 path + 迁移产品
  // 归属，属独立功能；这里只改展示属性。
  return db.productCategoryNode.update({
    where: { id },
    data: {
      name: data.name,
      legacyCategory: data.legacyCategory,
      sortOrder: data.sortOrder,
    },
    select: CATEGORY_NODE_SUMMARY_SELECT,
  });
}

export async function setProductCategoryNodeActive(
  id: string,
  isActive: boolean,
): Promise<ProductCategoryNodeSummary> {
  const target = await getProductCategoryNodeSummary(id);
  if (!target) throw new ProductInvariantError('目标产品分类不存在');
  if (isActive && isRetiredProductCategory(target)) {
    throw new ProductInvariantError('历史产品分类已退役，不能重新启用');
  }
  if (target.isActive === isActive) return target;

  return db.productCategoryNode.update({
    where: { id },
    data: { isActive },
    select: CATEGORY_NODE_SUMMARY_SELECT,
  });
}

export type CreateProductData = {
  code: string | null;
  categoryNodeId: string;
  name: string;
  specification: string | null;
  paperType: string | null;
  baseUnitPrice: string | null;
  minOrderQty?: number;
};

export async function createProduct(data: CreateProductData): Promise<ProductSummary> {
  // Preserve the invariant/error order before consuming an automatic business
  // code.  The category is checked again under the price snapshot write lock
  // below so a concurrent category change cannot slip into the insert.
  await requireActiveCategoryNode(db, data.categoryNodeId);
  const code = await resolveBusinessCode('PRODUCT', data.code);
  return db.$transaction(async (tx) => {
    await acquirePriceRuleSnapshotWriteLock(tx);
    const categoryNode = await requireActiveCategoryNode(tx, data.categoryNodeId);
    return tx.product.create({
      data: {
        code,
        category: categoryNode.legacyCategory,
        categoryNodeId: categoryNode.id,
        name: data.name,
        specification: data.specification,
        paperType: data.paperType,
        baseUnitPrice: data.baseUnitPrice,
        minOrderQty: data.minOrderQty ?? null,
        isActive: true,
      },
      select: SUMMARY_SELECT,
    });
  });
}

// Activation is owned by setProductActive, not this update path — see
// lib/account.ts for the rationale.
export type UpdateProductData = {
  code: string | null;
  categoryNodeId: string;
  name: string;
  specification: string | null;
  paperType: string | null;
  baseUnitPrice?: string | null;
  minOrderQty?: number;
};

async function countProtectedExternalPriceRules(
  tx: Prisma.TransactionClient,
  productId: string,
  now: Date,
): Promise<number> {
  return tx.customerPriceRule.count({
    where: {
      productId,
      isActive: true,
      priceBook: {
        is: {
          isActive: true,
          settlementType: 'EXTERNAL_SALES',
          purpose: 'PROCESSING',
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
        },
      },
    },
  });
}

function externalPricingFactsChanged(
  target: ProductSummary,
  data: UpdateProductData,
): boolean {
  return (
    target.code !== data.code ||
    target.categoryNodeId !== data.categoryNodeId ||
    target.specification !== data.specification ||
    target.paperType !== data.paperType
  );
}

function protectedExternalPricingFactsMessage(): string {
  return '该报价 SKU 已被当前或计划生效的客户价格版本引用；请新建 SKU 并在新价格版本中配置，不能改写已发布的计价事实';
}

export async function updateProduct(
  id: string,
  data: UpdateProductData,
): Promise<ProductSummary> {
  return db.$transaction(async (tx) => {
    await acquirePriceRuleSnapshotWriteLock(tx);
    const target = await tx.product.findUnique({ where: { id }, select: SUMMARY_SELECT });
    if (!target) throw new ProductInvariantError('目标产品不存在');
    if (
      externalPricingFactsChanged(target, data) &&
      (await countProtectedExternalPriceRules(tx, id, new Date())) > 0
    ) {
      throw new ProductInvariantError(protectedExternalPricingFactsMessage());
    }
    const categoryNode =
      data.categoryNodeId === target.categoryNodeId
        ? { id: target.categoryNodeId, legacyCategory: target.category }
        : await requireActiveCategoryNode(tx, data.categoryNodeId);

    return tx.product.update({
      where: { id },
      data: {
        code: data.code,
        category: categoryNode.legacyCategory,
        categoryNodeId: categoryNode.id,
        name: data.name,
        specification: data.specification,
        paperType: data.paperType,
        ...(data.baseUnitPrice === undefined
          ? {}
          : { baseUnitPrice: data.baseUnitPrice }),
        minOrderQty: data.minOrderQty ?? null,
      },
      select: SUMMARY_SELECT,
    });
  });
}

export type ProductActiveChangeContext = {
  actor: AuditActor;
  /** Required for deactivation; activation may omit a reason. */
  reason: string | null;
};

export async function setProductActive(
  id: string,
  isActive: boolean,
  context: ProductActiveChangeContext,
): Promise<ProductSummary> {
  return db.$transaction(async (tx) => {
    await acquirePriceRuleSnapshotWriteLock(tx);
    const target = await tx.product.findUnique({ where: { id }, select: SUMMARY_SELECT });
    if (!target) throw new ProductInvariantError('目标产品不存在');
    if (isActive && isRetiredProductCategory(target.categoryNode)) {
      throw new ProductInvariantError('该报价 SKU 属于已退役历史分类，不能重新启用');
    }
    if (target.isActive === isActive) return target;

    const reason = context.reason?.trim() || null;
    if (!isActive && !reason) {
      throw new ProductInvariantError('停用产品必须填写业务理由');
    }
    if (reason && reason.length > 500) {
      throw new ProductInvariantError('操作理由不能超过 500 个字符');
    }

    // Re-read the submit-time impact after taking the same exclusive lock used
    // by cooperating price-rule writes and order quote snapshots. BOM writes
    // do not take this lock, so their count is a statement-time snapshot, not
    // a global serializable snapshot. The observed impact, audit record, and
    // status flip still commit atomically in this transaction.
    const impact =
      (
        await readProductReferenceImpacts(tx, [id], new Date())
      ).get(id) ?? emptyProductReferenceImpact();

    if (
      !isActive &&
      (await countProtectedExternalPriceRules(tx, id, new Date())) > 0
    ) {
      throw new ProductInvariantError(protectedExternalPricingFactsMessage());
    }

    const updated = await tx.product.update({
      where: { id },
      data: { isActive },
      select: SUMMARY_SELECT,
    });
    await writeAuditLogInTx(tx, {
      actor: context.actor,
      action: isActive ? 'PRODUCT_ACTIVATE' : 'PRODUCT_DEACTIVATE',
      entityType: 'Product',
      entityId: id,
      before: { isActive: target.isActive },
      after: { isActive: updated.isActive },
      requestMetadata: {
        reason,
        referenceImpact: impact,
      },
    });
    return updated;
  });
}
