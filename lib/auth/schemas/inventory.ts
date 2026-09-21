// 物料字典与库存流水（SPEC §5）、仓库 / 库位（A18）、盘点、BOM（A19）、采购与收货（A17）
// 由 lib/auth/schemas.ts 按域拆出（2026-09-14）；对外仍通过 lib/auth/schemas.ts 统一导出。
import { z } from 'zod';
import { BLANK_SPECIFICATIONS } from '@/lib/price/blank-paper';
import { MaterialCategory } from '../../../generated/prisma/enums';
import { productTextFieldOptional } from './shared';

const materialCodeField = z
  .string()
  .trim()
  .min(1, '请填写物料编码')
  .max(32, '物料编码过长（最多 32 个字符）')
  .regex(/^[A-Za-z0-9_-]+$/, '物料编码只能包含英文字母、数字、下划线、短横线');

const optionalMaterialCodeField = z
  .preprocess(
    (value) => (value === null || value === undefined ? '' : value),
    z.union([z.literal(''), materialCodeField]),
  )
  .transform((value) => (value === '' ? null : value));

const materialNameField = z
  .string()
  .trim()
  .min(1, '请填写物料名称')
  .max(64, '物料名称过长（最多 64 个字符）');

const materialUnitField = z
  .string()
  .trim()
  .min(1, '请填写单位')
  .max(16, '单位过长（最多 16 个字符）');

const decimalOptionalField = ({
  label,
  integerDigits,
  fractionDigits,
}: {
  label: string;
  integerDigits: number;
  fractionDigits: number;
}) =>
  z.preprocess(
    (v) => (v === null || v === undefined ? '' : v),
    z
      .string()
      .trim()
      .refine(
        (v) =>
          v === '' ||
          new RegExp(`^\\d{1,${integerDigits}}(\\.\\d{1,${fractionDigits}})?$`).test(v),
        {
          message: `${label}格式错误（整数部分最多 ${integerDigits} 位、小数最多 ${fractionDigits} 位、非负数）`,
        },
      )
      .transform((v) => (v === '' ? null : v)),
  );

const decimalRequiredField = ({
  label,
  integerDigits,
  fractionDigits,
}: {
  label: string;
  integerDigits: number;
  fractionDigits: number;
}) =>
  z.preprocess(
    (v) => (v === null || v === undefined ? '' : v),
    z
      .string()
      .trim()
      .regex(
        new RegExp(`^\\d{1,${integerDigits}}(\\.\\d{1,${fractionDigits}})?$`),
        `${label}格式错误（整数部分最多 ${integerDigits} 位、小数最多 ${fractionDigits} 位、非负数）`,
      )
      .refine((v) => Number(v) > 0, `${label}必须大于 0`),
  );

const materialDecimal12Optional = decimalOptionalField({
  label: '数量',
  integerDigits: 10,
  fractionDigits: 2,
});
const materialDecimal12Required = decimalRequiredField({
  label: '数量',
  integerDigits: 10,
  fractionDigits: 2,
});
const materialDecimal10Optional = decimalOptionalField({
  label: '金额',
  integerDigits: 6,
  fractionDigits: 4,
});

const materialSchemaFields = {
  name: materialNameField,
  category: z.nativeEnum(MaterialCategory, {
    error: '请选择有效的物料分类',
  }),
  specification: productTextFieldOptional('规格', 64),
  unit: materialUnitField,
  safetyStock: materialDecimal12Optional,
  averageCost: materialDecimal10Optional,
} as const;

export const createMaterialSchema = z.object({
  ...materialSchemaFields,
  code: optionalMaterialCodeField,
});

export type CreateMaterialInput = z.infer<typeof createMaterialSchema>;

export const updateMaterialSchema = z.object({
  ...materialSchemaFields,
  code: materialCodeField,
});

export type UpdateMaterialInput = z.infer<typeof updateMaterialSchema>;

export const materialStockTransactionSchema = z
  .object({
    idempotencyKey: z.string().trim().uuid('出入库请求无效，请刷新页面后重试'),
    materialId: z.string().trim().min(1, '物料 id 不能为空'),
    locationId: z
      .string()
      .trim()
      .max(64, '库位格式非法')
      .transform((v) => (v === '' ? null : v))
      .nullable(),
    direction: z.enum(['IN', 'OUT']),
    quantity: materialDecimal12Required,
    // 采购收货、盘点和调拨都有专用单据，禁止从手工入口伪造这些原因。
    reasonType: z.enum(['PRODUCTION_USE', 'RETURN', 'OTHER'], {
      message: '请选择允许的手工出入库原因',
    }),
    unitCost: materialDecimal10Optional,
    remark: productTextFieldOptional('备注', 500),
  })
  .superRefine((value, context) => {
    if (value.direction === 'IN' && value.reasonType === 'PRODUCTION_USE') {
      context.addIssue({
        code: 'custom',
        path: ['reasonType'],
        message: '生产领用只能出库',
      });
    }
    if (value.direction === 'OUT' && value.reasonType === 'RETURN') {
      context.addIssue({
        code: 'custom',
        path: ['reasonType'],
        message: '退回入库只能入库',
      });
    }
  });

export type MaterialStockTransactionInput = z.infer<
  typeof materialStockTransactionSchema
>;

const warehouseCodeField = z
  .string()
  .trim()
  .min(1, '请填写仓库编码')
  .max(32, '仓库编码过长（最多 32 个字符）')
  .regex(/^[A-Za-z0-9_-]+$/, '仓库编码只能包含英文字母、数字、下划线、短横线');

const optionalWarehouseCodeField = z
  .preprocess(
    (value) => (value === null || value === undefined ? '' : value),
    z.union([z.literal(''), warehouseCodeField]),
  )
  .transform((value) => (value === '' ? null : value));

const warehouseLocationCodeField = z
  .string()
  .trim()
  .min(1, '请填写库位编码')
  .max(32, '库位编码过长（最多 32 个字符）')
  .regex(/^[A-Za-z0-9_-]+$/, '库位编码只能包含英文字母、数字、下划线、短横线');

const optionalWarehouseLocationCodeField = z
  .preprocess(
    (value) => (value === null || value === undefined ? '' : value),
    z.union([z.literal(''), warehouseLocationCodeField]),
  )
  .transform((value) => (value === '' ? null : value));

const warehouseNameField = z
  .string()
  .trim()
  .min(1, '请填写名称')
  .max(64, '名称过长（最多 64 个字符）');

export const createWarehouseSchema = z.object({
  code: optionalWarehouseCodeField,
  name: warehouseNameField,
});

export type CreateWarehouseInput = z.infer<typeof createWarehouseSchema>;

export const createWarehouseLocationSchema = z.object({
  warehouseId: z
    .string()
    .trim()
    .min(1, '请选择仓库')
    .max(64, '仓库格式非法')
    .regex(/^[A-Za-z0-9_-]+$/, '仓库格式非法'),
  code: optionalWarehouseLocationCodeField,
  name: warehouseNameField,
});

export type CreateWarehouseLocationInput = z.infer<
  typeof createWarehouseLocationSchema
>;

const warehouseQuantityField = z
  .string()
  .trim()
  .regex(/^\d{1,10}(\.\d{1,2})?$/, '数量格式错误（非负数，最多 2 位小数）');

const warehouseEntityIdField = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `请选择${label}`)
    .max(64, `${label}格式非法`)
    .regex(/^[A-Za-z0-9_-]+$/, `${label}格式非法`);

export const createStockTransferSchema = z.object({
  idempotencyKey: z.string().uuid('调拨请求标识格式非法'),
  materialId: warehouseEntityIdField('物料'),
  sourceLocationId: warehouseEntityIdField('来源库位'),
  destinationLocationId: warehouseEntityIdField('目标库位'),
  quantity: warehouseQuantityField.refine((value) => Number(value) > 0, {
    message: '调拨数量必须大于 0',
  }),
  remark: productTextFieldOptional('备注', 500),
});

export type CreateStockTransferInput = z.infer<
  typeof createStockTransferSchema
>;

// 盘点回传的「账面回声」：录入这一格时页面上显示的账面数。
// 单独定义而不是复用 warehouseQuantityField，是为了给**缺字段**一条中文消息——
// getFormString 缺键返回 undefined、JSON 里少这个键也是 undefined，zod v4 会走
// invalid_type 分支，.regex() 的自定义消息根本不触发，默认文案是英文的
// "Invalid input: expected string, received undefined"。
// 库位余额恒非负（写入口有 lt(0) 兜底），所以正则和 warehouseQuantityField 同款。
const inventoryBookQuantityField = z
  .string({ error: '缺少账面数快照，请刷新页面后重新盘点' })
  .trim()
  .regex(/^\d{1,10}(\.\d{1,2})?$/, '账面数快照格式非法，请刷新页面后重新盘点');

const inventoryCountReasonField = z
  .string({ error: '请填写盘点过账原因' })
  .trim()
  .min(1, '请填写盘点过账原因')
  .max(500, '盘点过账原因过长（最多 500 个字符）');

export const postInventoryCountSchema = z.object({
  idempotencyKey: z.string().uuid('盘点请求标识格式非法'),
  // 盘点会直接改写库存余额；原因随盘点单持久化，作为 L3 操作审计说明。
  remark: inventoryCountReasonField,
  items: z
    .array(
      z.object({
        materialId: warehouseEntityIdField('物料'),
        locationId: warehouseEntityIdField('库位'),
        // 必填而不是可选：漏传必须当场失败，让操作员刷新页面重新盘点，而不是
        // 静默退回「提交那一刻才读账面数」的旧行为。部署窗口里还开着旧页面的
        // 浏览器会命中这一条——这是刻意的 fail closed。
        bookQuantity: inventoryBookQuantityField,
        countedQuantity: warehouseQuantityField,
      }),
    )
    .min(1, '请至少录入一个实盘数')
    .max(100, '单次盘点最多提交 100 个库位物料'),
});

export type PostInventoryCountInput = z.infer<
  typeof postInventoryCountSchema
>;

const bomIdField = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `请选择${label}`)
    .max(64, `${label}格式非法`)
    .regex(/^[A-Za-z0-9_-]+$/, `${label}格式非法`);

const optionalBomIdField = (label: string) =>
  z.preprocess(
    (v) => (v === null || v === undefined ? '' : v),
    z
      .string()
      .trim()
      .max(64, `${label}格式非法`)
      .refine((v) => v === '' || /^[A-Za-z0-9_-]+$/.test(v), {
        message: `${label}格式非法`,
      })
      .transform((v) => (v === '' ? null : v)),
  );

const bomPositiveIntField = (label: string) =>
  z.preprocess(
    (v) => {
      if (typeof v === 'number') return v;
      if (typeof v !== 'string') return v;
      const trimmed = v.trim();
      if (trimmed === '') return undefined;
      if (!/^\d+$/.test(trimmed)) return null;
      return Number.parseInt(trimmed, 10);
    },
    z
      .number({ message: `${label}必须是正整数` })
      .finite(`${label}必须是有限数`)
      .int(`${label}必须是整数`)
      .min(1, `${label}必须 ≥ 1`)
      .max(999_999, `${label}过大`),
  );

const bomMaterialQuantityField = decimalRequiredField({
  label: 'BOM 用量',
  integerDigits: 8,
  fractionDigits: 4,
});

export const createBomSchema = z
  .object({
    targetType: z.enum(['PRODUCT', 'CATEGORY', 'BLANK']),
    blankPaperMaterialId: optionalBomIdField('纸张').optional(),
    blankSpecificationKey: z.union([z.literal(''), z.enum(BLANK_SPECIFICATIONS.map((spec) => spec.key))]).nullish(),
    productId: optionalBomIdField('产品'),
    categoryNodeId: optionalBomIdField('产品分类'),
    name: z
      .string()
      .trim()
      .min(1, '请填写 BOM 名称')
      .max(64, 'BOM 名称过长（最多 64 个字符）'),
    version: bomPositiveIntField('版本号'),
    baseQuantity: bomPositiveIntField('基准产量'),
    items: z
      .array(
        z.object({
          materialId: bomIdField('物料'),
          quantity: bomMaterialQuantityField,
          remark: productTextFieldOptional('备注', 200),
        }),
      )
      .min(1, '至少添加 1 行物料')
      .max(20, 'BOM 物料行最多 20 行'),
  })
  .superRefine((data, ctx) => {
    if (data.targetType === 'PRODUCT' && !data.productId) {
      ctx.addIssue({
        code: 'custom',
        path: ['productId'],
        message: '请选择产品',
      });
    }
    if (data.targetType === 'CATEGORY' && !data.categoryNodeId) {
      ctx.addIssue({
        code: 'custom',
        path: ['categoryNodeId'],
        message: '请选择产品分类',
      });
    }
    if (data.targetType === 'BLANK') {
      if (!data.blankPaperMaterialId) ctx.addIssue({ code: 'custom', path: ['blankPaperMaterialId'], message: '请选择纸张' });
      if (!data.blankSpecificationKey) ctx.addIssue({ code: 'custom', path: ['blankSpecificationKey'], message: '请选择标准规格' });
    }
    const seen = new Set<string>();
    data.items.forEach((item, index) => {
      if (seen.has(item.materialId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['items', index, 'materialId'],
          message: '同一个 BOM 中物料不能重复',
        });
      }
      seen.add(item.materialId);
    });
  });

export type CreateBomInput = z.infer<typeof createBomSchema>;

const purchaseIdField = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `请选择${label}`)
    .max(64, `${label}格式非法`)
    .regex(/^[A-Za-z0-9_-]+$/, `${label}格式非法`);

const optionalPurchaseIdField = (label: string) =>
  z.preprocess(
    (v) => (v === null || v === undefined ? '' : v),
    z
      .string()
      .trim()
      .max(64, `${label}格式非法`)
      .refine((v) => v === '' || /^[A-Za-z0-9_-]+$/.test(v), {
        message: `${label}格式非法`,
      })
      .transform((v) => (v === '' ? null : v)),
  );

const purchaseDateField = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式必须是 YYYY-MM-DD')
  .transform((value) => (value === '' ? null : value))
  .nullable()
  .or(z.literal('').transform(() => null));

export const createPurchaseOrderSchema = z.object({
  supplierPartyId: purchaseIdField('供应商'),
  materialId: purchaseIdField('物料'),
  quantity: materialDecimal12Required,
  unitCost: materialDecimal10Optional,
  expectedDate: purchaseDateField,
  remark: productTextFieldOptional('备注', 500),
});

export type CreatePurchaseOrderInput = z.infer<
  typeof createPurchaseOrderSchema
>;

export const createPurchaseReceiptSchema = z.object({
  idempotencyKey: z.string().uuid('入库请求标识格式非法'),
  purchaseOrderItemId: purchaseIdField('采购明细'),
  locationId: optionalPurchaseIdField('库位'),
  quantity: materialDecimal12Required,
  unitCost: materialDecimal10Optional,
  remark: productTextFieldOptional('备注', 500),
});

export type CreatePurchaseReceiptInput = z.infer<
  typeof createPurchaseReceiptSchema
>;

export const cancelPurchaseReceiptSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(1, '请填写取消原因')
    .max(500, '取消原因过长（最多 500 个字符）'),
});

export type CancelPurchaseReceiptInput = z.infer<
  typeof cancelPurchaseReceiptSchema
>;
