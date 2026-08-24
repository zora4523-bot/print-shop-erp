import { randomUUID } from 'node:crypto';
import {
  Prisma,
  ProductCategory,
  type Product,
  type ProductCategoryNode,
} from '../generated/prisma/client';
import { db } from './db';
import {
  paginatedResult,
  paginationWindow,
  type PaginatedResult,
} from './admin/table';
import { resolveBusinessCode } from './business-code';
import { acquirePriceRuleSnapshotWriteLock } from './price/rule-snapshot-lock';
import { sortBySearchRelevance } from './search-ranking';
import {
  writeAuditLogInTx,
  type AuditActor,
} from './audit-log';

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
  'id' | 'name' | 'category' | 'specification' | 'paperType'
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
): Prisma.ProductWhereInput | undefined {
  const query = normalizeSearchQuery(q);
  const activeFilter =
    status === 'active'
      ? { isActive: true }
      : status === 'inactive'
        ? { isActive: false }
        : {};
  if (!query) return Object.keys(activeFilter).length > 0 ? activeFilter : undefined;
  return {
    ...activeFilter,
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
  opts: { q?: string | null; status?: ProductActiveStatusFilter } = {},
): Promise<ProductSummary[]> {
  const query = normalizeSearchQuery(opts.q);
  const where = productSearchFilter(query, opts.status);
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
  page: number;
  pageSize: number;
}): Promise<PaginatedResult<ProductListRow>> {
  const where = productSearchFilter(opts.q, opts.status);
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
      name: true,
      category: true,
      specification: true,
      paperType: true,
    },
    orderBy: [{ category: 'asc' }, { name: 'asc' }, { id: 'asc' }],
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
  return db.productCategoryNode.findMany({
    where,
    select: CATEGORY_OPTION_SELECT,
    orderBy: [{ sortOrder: 'asc' }, { path: 'asc' }],
  });
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
): Promise<Pick<ProductCategoryNode, 'id' | 'legacyCategory'>> {
  const node = await client.productCategoryNode.findUnique({
    where: { id: categoryNodeId },
    select: { id: true, legacyCategory: true, isActive: true },
  });
  if (!node || !node.isActive) {
    throw new ProductInvariantError('产品分类不存在或已停用');
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
  let parentPath = 'product';
  if (data.parentId) {
    const parent = await db.productCategoryNode.findUnique({
      where: { id: data.parentId },
      select: { path: true, isActive: true },
    });
    if (!parent) throw new ProductInvariantError('上级分类不存在');
    if (!parent.isActive) {
      throw new ProductInvariantError('上级分类已停用，不能在其下新建子分类');
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
  baseUnitPrice: string | null;
  minOrderQty?: number;
};

export async function updateProduct(
  id: string,
  data: UpdateProductData,
): Promise<ProductSummary> {
  return db.$transaction(async (tx) => {
    await acquirePriceRuleSnapshotWriteLock(tx);
    const target = await tx.product.findUnique({ where: { id }, select: SUMMARY_SELECT });
    if (!target) throw new ProductInvariantError('目标产品不存在');
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
        baseUnitPrice: data.baseUnitPrice,
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
