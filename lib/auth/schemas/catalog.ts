// 工艺字典（SPEC §6.1 / 附录 B）、产品字典与分类树（SPEC §4.1 / 附录 C）
// 由 lib/auth/schemas.ts 按域拆出（2026-09-14）；对外仍通过 lib/auth/schemas.ts 统一导出。
import { z } from 'zod';
import { ProductCategory } from '../../../generated/prisma/enums';
import { formBoolean, productTextFieldOptional } from './shared';

// Code is the stable machine-facing identifier — referenced by production
// tasks, notification templates, future API consumers. Keep it narrow so
// ad-hoc edits don't break existing joins.
const craftCodeField = z
  .string()
  .trim()
  .min(2, '代码至少 2 个字符')
  .max(32, '代码过长（最多 32 个字符）')
  .regex(/^[A-Z][A-Z0-9_]*$/, '代码只能包含大写字母、数字、下划线，且必须以字母开头');

const optionalCraftCodeField = z
  .preprocess(
    (value) => (value === null || value === undefined ? '' : value),
    z.union([z.literal(''), craftCodeField]),
  )
  .transform((value) => (value === '' ? null : value));

const craftNameField = z
  .string()
  .trim()
  .min(1, '请填写工艺名')
  .max(32, '工艺名过长（最多 32 个字符）');

// FormData always hands us strings; accept the string form too and coerce.
// Min is 1 (not 0) so an untouched create form — where the default-empty
// input coerces to 0 — fails validation rather than accidentally sorting
// the new craft ahead of every existing one .
const sortOrderField = z.coerce
  .number({ message: '排序必须是数字' })
  .int('排序必须是整数')
  .min(1, '排序必须 ≥ 1（建议从 10 起，每 10 留一档）')
  .max(9999, '排序过大');

export const createCraftSchema = z.object({
  name: craftNameField,
  code: optionalCraftCodeField,
  isOutsource: formBoolean,
  sortOrder: sortOrderField,
});

export type CreateCraftInput = z.infer<typeof createCraftSchema>;

export const updateCraftSchema = z.object({
  name: craftNameField,
  isOutsource: formBoolean,
  sortOrder: sortOrderField,
});

export type UpdateCraftInput = z.infer<typeof updateCraftSchema>;

const productNameField = z
  .string()
  .trim()
  .min(1, '请填写产品名')
  .max(64, '产品名过长（最多 64 个字符）');

const productCodeField = z
  .string()
  .trim()
  .max(32, '产品编码过长（最多 32 个字符）')
  .refine((v) => v === '' || /^[A-Za-z0-9_-]+$/.test(v), {
    message: '产品编码只能包含英文字母、数字、下划线、短横线',
  })
  .transform((v) => (v === '' ? null : v));

const productCategoryNodeIdField = z
  .string()
  .trim()
  .min(1, '请选择产品分类');

// 上级分类：空串 = 顶级。内部 ltree path 由服务端从上级分类派生 +
// 自动生成段名——面向业主的 UI 不暴露路径细节。
const productCategoryParentField = z
  .string()
  .trim()
  .max(64, '上级分类无效')
  .transform((v) => (v === '' ? null : v));

const productCategoryNameField = z
  .string()
  .trim()
  .min(1, '请填写分类名')
  .max(64, '分类名过长（最多 64 个字符）');

const productCategorySortOrderField = z.coerce
  .number({ message: '排序必须是数字' })
  .int('排序必须是整数')
  .min(1, '排序必须 ≥ 1（建议从 10 起，每 10 留一档）')
  .max(9999, '排序过大');

export const createProductCategoryNodeSchema = z.object({
  parentId: productCategoryParentField,
  name: productCategoryNameField,
  legacyCategory: z.nativeEnum(ProductCategory, {
    error: '请选择有效的产品分类',
  }),
  sortOrder: productCategorySortOrderField,
});

export type CreateProductCategoryNodeInput = z.infer<
  typeof createProductCategoryNodeSchema
>;

// 编辑不允许改层级——移动子树会让子分类/产品挂错位置（现实现不级联
// 子节点 path）；只能改名/旧分类快照/排序。
export const updateProductCategoryNodeSchema = z.object({
  name: productCategoryNameField,
  legacyCategory: z.nativeEnum(ProductCategory, {
    error: '请选择有效的产品分类',
  }),
  sortOrder: productCategorySortOrderField,
});

export type UpdateProductCategoryNodeInput = z.infer<
  typeof updateProductCategoryNodeSchema
>;

export const createProductSchema = z.object({
  code: productCodeField,
  categoryNodeId: productCategoryNodeIdField,
  name: productNameField,
  specification: productTextFieldOptional('规格', 64),
  paperType: productTextFieldOptional('纸张', 32),
});

export type CreateProductInput = z.infer<typeof createProductSchema>;

export const updateProductSchema = z.object({
  code: productCodeField,
  categoryNodeId: productCategoryNodeIdField,
  name: productNameField,
  specification: productTextFieldOptional('规格', 64),
  paperType: productTextFieldOptional('纸张', 32),
});

export type UpdateProductInput = z.infer<typeof updateProductSchema>;
