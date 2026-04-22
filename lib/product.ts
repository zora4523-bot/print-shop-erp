import {
  type Product,
  type ProductCategory,
} from '../generated/prisma/client';
import { db } from './db';

export class ProductInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProductInvariantError';
  }
}

export type ProductSummary = Pick<
  Product,
  | 'id'
  | 'category'
  | 'name'
  | 'specification'
  | 'paperType'
  | 'baseUnitPrice'
  | 'minOrderQty'
  | 'isActive'
  | 'createdAt'
  | 'updatedAt'
>;

const SUMMARY_SELECT = {
  id: true,
  category: true,
  name: true,
  specification: true,
  paperType: true,
  baseUnitPrice: true,
  minOrderQty: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;

export async function listProducts(): Promise<ProductSummary[]> {
  return db.product.findMany({
    select: SUMMARY_SELECT,
    orderBy: [{ isActive: 'desc' }, { category: 'asc' }, { name: 'asc' }],
  });
}

export async function getProductSummary(id: string): Promise<ProductSummary | null> {
  return db.product.findUnique({ where: { id }, select: SUMMARY_SELECT });
}

export type CreateProductData = {
  category: ProductCategory;
  name: string;
  specification: string | null;
  paperType: string | null;
  baseUnitPrice: string | null;
  minOrderQty?: number;
};

export async function createProduct(data: CreateProductData): Promise<ProductSummary> {
  return db.product.create({
    data: {
      category: data.category,
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
  category: ProductCategory;
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

  return db.product.update({
    where: { id },
    data: {
      category: data.category,
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
