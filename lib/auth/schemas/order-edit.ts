// 工单后续操作：取消、发货、返工、改单申请与审核、工厂终价、手工费用、版费、编辑、急单、顺丰到付
// 由 lib/auth/schemas.ts 按域拆出（2026-09-14）；对外仍通过 lib/auth/schemas.ts 统一导出。
import { z } from 'zod';
import { ReworkCause, OrderPackagingMode, OrderCraft } from '../../../generated/prisma/enums';
import { MAX_ORDER_ITEMS_PER_ORDER } from '../../order/limits';
import { craftIdSchema, formBoolean, moneyOptionalField, optionalDateFieldPartial, optionalFormBoolean, optionalShipmentText, optionalTrimmedText, orderItemFoilColorsField, orderItemFoilSideColorsField, orderItemMoneyOptionalField, orderItemQuantityField, requiredFormBoolean, requiredTrimmedText, shipmentBillableWeightField, shipmentChargeMoneyField } from './shared';

export const cancelOrderSchema = z.object({
  reason: requiredTrimmedText('取消原因', 500),
});

export type CancelOrderInput = z.infer<typeof cancelOrderSchema>;

// 标记发货：trackingNo 选填（运单号）。Order.trackingNo 是 nullable
// text，用同一 optional-trimmed 收尾的 helper。
const shipOrderVersionField = (label: string, minimum: number) =>
  z.preprocess(
    (value) => {
      if (typeof value === 'number') return value;
      if (typeof value !== 'string') return value;
      const normalized = value.trim();
      return /^\d+$/.test(normalized) ? Number(normalized) : undefined;
    },
    z
      .number({ message: `${label}格式非法` })
      .finite(`${label}格式非法`)
      .safe(`${label}超出安全范围`)
      .int(`${label}必须是整数`)
      .min(minimum, `${label}不能小于 ${minimum}`),
  );

export const shipOrderSchema = z.object({
  expectedRevision: shipOrderVersionField('工单修订号', 0),
  expectedEditVersion: shipOrderVersionField('工单编辑版本', 0),
  expectedWorkOrderVersion: shipOrderVersionField('纸质工单版本', 1),
  expectedPriceRevision: shipOrderVersionField('价格版本', 0),
  idempotencyKey: z.string().uuid('发货请求标识格式非法'),
  trackingNo: optionalTrimmedText('运单号', 64),
  shipments: z
    .array(
      z.object({
        shipmentId: z
          .string()
          .trim()
          .regex(/^[A-Za-z0-9_-]+$/, '发货记录 id 格式非法'),
        trackingNo: optionalTrimmedText('运单号', 64),
        weightKg: z.preprocess(
          (value) =>
            value === null || value === undefined || value === ''
              ? null
              : typeof value === 'string'
                ? value.trim()
                : value,
          z.union([
            z.null(),
            z
              .string()
              .regex(/^\d{1,6}(?:\.\d{1,3})?$/, '快递重量格式不合法')
              .refine((value) => Number(value) > 0, '快递重量必须大于 0'),
          ]),
        ).optional(),
        destinationProvince: optionalShipmentText('计费省份', 32),
        shippingFee: shipmentChargeMoneyField,
        packingMaterialFee: shipmentChargeMoneyField,
        customerChargeOverrideReason: optionalShipmentText('收费调整说明', 500),
      }),
    )
    .max(10, '单工单发货地址不超过 10 个')
    .default([]),
});

export type ShipOrderInput = z.infer<typeof shipOrderSchema>;

const reworkEntityId = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]+$/, '记录 id 格式非法');

const optionalReworkUnitsPerBagField = z.preprocess(
  (value) => {
    if (value === '' || value === null || value === undefined) return undefined;
    if (typeof value === 'string' && /^\d+$/u.test(value.trim())) {
      return Number.parseInt(value.trim(), 10);
    }
    return value;
  },
  z
    .number({ message: '每袋数量必须是数字' })
    .int('每袋数量必须是整数')
    .min(1, '每袋数量必须大于 0')
    .max(9_999_999, '每袋数量过大')
    .optional(),
);

export const createReworkOrderSchema = z.object({
  sourceOrderId: reworkEntityId,
  cause: z.enum(ReworkCause),
  reason: z.string().trim().min(1, '请填写重做原因').max(500, '重做原因过长'),
  items: z
    .array(
      z.object({
        sourceOrderItemId: reworkEntityId,
        quantity: orderItemQuantityField,
        // 只有历史原单无结构化包装组且该款 pack 也缺失时，
        // 域层才会采用管理员显式补录的每袋数；不得覆盖 canonical 包装组。
        unitsPerBag: optionalReworkUnitsPerBagField,
        craftIds: z
          .array(craftIdSchema)
          .max(10)
          .refine(
            (craftIds) => new Set(craftIds).size === craftIds.length,
            '重做工艺不能重复',
          ),
      }),
    )
    .min(1, '至少选择一个需要重做的款式')
    .max(50, '单次重做款式不超过 50 项'),
});

export type CreateReworkOrderInput = z.infer<typeof createReworkOrderSchema>;

const orderChangeId = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]+$/, '记录 id 格式非法');

const targetBlankIdentitySchema = z.object({
  paperType: z.string().trim().min(1).max(100),
  paperWeightGsm: z.number().int().min(1).max(2000),
  specification: z.string().trim().min(1).max(64),
}).strict();

const updateOrderItemChangeSchema = z
  .object({
    operation: z.literal('UPDATE'),
    itemId: orderChangeId,
    name: z.string().trim().min(1).max(64).optional(),
    quantity: orderItemQuantityField.optional(),
    pack: z.number().int().min(1).max(9_999_999).optional(),
    specification: optionalTrimmedText('规格', 64).optional(),
    targetProductId: orderChangeId.optional(),
    targetBlankIdentity: targetBlankIdentitySchema.optional(),
    frontFoilColors: orderItemFoilSideColorsField.optional(),
    backFoilColors: orderItemFoilSideColorsField.optional(),
    // Historical clients only submitted one aggregate array. It remains
    // readable at the command boundary, but the domain layer immediately
    // projects it into explicit front/back facts before persisting.
    foilColors: orderItemFoilColorsField.optional(),
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.quantity !== undefined ||
      value.pack !== undefined ||
      value.specification !== undefined ||
      value.targetProductId !== undefined ||
      value.targetBlankIdentity !== undefined ||
      value.frontFoilColors !== undefined ||
      value.backFoilColors !== undefined ||
      value.foilColors !== undefined,
    '至少修改一个款式字段',
  );

const addOrderItemChangeSchema = z.object({
  operation: z.literal('ADD'),
  templateItemId: orderChangeId,
  name: z.string().trim().min(1, '请填写新增款式名').max(64),
  quantity: orderItemQuantityField,
  specification: optionalTrimmedText('规格', 64).optional(),
  targetProductId: orderChangeId.optional(),
  targetBlankIdentity: targetBlankIdentitySchema.optional(),
  frontFoilColors: orderItemFoilSideColorsField.optional(),
  backFoilColors: orderItemFoilSideColorsField.optional(),
  foilColors: orderItemFoilColorsField.optional(),
});

export const orderChangeRequestItemsSchema = z
  .array(
    z.discriminatedUnion('operation', [
      updateOrderItemChangeSchema,
      addOrderItemChangeSchema,
    ]),
  )
  .max(50, '单次修改不超过 50 项')
  .superRefine((value, ctx) => {
    const updatedItemIds = new Set<string>();
    value.forEach((item, index) => {
      if (item.operation !== 'UPDATE') return;
      if (updatedItemIds.has(item.itemId)) {
        ctx.addIssue({
          code: 'custom',
          path: [index, 'itemId'],
          message: '同一款式不能重复提交修改',
        });
      }
      updatedItemIds.add(item.itemId);
    });
  });

const orderChangeReason = z
  .string()
  .trim()
  .min(1, '请填写申请说明')
  .max(500, '申请说明过长');

const MAX_ORDER_CHANGE_PENDING_CHARGE_RESOLUTIONS = 10;

const orderChangeProjectedQuantityField = z.preprocess(
  (value) => {
    if (typeof value === 'number') return value;
    if (typeof value !== 'string') return value;
    const normalized = value.trim();
    return /^\d+$/.test(normalized) ? Number(normalized) : undefined;
  },
  z
    .number({ message: '投影分货数量格式非法' })
    .finite('投影分货数量格式非法')
    .safe('投影分货数量超出安全范围')
    .int('投影分货数量必须是整数')
    .min(0, '投影分货数量不能小于 0')
    .max(
      MAX_ORDER_ITEMS_PER_ORDER * 9_999_999,
      '投影分货数量过大',
    ),
);

const orderChangeResolutionAmountField = shipmentChargeMoneyField.refine(
  (value): value is string => value !== null,
  '请填写人工确认收费',
);

/**
 * An administrator may resolve only the shipment charge rows returned by the
 * proposed-change preview. These expected facts are optimistic-concurrency
 * evidence; the domain service still has to recompute and match every field
 * under the order lock before trusting the submitted amount.
 */
export const orderChangePendingChargeResolutionSchema = z.object({
  businessKey: z
    .string()
    .trim()
    .min(1, '收费业务键不能为空')
    .max(128, '收费业务键过长')
    .transform((value) => value.toUpperCase()),
  shipmentId: orderChangeId,
  expectedSequence: shipOrderVersionField('发货记录序号', 1),
  expectedProjectedQuantity: orderChangeProjectedQuantityField,
  expectedDestinationProvince: optionalShipmentText('预览计费省份', 32),
  amount: orderChangeResolutionAmountField,
  reason: requiredTrimmedText('人工物流定价依据', 500),
});

export type OrderChangePendingChargeResolutionInput = z.infer<
  typeof orderChangePendingChargeResolutionSchema
>;

const orderChangePendingChargeResolutionsSchema = z
  .array(orderChangePendingChargeResolutionSchema)
  .max(
    MAX_ORDER_CHANGE_PENDING_CHARGE_RESOLUTIONS,
    `单次改单待核物流费不超过 ${MAX_ORDER_CHANGE_PENDING_CHARGE_RESOLUTIONS} 项`,
  )
  .default([])
  .superRefine((resolutions, ctx) => {
    const businessKeys = new Set<string>();
    const shipmentIds = new Set<string>();
    resolutions.forEach((resolution, index) => {
      const normalizedBusinessKey = resolution.businessKey.toUpperCase();
      if (businessKeys.has(normalizedBusinessKey)) {
        ctx.addIssue({
          code: 'custom',
          path: [index, 'businessKey'],
          message: '同一物流收费不能重复提交',
        });
      }
      businessKeys.add(normalizedBusinessKey);
      if (shipmentIds.has(resolution.shipmentId)) {
        ctx.addIssue({
          code: 'custom',
          path: [index, 'shipmentId'],
          message: '同一发货记录不能重复提交人工物流收费',
        });
      }
      shipmentIds.add(resolution.shipmentId);
    });
  });

const modifyOrderChangeRequestSchema = z
  .object({
    orderId: orderChangeId,
    expectedRevision: shipOrderVersionField('工单修订号', 1),
    expectedWorkOrderVersion: shipOrderVersionField('纸质工单版本', 1),
    type: z.literal('MODIFY'),
    modifyKind: z.enum(['QTY', 'DUE_DATE', 'ADDRESS', 'CRAFT_PAPER', 'OTHER']),
    reason: orderChangeReason,
    items: orderChangeRequestItemsSchema,
    promisedDate: optionalDateFieldPartial,
  })
  .superRefine((value, ctx) => {
    if (value.items.length === 0 && value.promisedDate === undefined) {
      ctx.addIssue({ code: 'custom', path: ['items'], message: '至少填写一项款式或交期修改' });
    }
    value.items.forEach((item, index) => {
      if (item.targetBlankIdentity !== undefined) {
        if (item.targetProductId !== undefined || item.specification !== undefined) {
          ctx.addIssue({ code: 'custom', path: ['items', index, 'targetBlankIdentity'], message: '空白封规格不能同时提交旧产品选择' });
        }
        return;
      }
      const hasSpecification = typeof item.specification === 'string';
      const hasTargetProduct = item.targetProductId !== undefined;
      if (hasSpecification === hasTargetProduct) return;
      ctx.addIssue({
        code: 'custom',
        path: [
          'items',
          index,
          hasSpecification ? 'targetProductId' : 'specification',
        ],
        message:
          '修改规格必须同时提交目标报价产品与产品目录规格',
      });
    });
  });

const cancelOrderChangeRequestSchema = z.object({
  orderId: orderChangeId,
  expectedRevision: shipOrderVersionField('工单修订号', 1),
  expectedWorkOrderVersion: shipOrderVersionField('纸质工单版本', 1),
  type: z.literal('CANCEL'),
  reason: orderChangeReason,
  items: z.array(z.never()).max(0).default([]),
});

// Existing callers predate the explicit type/kind columns. Normalize that
// public input to MODIFY/OTHER while keeping CANCEL a distinct, item-free
// command. No amount or settlement timestamp is accepted here.
export const createOrderChangeRequestSchema = z.preprocess(
  (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    const record = value as Record<string, unknown>;
    if (record.type === 'CANCEL') return record;
    return {
      ...record,
      type: 'MODIFY',
      modifyKind: record.modifyKind ?? 'OTHER',
    };
  },
  z.discriminatedUnion('type', [
    modifyOrderChangeRequestSchema,
    cancelOrderChangeRequestSchema,
  ]),
);

export type CreateOrderChangeRequestInput = z.infer<
  typeof createOrderChangeRequestSchema
>;

const reviewOrderChangeRequestBaseSchema = z.object({
  requestId: orderChangeId,
  // Rejection does not depend on a price revision. Approval must require and
  // compare this value in the locked domain command.
  expectedPriceRevision: shipOrderVersionField('价格版本', 0).optional(),
  expectedQuoteToken: z
    .string()
    .trim()
    .regex(
      /^order-change-approval-v1:[a-f\d]{64}$/u,
      '计价预览凭证格式错误',
    )
    .optional(),
  pendingChargeResolutions: orderChangePendingChargeResolutionsSchema,
  decision: z.enum(['APPROVE', 'DENY', 'REJECT']),
  reviewRemark: optionalTrimmedText('审核备注', 500),
  producedQty: z.number().int().nonnegative().optional(),
  settleFee: z
    .string()
    .trim()
    .regex(/^\d{1,10}(?:\.\d{1,2})?$/, '结算金额格式错误')
    .optional(),
  settleFeeAdjustmentReason: z.string().trim().max(500).optional(),
});

export const reviewOrderChangeRequestSchema = reviewOrderChangeRequestBaseSchema
  .superRefine((value, ctx) => {
    if (
      (value.decision === 'DENY' || value.decision === 'REJECT') &&
      !value.reviewRemark?.trim()
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['reviewRemark'],
        message: '拒绝必须填写原因',
      });
    }
  });

type ParsedReviewOrderChangeRequestInput = z.infer<
  typeof reviewOrderChangeRequestSchema
>;
export type ReviewOrderChangeRequestInput = Omit<
  ParsedReviewOrderChangeRequestInput,
  'pendingChargeResolutions'
> & {
  pendingChargeResolutions?: OrderChangePendingChargeResolutionInput[];
};

export const previewOrderChangeRequestPricingSchema =
  reviewOrderChangeRequestBaseSchema.pick({
    requestId: true,
    expectedPriceRevision: true,
    pendingChargeResolutions: true,
  });

export const previewOrderCancellationSettlementSchema =
  reviewOrderChangeRequestBaseSchema
    .pick({ requestId: true, producedQty: true })
    .required({ producedQty: true });

export type PreviewOrderCancellationSettlementInput = z.infer<
  typeof previewOrderCancellationSettlementSchema
>;

type ParsedPreviewOrderChangeRequestPricingInput = z.infer<
  typeof previewOrderChangeRequestPricingSchema
>;
export type PreviewOrderChangeRequestPricingInput = Omit<
  ParsedPreviewOrderChangeRequestPricingInput,
  'pendingChargeResolutions'
> & {
  pendingChargeResolutions?: OrderChangePendingChargeResolutionInput[];
};

export const withdrawOrderChangeRequestSchema = z.object({
  requestId: orderChangeId,
});

export type WithdrawOrderChangeRequestInput = z.infer<
  typeof withdrawOrderChangeRequestSchema
>;

// 工厂终价只接收管理员对待定行的确认值；价目簿 id、自动价和小计
// 一律读取工单已经锁定的快照，不信任浏览器金额或当前价表。
const orderPricingRevisionField = z.preprocess(
  (value) => {
    if (typeof value === 'number') return value;
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    return /^\d+$/.test(trimmed) ? Number.parseInt(trimmed, 10) : Number.NaN;
  },
  z.number().int('价格版本必须是整数').min(1, '价格版本非法'),
);

const confirmedShipmentChargeMoneyField = shipmentChargeMoneyField.refine(
  (value): value is string => value !== null,
  '请填写确认收费',
);

const signedOrderAdjustmentMoneyField = z.preprocess(
  (value) => (value === null || value === undefined ? '' : value),
  z
    .string()
    .trim()
    .refine(
      (value) =>
        /^-?(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(value),
      '调整金额格式错误（整数部分最多 10 位、小数最多 2 位）',
    ),
);

export const previewOrderPricingReviewSchema = z.object({
  editAll: z.boolean().optional(),
  orderId: orderChangeId,
});

export type PreviewOrderPricingReviewInput = z.infer<
  typeof previewOrderPricingReviewSchema
>;

export const finalizeOrderPricingSchema = z
  .object({
    editAll: z.boolean().optional(),
    orderId: orderChangeId,
    expectedOrderRevision: orderPricingRevisionField,
    expectedPriceRevision: orderPricingRevisionField,
    items: z
      .array(
        z.object({
          itemId: orderChangeId,
          unitPrice: moneyOptionalField,
          fixedFee: orderItemMoneyOptionalField,
          reason: optionalTrimmedText('管理员定价依据', 500),
        }),
      )
      .max(
        MAX_ORDER_ITEMS_PER_ORDER,
        `单工单款式不超过 ${MAX_ORDER_ITEMS_PER_ORDER} 项`,
      )
      .default([]),
    packagingGroups: z
      .array(
        z.object({
          packagingGroupId: orderChangeId,
          expectedMode: z.enum(OrderPackagingMode),
          expectedActualBagCount: z.preprocess(
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
          unitPrice: moneyOptionalField,
          reason: optionalTrimmedText('包装组定价依据', 500),
        }),
      )
      .max(20, '单工单包装组不超过 20 组')
      .default([]),
    orderCharges: z
      .array(
        z.object({
          chargeId: orderChangeId,
          expectedBusinessKey: z
            .string()
            .trim()
            .min(1, '订单级收费业务键不能为空')
            .max(128, '订单级收费业务键过长'),
          amount: z.union([confirmedShipmentChargeMoneyField, signedOrderAdjustmentMoneyField]),
          reason: optionalTrimmedText('订单级收费定价依据', 500),
        }),
      )
      .max(50, '单工单订单级待核价费用不超过 50 项')
      .default([]),
    shipments: z
      .array(
        z.object({
          shipmentId: orderChangeId,
          expectedDestinationProvince: optionalShipmentText('预览计费省份', 32),
          expectedBillableWeightKg: shipmentBillableWeightField,
          shippingFee: confirmedShipmentChargeMoneyField,
          packingMaterialFee: confirmedShipmentChargeMoneyField,
          reason: optionalShipmentText('收费确认说明', 500),
        }),
      )
      .max(10, '单工单发货地址不超过 10 个'),
    remark: optionalTrimmedText('终价备注', 500),
  })
  .superRefine((input, ctx) => {
    const itemIds = new Set<string>();
    input.items.forEach((item, index) => {
      if (itemIds.has(item.itemId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['items', index, 'itemId'],
          message: '同一款式不能重复提交终价',
        });
      }
      itemIds.add(item.itemId);
    });

    const shipmentIds = new Set<string>();
    input.shipments.forEach((shipment, index) => {
      if (shipmentIds.has(shipment.shipmentId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['shipments', index, 'shipmentId'],
          message: '同一发货地址不能重复提交收费',
        });
      }
      shipmentIds.add(shipment.shipmentId);
    });

    const orderChargeIds = new Set<string>();
    input.orderCharges.forEach((charge, index) => {
      if (orderChargeIds.has(charge.chargeId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['orderCharges', index, 'chargeId'],
          message: '同一订单级待核价费用不能重复提交',
        });
      }
      orderChargeIds.add(charge.chargeId);
    });

    const packagingGroupIds = new Set<string>();
    input.packagingGroups.forEach((group, index) => {
      if (packagingGroupIds.has(group.packagingGroupId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['packagingGroups', index, 'packagingGroupId'],
          message: '同一包装组不能重复提交终价',
        });
      }
      packagingGroupIds.add(group.packagingGroupId);
    });
  });

export type FinalizeOrderPricingInput = z.infer<
  typeof finalizeOrderPricingSchema
>;

const orderCommercialMoneyField = orderItemMoneyOptionalField.refine(
  (value): value is string => value !== null,
  '请填写金额',
);

export const saveOrderManualChargeSchema = z
  .object({
    orderId: orderChangeId,
    chargeId: orderChangeId.nullable().default(null),
    expectedPriceRevision: orderPricingRevisionField,
    categoryCode: z.enum([
      'SAMPLE_FEE',
      'OTHER_PACKAGING_FEE',
      'APPROVED_ADJUSTMENT',
    ]),
    description: requiredTrimmedText('收费说明', 120),
    amount: z.union([
      orderCommercialMoneyField,
      signedOrderAdjustmentMoneyField,
    ]),
    reason: requiredTrimmedText('收费原因', 500),
    approvalReference: optionalTrimmedText('审批信息', 500).default(null),
  })
  .superRefine((input, ctx) => {
    const signedAmount = Number(input.amount);
    if (
      input.categoryCode !== 'APPROVED_ADJUSTMENT' &&
      signedAmount < 0
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['amount'],
        message: '只有经审批调整金额可以为负数',
      });
    }
    if (
      input.categoryCode === 'APPROVED_ADJUSTMENT' &&
      !input.approvalReference
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['approvalReference'],
        message: '经审批调整必须填写审批信息',
      });
    }
  });

export const deleteOrderManualChargeSchema = z.object({
  orderId: orderChangeId,
  chargeId: orderChangeId,
  expectedPriceRevision: orderPricingRevisionField,
  reason: requiredTrimmedText('移除原因', 500),
});

export const saveOrderPlateDetailSchema = z.object({
  orderId: orderChangeId,
  orderItemId: orderChangeId,
  plateDetailId: orderChangeId.nullable().default(null),
  expectedPriceRevision: orderPricingRevisionField,
  name: requiredTrimmedText('制版名称', 120),
  plateGroupId: optionalTrimmedText('版组 ID', 64).default(null),
  specification: optionalTrimmedText('制版规格', 120).default(null),
  quantity: orderItemQuantityField,
  unitPrice: orderCommercialMoneyField,
  remark: optionalTrimmedText('制版备注', 500).default(null),
});

export const deleteOrderPlateDetailSchema = z.object({
  orderId: orderChangeId,
  orderItemId: orderChangeId,
  plateDetailId: orderChangeId,
  expectedPriceRevision: orderPricingRevisionField,
  reason: requiredTrimmedText('移除原因', 500),
});

export type SaveOrderManualChargeInput = z.infer<
  typeof saveOrderManualChargeSchema
>;
export type DeleteOrderManualChargeInput = z.infer<
  typeof deleteOrderManualChargeSchema
>;
export type SaveOrderPlateDetailInput = z.infer<
  typeof saveOrderPlateDetailSchema
>;
export type DeleteOrderPlateDetailInput = z.infer<
  typeof deleteOrderPlateDetailSchema
>;

//
// E-full (item add/remove/edit) is deferred to P1. These schemas cover
// the top-level Order fields; the action layer picks the FULL or
// SHIPPING_ONLY shape based on the order's current status and rejects
// anything outside the allowed set before reaching the lib.

// Partial-update shape: every field is independently optional so the
// action can submit only what the form actually touched. Missing key
// → don't change; optional text may be cleared to null. receiverAddress
// is the deliberate exception: once supplied it must stay non-blank.
// optionalFormBoolean handles the undefined case for the urgent checkbox.
const staleOrderEditTokenMessage = '编辑页面已过期，请刷新后重试';

// The database owns this monotonic token. Keep the hidden form value strict
// so scientific notation, decimals and unsafe integers cannot weaken the CAS.
const expectedOrderEditVersionField = z
  .preprocess(
    (value) => (typeof value === 'string' ? value.trim() : ''),
    z
      .string()
      .regex(/^(0|[1-9]\d*)$/, staleOrderEditTokenMessage)
      .transform(Number)
      .refine(Number.isSafeInteger, staleOrderEditTokenMessage),
  )
  .pipe(z.number().int().nonnegative());

export const editOrderShipmentSchema = z.object({
  id: z.string().trim().min(1).max(128),
  receiverName: optionalTrimmedText('收件人', 64),
  receiverPhone: optionalTrimmedText('收货电话', 32),
  receiverAddress: requiredTrimmedText('收货地址', 256),
  expressCode: optionalTrimmedText('快递代码', 32),
  expectedDestinationProvince: optionalTrimmedText('配送省份', 32),
  sameDestination: z.boolean(),
}).strict();

// 客户名称/简称与关联客户已退役（业主 2026-09-27）：编辑不再改动客户字段。这里不声明
// 这两个 key，旧表单若仍提交会被 z.object 默认剥离，工单已存的客户值保持原样。
export const updateEditableOrderSchema = z.object({
  expectedEditVersion: expectedOrderEditVersionField,
  externalSalesUserId: requiredTrimmedText('关联外部销售', 64).optional(),
  shipments: z.array(editOrderShipmentSchema).max(10, '单工单不超过 10 个收货地址').optional().refine((rows) => !rows || new Set(rows.map((row) => row.id)).size === rows.length, '收货地址不能重复'),
  customName: optionalTrimmedText('工单名称', 100).optional(),
  receiverName: optionalTrimmedText('收货人', 64).optional(),
  receiverPhone: optionalTrimmedText('收货电话', 32).optional(),
  // 普通编辑允许不传该 key（partial update），但只要传了就不能清空。
  receiverAddress: requiredTrimmedText('收货地址', 256).optional(),
  expressCode: optionalTrimmedText('快递代码', 32).optional(),
  packageRequirement: optionalTrimmedText('包装补充说明', 500).optional(),
  remark: optionalTrimmedText('工单备注', 1000).optional(),
  promisedDate: optionalDateFieldPartial,
  isUrgent: optionalFormBoolean,
});

export type UpdateEditableOrderInput = z.infer<typeof updateEditableOrderSchema>;

export const updateShippingOrderSchema = z.object({
  expectedEditVersion: expectedOrderEditVersionField,
  receiverName: optionalTrimmedText('收货人', 64),
  receiverPhone: optionalTrimmedText('收货电话', 32),
  receiverAddress: requiredTrimmedText('收货地址', 256),
  expressCode: optionalTrimmedText('快递代码', 32),
  packageRequirement: optionalTrimmedText('包装补充说明', 500),
  remark: optionalTrimmedText('工单备注', 1000),
});

export type UpdateShippingOrderInput = z.infer<typeof updateShippingOrderSchema>;

// Lightweight schema for the inline 急单 toggle — keeps that quick
// one-click UX separate from the main edit form so a failed form
// validation doesn't block a simple urgent-flag flip.
// Toggle is a one-click action — the value IS the intent, so require
// it explicitly instead of defaulting.
export const setOrderUrgentSchema = z.object({
  isUrgent: formBoolean,
});

export type SetOrderUrgentInput = z.infer<typeof setOrderUrgentSchema>;

// 顺丰到付是独立的发货属性：工单进入生产后仍可更正，避免为了改
// 一个到付标识而重新开放已冻结的金额 / 款式字段。
export const setOrderSfCollectSchema = z
  .object({
    isSfCollect: requiredFormBoolean,
    shipments: z
      .array(
        z.object({
          shipmentId: z
            .string()
            .trim()
            .regex(/^[A-Za-z0-9_-]+$/, '发货记录 id 格式非法'),
          destinationProvince: optionalShipmentText('计费省份', 32),
          weightKg: shipmentBillableWeightField,
          shippingFee: shipmentChargeMoneyField,
          customerChargeOverrideReason: optionalShipmentText(
            '收费调整说明',
            500,
          ),
        }),
      )
      .max(10, '单工单发货地址不超过 10 个')
      .default([]),
  })
  .superRefine((input, ctx) => {
    const seen = new Set<string>();
    for (const [index, shipment] of input.shipments.entries()) {
      if (seen.has(shipment.shipmentId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['shipments', index, 'shipmentId'],
          message: '发货记录不能重复',
        });
      }
      seen.add(shipment.shipmentId);
    }
  });

export type SetOrderSfCollectInput = z.infer<typeof setOrderSfCollectSchema>;

export const repairLegacyProductionFactsSchema = z.object({
  orderId: reworkEntityId,
  expectedOrderRevision: shipOrderVersionField('工单版本', 0),
  items: z.array(z.object({
    itemId: reworkEntityId,
    craft: z.enum(OrderCraft).optional(),
    unitsPerBag: optionalReworkUnitsPerBagField,
  })).max(MAX_ORDER_ITEMS_PER_ORDER),
  packagingMode: z.enum(OrderPackagingMode).optional(),
}).superRefine((value, ctx) => {
  const ids = new Set<string>();
  value.items.forEach((item, index) => {
    if (ids.has(item.itemId)) ctx.addIssue({ code: 'custom', path: ['items', index, 'itemId'], message: '款式不能重复' });
    ids.add(item.itemId);
  });
});

export type RepairLegacyProductionFactsInput = z.infer<typeof repairLegacyProductionFactsSchema>;
