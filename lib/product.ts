import { randomUUID } from 'node:crypto';
import {
  Prisma,
  ProductCategory,
  type Product,
  type ProductCategoryNode,
} from '../generated/prisma/client';
import { db } from './db';
import { sortBySearchRelevance } from './search-ranking';

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

function normalizeSearchQuery(q?: string | null): string | null {
  const trimmed = q?.trim();
  return trimmed ? trimmed.slice(0, 80) : null;
}

function productSearchFilter(q?: string | null): Prisma.ProductWhereInput | undefined {
  const query = normalizeSearchQuery(q);
  if (!query) return undefined;
  return {
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
  opts: { q?: string | null } = {},
): Promise<ProductSummary[]> {
  const query = normalizeSearchQuery(opts.q);
  const where = productSearchFilter(query);
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
  categoryNodeId: string,
): Promise<Pick<ProductCategoryNode, 'id' | 'legacyCategory'>> {
  const node = await db.productCategoryNode.findUnique({
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
  const categoryNode = await requireActiveCategoryNode(data.categoryNodeId);
  return db.product.create({
    data: {
      code: data.code,
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
  const target = await getProductSummary(id);
  if (!target) throw new ProductInvariantError('目标产品不存在');
  const categoryNode =
    data.categoryNodeId === target.categoryNodeId
      ? { id: target.categoryNodeId, legacyCategory: target.category }
      : await requireActiveCategoryNode(data.categoryNodeId);

  return db.product.update({
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
}

export async function setProductActive(
  id: string,
  isActive: boolean,
): Promise<ProductSummary> {
  const target = await getProductSummary(id);
  if (!target) throw new ProductInvariantError('目标产品不存在');
  if (target.isActive === isActive) return target;

  return db.product.update({
    where: { id },
    data: { isActive },
    select: SUMMARY_SELECT,
  });
}
