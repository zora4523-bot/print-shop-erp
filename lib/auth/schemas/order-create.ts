// 建单：款式事实、报价输入、物流 / 包装预报价与 createOrderSchema（SPEC §3.1 / §4.1）
// 由 lib/auth/schemas.ts 按域拆出（2026-09-14）；对外仍通过 lib/auth/schemas.ts 统一导出。
import { z } from 'zod';
import { ORDER_PURPOSES } from '../../order/purpose';
import { OrderFoilTechnique, OrderItemPricingRoute, OrderLamination, OrderPackagingMode, OrderProductStructure } from '../../../generated/prisma/enums';
import { MAX_ORDER_ITEM_FOIL_COLORS } from '../../order/foil-colors';
import { MAX_ORDER_ITEMS_PER_ORDER } from '../../order/limits';
import { MAX_ORDER_ITEM_PRINT_COLORS } from '../../order/print-colors';
import { MAX_ORDER_ITEM_FOIL_COLORS_PER_SIDE, isNewOrderPricingRoute, resolveOrderItemFoilSides } from '../../order/pricing-route';
import { calculateCreateOrderBagCount, MAX_CREATE_ORDER_UNITS_PER_BAG, CREATE_ORDER_PACKAGING_LIMIT_MESSAGE } from '../../order/create-order-packaging';
import { isMixedPackaging, packagingCapacity, packagingCapacityError } from '../../order/packaging-mode';
import { craftIdSchema, decimalStringToScaledInteger, formBoolean, moneyOptionalField, nullableFormBoolean, optionalDateField, optionalShipmentText, optionalTrimmedText, orderItemFoilColorsArray, orderItemFoilSideColorsField, orderItemMoneyOptionalField, orderItemQuantityField, requiredTrimmedText, shipmentBillableWeightField, shipmentChargeMoneyField } from './shared';

// A new command can carry three explicit colors per side. The retired
// aggregate may therefore contain six distinct colors, but only when the side
// arrays prove that split; validateOrderItemPricingFacts keeps a legacy
// aggregate without side evidence at the historical five-color ceiling.
const orderItemFoilColorsWithExplicitSidesField = orderItemFoilColorsArray(
  MAX_ORDER_ITEM_FOIL_COLORS_PER_SIDE * 2,
  `正反面烫金颜色合计不超过 ${MAX_ORDER_ITEM_FOIL_COLORS_PER_SIDE * 2} 种`,
);

export const adminCreatePriceSchema = z.object({
  factsKey: z.string().max(10000),
  amount: z.string().trim().regex(/^\d{1,10}(\.\d{1,2})?$/, '请填写有效价格（最多两位小数）'),
  reason: z.string().trim().min(2, '请填写定价原因').max(200, '定价原因最多 200 字'),
});

const orderItemBaseSchema = z.object({
  adminPrice: adminCreatePriceSchema.optional(),
  fig: z
    .number({ message: '款式编号必须是正整数' })
    .int('款式编号必须是整数')
    .min(1, '款式编号必须大于 0')
    .max(999_999, '款式编号过大')
    .optional(),
  name: z.string().trim().min(1, '请填写款式名').max(64, '款式名过长（最多 64 个字符）'),
  productId: optionalTrimmedText('产品 id', 32),
  pricingRoute: z.enum(OrderItemPricingRoute),
  productStructure: z
    .enum(OrderProductStructure)
    .default(OrderProductStructure.UNSPECIFIED),
  artworkVersion: optionalTrimmedText('稿件版本', 64).default(null),
  plateGroupId: optionalTrimmedText('版组/模具组', 64).default(null),
  pricingGroup: optionalTrimmedText('专版计价组', 64).default(null),
  manualQuoteReason: optionalTrimmedText('人工报价原因', 500).default(null),
  specification: optionalTrimmedText('规格', 64),
  actualWidthMm: z.preprocess(
    (value) => (value === '' || value === undefined ? null : value),
    z
      .number({ message: '实际宽度必须是数字' })
      .finite('实际宽度必须是有限数')
      .positive('实际宽度必须大于 0')
      .max(999_999.99, '实际宽度过大')
      .nullable(),
  ),
  actualHeightMm: z.preprocess(
    (value) => (value === '' || value === undefined ? null : value),
    z
      .number({ message: '实际高度必须是数字' })
      .finite('实际高度必须是有限数')
      .positive('实际高度必须大于 0')
      .max(999_999.99, '实际高度过大')
      .nullable(),
  ),
  paperType: optionalTrimmedText('纸张', 32),
  paperWeightGsm: z.preprocess(
    (value) => (value === '' || value === undefined ? null : value),
    z
      .number({ message: '纸张克重必须是数字' })
      .int('纸张克重必须是整数')
      .min(1, '纸张克重必须大于 0')
      .max(2_000, '纸张克重不能超过 2000g')
      .nullable(),
  ),
  quantity: orderItemQuantityField,
  pack: z.preprocess(
    (value) => (value === '' || value === undefined ? null : value),
    z
      .number({ message: '每包数量必须是数字' })
      .int('每包数量必须是整数')
      .min(1, '每包数量必须大于 0')
      .max(9_999_999, '每包数量过大')
      .nullable(),
  ).optional(),
  crafts: z
    .array(craftIdSchema)
    .max(10, '单款式工艺不超过 10 项'),
  frontFoilColors: orderItemFoilSideColorsField.default([]),
  backFoilColors: orderItemFoilSideColorsField.default([]),
  // Retired aggregate facts remain accepted for old clients. The domain
  // write path always derives them from the two side arrays for new rows.
  foilColors: orderItemFoilColorsWithExplicitSidesField.default([]),
  foilTechnique: z
    .enum(OrderFoilTechnique)
    .default(OrderFoilTechnique.UNSPECIFIED),
  hasLocalFoil: nullableFormBoolean,
  lamination: z.enum(OrderLamination).default(OrderLamination.NONE),
  printColors: z
    .array(
      z
        .string()
        .trim()
        .min(1, '彩印颜色不能为空')
        .max(32, '彩印颜色过长（最多 32 个字符）'),
    )
    .max(
      MAX_ORDER_ITEM_PRINT_COLORS,
      `单款式彩印颜色不超过 ${MAX_ORDER_ITEM_PRINT_COLORS} 种`,
    )
    .default([])
    .superRefine((colors, ctx) => {
      if (new Set(colors).size !== colors.length) {
        ctx.addIssue({ code: 'custom', message: '彩印颜色不能重复' });
      }
    }),
  isDoubleSided: formBoolean,
  isDoubleColor: formBoolean,
  unitPrice: moneyOptionalField,
  fixedFee: orderItemMoneyOptionalField.optional(),
  suggestedSubtotal: orderItemMoneyOptionalField,
  priceOverrideReason: optionalTrimmedText('人工改价说明', 200).optional(),
  remark: optionalTrimmedText('款式备注', 1000),
});

type OrderItemPricingFactsForValidation = Pick<
  z.infer<typeof orderItemBaseSchema>,
  | 'productId'
  | 'pricingRoute'
  | 'paperType'
  | 'crafts'
  | 'actualWidthMm'
  | 'actualHeightMm'
  | 'frontFoilColors'
  | 'backFoilColors'
  | 'foilColors'
  | 'foilTechnique'
  | 'hasLocalFoil'
  | 'lamination'
  | 'printColors'
  | 'isDoubleSided'
> & {
  manualQuoteReason?: string | null;
};

function validateOrderItemPricingFacts(
  item: OrderItemPricingFactsForValidation,
  ctx: z.RefinementCtx,
): void {
  if (!isNewOrderPricingRoute(item.pricingRoute)) {
    ctx.addIssue({
      code: 'custom',
      path: ['pricingRoute'],
      message: '新建工单必须从三条计价路线中选择一条',
    });
    return;
  }

  if ((item.actualWidthMm === null) !== (item.actualHeightMm === null)) {
    ctx.addIssue({
      code: 'custom',
      path: item.actualWidthMm === null ? ['actualWidthMm'] : ['actualHeightMm'],
      message: '实际宽度和高度必须同时填写',
    });
  }

  const manualPricingRequested = Boolean(item.manualQuoteReason?.trim());
  if (!item.productId && !manualPricingRequested) {
    ctx.addIssue({
      code: 'custom',
      path: ['productId'],
      message: '自动计价路线必须选择精确的建单产品',
    });
  }
  if (!item.paperType && !manualPricingRequested) {
    ctx.addIssue({
      code: 'custom',
      path: ['paperType'],
      message: '请选择标准纸张或填写自定义纸张',
    });
  }
  if (item.crafts.length === 0 && !manualPricingRequested) {
    ctx.addIssue({
      code: 'custom',
      path: ['crafts'],
      message: '至少选择一项工艺',
    });
  }

  if (
    item.foilColors.length > MAX_ORDER_ITEM_FOIL_COLORS &&
    item.frontFoilColors.length === 0 &&
    item.backFoilColors.length === 0
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['foilColors'],
      message: `未按正反面填写时，烫金颜色不超过 ${MAX_ORDER_ITEM_FOIL_COLORS} 种`,
    });
  }

  const { frontFoilColors, backFoilColors } = resolveOrderItemFoilSides(item);
  const actualFoilColors = [...frontFoilColors, ...backFoilColors];
  if (
    item.pricingRoute !== OrderItemPricingRoute.COLOR_PRINT &&
    item.lamination !== OrderLamination.NONE
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['lamination'],
      message: '非彩印款式的覆膜方式必须为“无覆膜”',
    });
  }
  if (
    frontFoilColors.length > MAX_ORDER_ITEM_FOIL_COLORS_PER_SIDE ||
    backFoilColors.length > MAX_ORDER_ITEM_FOIL_COLORS_PER_SIDE
  ) {
    ctx.addIssue({
      code: 'custom',
      path:
        frontFoilColors.length > MAX_ORDER_ITEM_FOIL_COLORS_PER_SIDE
          ? ['frontFoilColors']
          : ['backFoilColors'],
      message: `正反面各最多 ${MAX_ORDER_ITEM_FOIL_COLORS_PER_SIDE} 种烫金颜色`,
    });
  }

  if (item.pricingRoute === OrderItemPricingRoute.CUSTOM_SINGLE_FLAT_FOIL) {
    if (
      item.foilTechnique === OrderFoilTechnique.NONE ||
      item.foilTechnique === OrderFoilTechnique.UNSPECIFIED
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['foilTechnique'],
        message: '专版烫金必须选择烫金方式',
      });
    }
    if (actualFoilColors.length < 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['foilColors'],
        message: '专版烫金必须选择至少 1 种烫金颜色',
      });
    }
  }

  if (item.pricingRoute === OrderItemPricingRoute.STOCK_BLANK) {
    if (item.hasLocalFoil !== true) {
      ctx.addIssue({
        code: 'custom',
        path: ['hasLocalFoil'],
        message: '通版现货路线必须使用局部烫金',
      });
    }
    if (
      item.foilTechnique === OrderFoilTechnique.NONE ||
      item.foilTechnique === OrderFoilTechnique.UNSPECIFIED
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['foilTechnique'],
        message: '局部烫金必须选择烫金方式',
      });
    }
    if (actualFoilColors.length < 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['foilColors'],
        message: '局部烫金必须选择至少 1 种烫金颜色',
      });
    }
  }

  if (item.pricingRoute === OrderItemPricingRoute.COLOR_PRINT) {
    if (item.printColors.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['printColors'],
        message: '彩印自动计价必须填写彩印颜色',
      });
    }
    if (actualFoilColors.length === 0) {
      if (item.foilTechnique !== OrderFoilTechnique.NONE) {
        ctx.addIssue({
          code: 'custom',
          path: ['foilTechnique'],
          message: '纯彩印未选烫金颜色时，烫金方式必须为“无烫金”',
        });
      }
      if (item.hasLocalFoil !== false) {
        ctx.addIssue({
          code: 'custom',
          path: ['hasLocalFoil'],
          message: '纯彩印未选烫金颜色时，不能标记局部烫金',
        });
      }
    } else {
      if (
        item.foilTechnique === OrderFoilTechnique.NONE ||
        item.foilTechnique === OrderFoilTechnique.UNSPECIFIED
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['foilTechnique'],
          message: '彩印加烫金时必须选择烫金方式',
        });
      }
      if (item.hasLocalFoil === null) {
        ctx.addIssue({
          code: 'custom',
          path: ['hasLocalFoil'],
          message: '彩印加烫金时必须明确是否局部烫金',
        });
      }
    }
  }
}

/**
 * Shared command-boundary validation for a fully merged set of pricing
 * facts. Change requests use this schema after combining a proposal with the
 * persisted item, so they cannot bypass the same route invariants enforced
 * when an order is first created.
 */
export const orderItemPricingFactsSchema = orderItemBaseSchema
  .pick({
    productId: true,
    pricingRoute: true,
    paperType: true,
    crafts: true,
    actualWidthMm: true,
    actualHeightMm: true,
    frontFoilColors: true,
    backFoilColors: true,
    foilColors: true,
    foilTechnique: true,
    hasLocalFoil: true,
    lamination: true,
    printColors: true,
    isDoubleSided: true,
  })
  .superRefine(validateOrderItemPricingFacts);

const orderItemSchema = orderItemBaseSchema.superRefine((item, ctx) => {
  // The parent command accepts the legacy unclassified route only for a
  // non-production sample shipment; it never authorizes a manual price.
  if (item.pricingRoute !== 'MANUAL_QUOTE') validateOrderItemPricingFacts(item, ctx);
});

export type OrderItemInput = z.infer<typeof orderItemSchema>;

// 建议价由服务端根据当前生效规则计算。客户端只传业务事实，
// 不传价格或规则快照，避免直接 POST 伪造报价结果。
export const createOrderQuoteItemsSchema = z.object({
  items: z
    .array(
      orderItemBaseSchema
        .pick({
          productId: true,
          specification: true,
          paperType: true,
          pricingRoute: true,
          manualQuoteReason: true,
          productStructure: true,
          artworkVersion: true,
          plateGroupId: true,
          pricingGroup: true,
          actualWidthMm: true,
          actualHeightMm: true,
          paperWeightGsm: true,
          quantity: true,
          crafts: true,
          frontFoilColors: true,
          backFoilColors: true,
          foilColors: true,
          foilTechnique: true,
          hasLocalFoil: true,
          lamination: true,
          printColors: true,
          isDoubleSided: true,
          isDoubleColor: true,
        })
        .superRefine(validateOrderItemPricingFacts),
    )
    .min(1, '至少需要一个款式')
    .max(20, '单次最多计算 20 个款式'),
  // The form may preview one completed line while other lines are still being
  // edited.  Preserve the real order-level item count for packing/mixed-item
  // rules without asking the quote endpoint to accept invalid placeholder
  // lines.  Order creation always derives this count from persisted inputs.
  orderItemCount: z
    .number()
    .int()
    .min(1)
    .max(MAX_ORDER_ITEMS_PER_ORDER)
    .optional(),
});

export type CreateOrderQuoteItemsInput = z.infer<
  typeof createOrderQuoteItemsSchema
>;

// OrderItem.subtotal and Order.totalAmount are Decimal(12,2): at most
// 9,999,999,999.99 yuan. lib/order.ts persists each line as
// Decimal(quantity * unitPrice).toFixed(2), whose default rounding mode is
// ROUND_HALF_UP. Keep the boundary check exact without passing through an
// IEEE-754 number: unit prices have four decimal places, so converting them
// to ten-thousandths and dividing the product by 100 yields cents.
const DECIMAL_12_2_MAX_CENTS = BigInt('999999999999');
const TEN_THOUSANDTHS_PER_CENT = BigInt(100);

function orderItemSubtotalCents(
  quantity: number,
  unitPrice: string | null,
  fixedFee: string | null | undefined,
): bigint {
  const priceTenThousandths = decimalStringToScaledInteger(
    unitPrice ?? '0',
    4,
  );
  const unrounded = priceTenThousandths * BigInt(quantity);
  const variableCents = (
    unrounded + TEN_THOUSANDTHS_PER_CENT / BigInt(2)
  ) / TEN_THOUSANDTHS_PER_CENT;
  const fixedFeeCents = decimalStringToScaledInteger(
    fixedFee ?? '0',
    2,
  );
  return variableCents + fixedFeeCents;
}

const shipmentSplitQuantityField = z.preprocess(
  (value) => {
    if (typeof value === 'number') return value;
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    if (trimmed === '') return 0;
    if (!/^\d+$/.test(trimmed)) return Number.NaN;
    return Number.parseInt(trimmed, 10);
  },
  z
    .number({ message: '分配数量必须是非负整数' })
    .finite('分配数量必须是有限数')
    .int('分配数量必须是整数')
    .min(0, '分配数量不能小于 0')
    .max(9_999_999, '分配数量过大'),
);

const shipmentChargeFields = {
  destinationProvince: optionalShipmentText('计费省份', 32),
  quotedWeightKg: shipmentBillableWeightField,
  shippingFee: shipmentChargeMoneyField,
  packingMaterialFee: shipmentChargeMoneyField,
  customerChargeOverrideReason: optionalShipmentText('收费调整说明', 500),
} as const;

const externalOrderChargeQuoteShipmentSchema = z.object({
  shipmentKey: z
    .string()
    .trim()
    .min(1, '发货记录标识不能为空')
    .max(32, '发货记录标识过长'),
  province: optionalShipmentText('计费省份', 32),
  billableWeightKg: shipmentBillableWeightField,
  itemQuantity: z
    .number()
    .int('单票分配数量必须是整数')
    .min(1, '单票分配数量必须大于 0')
    .max(
      MAX_ORDER_ITEMS_PER_ORDER * 9_999_999,
      '单票分配数量过大',
    ),
  itemQuantities: z
    .array(
      z
        .number()
        .int('分配数量必须是整数')
        .min(0, '分配数量不能小于 0')
        .max(9_999_999, '分配数量过大'),
    )
    .max(MAX_ORDER_ITEMS_PER_ORDER, '单票分配款式过多')
    .optional(),
});

const externalOrderChargeQuoteItemSchema = z.object({
  itemKey: z.string().trim().min(1).max(64).optional(),
  quantity: z
    .number()
    .int('款式数量必须是整数')
    .min(1, '款式数量必须大于 0')
    .max(9_999_999, '款式数量过大'),
  paperWeightGsm: z
    .number()
    .int('纸张克重必须是整数')
    .min(1)
    .max(2_000)
    .nullable(),
  paperType: optionalTrimmedText('纸张', 64).optional(),
  productStructure: z.enum(OrderProductStructure),
});

// 创建页物流报价只接收业务事实，不接收价格、规则或价目簿编号。
// 服务端每次按当前生效 LOGISTICS 价目簿重新报价。
export const quoteExternalOrderChargesSchema = z
  .object({
    isSfCollect: z.boolean(),
    items: z
      .array(externalOrderChargeQuoteItemSchema)
      .min(1, '至少需要一个款式')
      .max(MAX_ORDER_ITEMS_PER_ORDER, '款式数量过多')
      .optional(),
    shipments: z
      .array(externalOrderChargeQuoteShipmentSchema)
      .min(1, '至少需要一个发货地址')
      .max(10, '单工单发货地址不超过 10 个'),
  })
  .superRefine((input, ctx) => {
    const seen = new Set<string>();
    for (const [index, shipment] of input.shipments.entries()) {
      if (seen.has(shipment.shipmentKey)) {
        ctx.addIssue({
          code: 'custom',
          path: ['shipments', index, 'shipmentKey'],
          message: '发货记录标识不能重复',
        });
      }
      seen.add(shipment.shipmentKey);
    }

    if (!input.items) return;
    const allocatedByItem = input.items.map(() => 0);
    for (const [shipmentIndex, shipment] of input.shipments.entries()) {
      if (!shipment.itemQuantities) {
        ctx.addIssue({
          code: 'custom',
          path: ['shipments', shipmentIndex, 'itemQuantities'],
          message: '自动物流报价必须提供各款分配数量',
        });
        continue;
      }
      if (shipment.itemQuantities.length !== input.items.length) {
        ctx.addIssue({
          code: 'custom',
          path: ['shipments', shipmentIndex, 'itemQuantities'],
          message: '各地址的款式分配必须与工单款式一一对应',
        });
        continue;
      }
      shipment.itemQuantities.forEach((quantity, itemIndex) => {
        allocatedByItem[itemIndex] =
          (allocatedByItem[itemIndex] ?? 0) + quantity;
      });
      if (!shipment.itemQuantities.some((quantity) => quantity > 0)) {
        ctx.addIssue({
          code: 'custom',
          path: ['shipments', shipmentIndex, 'itemQuantities'],
          message: '每个地址至少要分配一个款式',
        });
      }
      const allocatedQuantity = shipment.itemQuantities.reduce(
        (sum, quantity) => sum + quantity,
        0,
      );
      if (shipment.itemQuantity !== allocatedQuantity) {
        ctx.addIssue({
          code: 'custom',
          path: ['shipments', shipmentIndex, 'itemQuantity'],
          message: '地址总数量必须等于各款分配数量之和',
        });
      }
    }
    input.items.forEach((item, itemIndex) => {
      if (allocatedByItem[itemIndex] !== item.quantity) {
        ctx.addIssue({
          code: 'custom',
          path: ['items', itemIndex, 'quantity'],
          message: `款式 #${itemIndex + 1} 的地址分配数量必须等于本款数量`,
        });
      }
    });
  });

export type QuoteExternalOrderChargesInput = z.infer<
  typeof quoteExternalOrderChargesSchema
>;

// 创建页包装组预报价只接收可验证的业务事实。袋数由浏览器根据
// 每袋组成实时计算，服务端仍严格校验类型和范围，并按当前生效价目重算金额。
const quotePackagingUnitsPerBagField = z.preprocess(
  (value) => {
    if (value === '' || value === null || value === undefined) return 0;
    if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
      return Number.parseInt(value.trim(), 10);
    }
    return value;
  },
  z
    .number({ message: '每袋数量必须是非负整数' })
    .int('每袋数量必须是整数')
    .min(0, '每袋数量不能小于 0')
    .max(9_999_999, '每袋数量过大'),
);

const orderPackagingQuoteGroupSchema = z.object({
  groupKey: z
    .string({ error: '包装组标识不能为空' })
    .trim()
    .min(1, '包装组标识不能为空')
    .max(64, '包装组标识过长'),
  mode: z.enum(OrderPackagingMode, { error: '包装方式非法' }),
  actualBagCount: z
    .number({ error: '袋数必须是数字' })
    .finite('袋数必须是有限数')
    .int('袋数必须是整数')
    .min(0, '包装数量不能为负数')
    .max(9_999_999, '袋数过大'),
});

// 统一建单报价还需要每袋的款式组成，用来验证混装与计算袋数。
const createOrderPackagingQuoteGroupSchema =
  orderPackagingQuoteGroupSchema.extend({
    itemUnitsPerBag: z
      .array(quotePackagingUnitsPerBagField, {
        error: '包装组款式组成格式非法',
      })
      .min(1, '包装组至少需要一个款式组成')
      .max(MAX_ORDER_ITEMS_PER_ORDER, '包装组款式组成过多'),
  });

export const quoteCreateOrderPackagingGroupsSchema = z
  .object({
    groups: z
      .array(createOrderPackagingQuoteGroupSchema, {
        error: '包装组数据格式非法',
      })
      .min(1, '至少需要一个包装组')
      .max(20, '单工单包装组不超过 20 组'),
  })
  .superRefine((input, ctx) => {
    const seen = new Set<string>();
    input.groups.forEach((group, index) => {
      if (seen.has(group.groupKey)) {
        ctx.addIssue({
          code: 'custom',
          path: ['groups', index, 'groupKey'],
          message: '包装组标识不能重复',
        });
      }
      seen.add(group.groupKey);
      if (
        group.itemUnitsPerBag.reduce((total, units) => total + units, 0) >
        (packagingCapacity(group.mode) ?? Number.POSITIVE_INFINITY)
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['groups', index, 'itemUnitsPerBag'],
          message: packagingCapacityError(group.mode),
        });
      }
      if (group.actualBagCount === 0 && group.mode !== OrderPackagingMode.UNPACKED) {
        ctx.addIssue({ code: 'custom', path: ['groups', index, 'actualBagCount'], message: '包装数量必须大于 0' });
      }
    });
  });

export type QuoteCreateOrderPackagingGroupsInput = z.infer<
  typeof quoteCreateOrderPackagingGroupsSchema
>;

const additionalShipmentSchema = z.object({
  receiverName: optionalTrimmedText('收货人', 64),
  receiverPhone: optionalTrimmedText('收货电话', 32),
  receiverAddress: requiredTrimmedText('收货地址', 256),
  expressCode: optionalTrimmedText('快递代码', 32),
  ...shipmentChargeFields,
  itemQuantities: z
    .array(shipmentSplitQuantityField)
    .max(50, '单个地址的款式分配不超过 50 项'),
});

const packagingUnitsPerBagField = z.preprocess(
  (value) => {
    if (value === '' || value === null || value === undefined) return 0;
    if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
      return Number.parseInt(value.trim(), 10);
    }
    return value;
  },
  z
    .number({ message: '每袋数量必须是非负整数' })
    .int('每袋数量必须是整数')
    .min(0, '每袋数量不能小于 0')
    .max(9_999_999, '每袋数量过大'),
);

const packagingGroupSchema = z.object({
  adminPrice: adminCreatePriceSchema.extend({
    amount: z.string().trim().regex(/^\d{1,6}(\.\d{1,4})?$/, '包装单价最多四位小数'),
  }).optional(),
  name: optionalTrimmedText('包装组名称', 64),
  mode: z.enum(OrderPackagingMode),
  actualBagCount: z.preprocess(
    (value) => {
      if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
        return Number.parseInt(value.trim(), 10);
      }
      return value;
    },
    z
      .number({ message: '实际袋数必须是数字' })
      .int('实际袋数必须是整数')
      .min(0, '包装数量不能为负数')
      .max(9_999_999, '实际袋数过大'),
  ),
  itemUnitsPerBag: z
    .array(packagingUnitsPerBagField)
    .max(MAX_ORDER_ITEMS_PER_ORDER, '包装组款式组成过多'),
});

export const createOrderSchema = z
  .object({
    purpose: z.enum(ORDER_PURPOSES).optional(),
    samplePackagingRuleCode: z.string().trim().min(1).max(100).nullable().optional(),
    clientSubmissionId: z.string().uuid('提交标识无效').optional(),
    nextItemFig: z
      .number()
      .int('下一款式编号必须是整数')
      .min(1, '下一款式编号必须大于 0')
      .optional(),
    customName: optionalTrimmedText('工单名称', 100).optional(),
    externalSalesUserId: optionalTrimmedText('关联外部销售', 64).optional(),
    customerPartyId: optionalTrimmedText('客户主数据', 64).optional(),
    customerRef: optionalTrimmedText('客户名称/简称', 64),
    receiverName: optionalTrimmedText('收货人', 64),
    receiverPhone: optionalTrimmedText('收货电话', 32),
    receiverAddress: optionalTrimmedText('收货地址', 256)
      .optional()
      .refine((value) => Boolean(value), {
        message: '请填写收货地址',
      })
      .transform((value) => value ?? null),
    expressCode: optionalTrimmedText('快递代码', 32),
    ...shipmentChargeFields,
    packageRequirement: optionalTrimmedText('包装补充说明', 500),
    remark: optionalTrimmedText('工单备注', 1000),
    promisedDate: optionalDateField,
    isUrgent: formBoolean,
    isSfCollect: formBoolean,
    additionalShipments: z
      .array(additionalShipmentSchema)
      .max(9, '额外地址不超过 9 个')
      .default([]),
    packagingGroups: z
      .array(packagingGroupSchema)
      .max(20, '单工单包装组不超过 20 组')
      .default([]),
    items: z
      .array(orderItemSchema)
      .min(1, '至少一个款式')
      .max(
        MAX_ORDER_ITEMS_PER_ORDER,
        `单工单款式不超过 ${MAX_ORDER_ITEMS_PER_ORDER} 项`,
      ),
  })
  .superRefine((input, ctx) => {
    const sample = input.purpose === 'SAMPLE_SHIPMENT';
    if (!sample && input.samplePackagingRuleCode) ctx.addIssue({ code: 'custom', path: ['samplePackagingRuleCode'], message: '只有寄样品工单可以选择寄样包装' });
    input.items.forEach((item, index) => {
      if (!sample && item.pricingRoute === 'MANUAL_QUOTE') ctx.addIssue({ code: 'custom', path: ['items', index, 'pricingRoute'], message: '新建工单必须从三条计价路线中选择一条' });
      if (sample && (item.pricingRoute !== 'MANUAL_QUOTE' || item.crafts.length || item.productId || item.frontFoilColors.length || item.backFoilColors.length || item.foilColors.length || item.paperType || item.manualQuoteReason || item.lamination !== 'NONE' || item.printColors.length || item.paperWeightGsm || item.actualWidthMm || item.actualHeightMm || item.plateGroupId || item.productStructure !== 'UNSPECIFIED' || item.foilTechnique !== 'NONE' || item.hasLocalFoil !== null || item.pack !== null || item.isDoubleSided || item.isDoubleColor)) ctx.addIssue({ code: 'custom', path: ['items', index], message: '寄样品只需填写样品名称和数量' });
      if (input.purpose && input.purpose !== 'STANDARD' && (item.adminPrice || Number(item.unitPrice) || Number(item.fixedFee))) ctx.addIssue({ code: 'custom', path: ['items', index], message: '请在工单核价时填写费用' });
    });
    if (input.purpose && input.purpose !== 'STANDARD' && input.packagingGroups.some((group) => group.adminPrice)) ctx.addIssue({ code: 'custom', path: ['packagingGroups'], message: '样品工单不单独收取包装加工费' });
    if (sample && input.packagingGroups.length) ctx.addIssue({ code: 'custom', path: ['packagingGroups'], message: '寄样品不收取入袋加工费' });
    const seenFigs = new Set<number>();
    let maximumFig = 0;
    input.items.forEach((item, itemIndex) => {
      if (item.pack != null && item.pack > MAX_CREATE_ORDER_UNITS_PER_BAG) {
        ctx.addIssue({
          code: 'custom',
          path: ['items', itemIndex, 'pack'],
          message: CREATE_ORDER_PACKAGING_LIMIT_MESSAGE,
        });
      }
      const fig = item.fig ?? itemIndex + 1;
      maximumFig = Math.max(maximumFig, fig);
      if (seenFigs.has(fig)) {
        ctx.addIssue({
          code: 'custom',
          path: ['items', itemIndex, 'fig'],
          message: `款式编号 ${fig} 重复`,
        });
      }
      seenFigs.add(fig);
    });
    if (
      input.nextItemFig !== undefined &&
      input.nextItemFig <= maximumFig
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['nextItemFig'],
        message: '下一款式编号必须大于已有款式编号',
      });
    }
    let orderTotalCents = BigInt(0);
    for (const [itemIndex, item] of input.items.entries()) {
      const subtotalCents = orderItemSubtotalCents(
        item.quantity,
        item.unitPrice,
        item.fixedFee,
      );
      orderTotalCents += subtotalCents;
      if (subtotalCents > DECIMAL_12_2_MAX_CENTS) {
        ctx.addIssue({
          code: 'custom',
          path: ['items', itemIndex, 'unitPrice'],
          message:
            '款式小计过大（数量 × 单价 + 一次性费用不能超过 9,999,999,999.99 元）',
        });
      }
    }
    if (orderTotalCents > DECIMAL_12_2_MAX_CENTS) {
      ctx.addIssue({
        code: 'custom',
        path: ['items'],
        message: '工单总金额过大（不能超过 9,999,999,999.99 元）',
      });
    }

    const customerChargeValues = [
      input.shippingFee,
      input.packingMaterialFee,
      ...input.additionalShipments.flatMap((shipment) => [
        shipment.shippingFee,
        shipment.packingMaterialFee,
      ]),
    ];
    const customerChargeCents = customerChargeValues.reduce(
      (sum, value) =>
        sum + decimalStringToScaledInteger(value ?? '0', 2),
      BigInt(0),
    );
    if (orderTotalCents + customerChargeCents > DECIMAL_12_2_MAX_CENTS) {
      ctx.addIssue({
        code: 'custom',
        path: ['shippingFee'],
        message: '加工费加快递/耗材费后的工单总额超过系统上限',
      });
    }

    if (input.isSfCollect) {
      const shippingFees = [
        input.shippingFee,
        ...input.additionalShipments.map((shipment) => shipment.shippingFee),
      ];
      for (const [shipmentIndex, fee] of shippingFees.entries()) {
        if (fee !== null && decimalStringToScaledInteger(fee, 2) !== BigInt(0)) {
          ctx.addIssue({
            code: 'custom',
            path:
              shipmentIndex === 0
                ? ['shippingFee']
                : ['additionalShipments', shipmentIndex - 1, 'shippingFee'],
            message: '顺丰到付由客户自行预约，快递费必须为 0',
          });
        }
      }
    }

    for (const [shipmentIndex, shipment] of input.additionalShipments.entries()) {
      if (shipment.itemQuantities.length !== input.items.length) {
        ctx.addIssue({
          code: 'custom',
          path: ['additionalShipments', shipmentIndex, 'itemQuantities'],
          message: '每个额外地址必须为全部款式提供分配数量',
        });
      }
      const quantities = input.items.map(
        (_, itemIndex) => shipment.itemQuantities[itemIndex] ?? 0,
      );
      if (!quantities.some((quantity) => quantity > 0)) {
        ctx.addIssue({
          code: 'custom',
          path: ['additionalShipments', shipmentIndex, 'itemQuantities'],
          message: '额外地址至少要分配一个款式的数量',
        });
      }
    }

    let primaryHasQuantity = false;
    for (const [itemIndex, item] of input.items.entries()) {
      const extraQuantity = input.additionalShipments.reduce(
        (sum, shipment) => sum + (shipment.itemQuantities[itemIndex] ?? 0),
        0,
      );
      if (extraQuantity > item.quantity) {
        ctx.addIssue({
          code: 'custom',
          path: ['items', itemIndex, 'quantity'],
          message: `分配到额外地址的数量 ${extraQuantity} 超过款式总数 ${item.quantity}`,
        });
      }
      if (extraQuantity < item.quantity) primaryHasQuantity = true;
    }
    if (input.additionalShipments.length > 0 && !primaryHasQuantity) {
      ctx.addIssue({
        code: 'custom',
        path: ['additionalShipments'],
        message: '主地址至少要保留一个款式的发货数量',
      });
    }

    const packagingGroupCountByItem = input.items.map(() => 0);
    for (const [groupIndex, group] of input.packagingGroups.entries()) {
      if (group.itemUnitsPerBag.length !== input.items.length) {
        ctx.addIssue({
          code: 'custom',
          path: ['packagingGroups', groupIndex, 'itemUnitsPerBag'],
          message: '每个包装组必须为全部款式表达每袋组成',
        });
        continue;
      }
      const selectedItemCount = group.itemUnitsPerBag.filter(
        (quantity) => quantity > 0,
      ).length;
      if (
        group.mode !== OrderPackagingMode.UNPACKED && !isMixedPackaging(group.mode) &&
        selectedItemCount !== 1
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['packagingGroups', groupIndex, 'itemUnitsPerBag'],
          message: '单款装包装组必须且只能包含 1 个款式',
        });
      }
      if (
        isMixedPackaging(group.mode) &&
        selectedItemCount < 2
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['packagingGroups', groupIndex, 'itemUnitsPerBag'],
          message: '混装包装组至少要包含 2 个款式',
        });
      }
      const derived = calculateCreateOrderBagCount({
        mode: group.mode,
        itemQuantities: input.items.map((item) => item.quantity),
        itemUnitsPerBag: group.itemUnitsPerBag,
        shipmentQuantities: [
          input.items.map((item, index) => item.quantity - input.additionalShipments.reduce((sum, shipment) => sum + (shipment.itemQuantities[index] ?? 0), 0)),
          ...input.additionalShipments.map((shipment) => shipment.itemQuantities),
        ],
      });
      if (!derived.complete) {
        ctx.addIssue({
          code: 'custom',
          path: ['packagingGroups', groupIndex, 'itemUnitsPerBag'],
          message: derived.errors.join('；'),
        });
      }
      group.itemUnitsPerBag.forEach((unitsPerBag, itemIndex) => {
        if (unitsPerBag <= 0) return;
        packagingGroupCountByItem[itemIndex] =
          (packagingGroupCountByItem[itemIndex] ?? 0) + 1;
      });
    }
    packagingGroupCountByItem.forEach((groupCount, itemIndex) => {
      if (groupCount > 1) {
        ctx.addIssue({
          code: 'custom',
          path: ['packagingGroups'],
          message: `款式 #${itemIndex + 1} 只能归入一个包装组`,
        });
      }
    });
  });

export type CreateOrderInput = z.infer<typeof createOrderSchema>;
