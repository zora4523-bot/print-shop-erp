'use server';

import { z } from 'zod';
import { OrderSettlementType, Role } from '@/generated/prisma/enums';
import { MAX_ORDER_ITEMS_PER_ORDER } from '@/lib/order/limits';
import type {
  CreateOrderQuoteActionInput,
  CreateOrderQuoteMutationResult,
} from './create-order-quote.types';
import { collectFieldErrorsDeep } from '@/lib/admin/action-helpers';
import { requirePermission } from '@/lib/auth/permissions';
import {
  quoteExternalOrderChargesSchema,
  quoteCreateOrderPackagingGroupsSchema,
  createOrderQuoteItemsSchema,
} from '@/lib/auth/schemas';
import {
  CreateOrderQuoteError,
  quoteExternalCreateOrder,
} from '@/lib/order/create-order-quote-service';

const factsKeySchema = z
  .string()
  .max(512)
  .refine((value) => value.trim().length > 0, '报价事实标识不能为空');
const orderItemCountSchema = z
  .number({ error: '必须提供真实工单款式数' })
  .int('工单款式数必须是整数')
  .min(1)
  .max(MAX_ORDER_ITEMS_PER_ORDER);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function prefixedIssues(
  prefix: string,
  issues: readonly { path: readonly PropertyKey[]; message: string }[],
) {
  return issues.map((issue) => ({
    path: [prefix, ...issue.path],
    message: issue.message,
  }));
}

export async function quoteExternalCreateOrderAction(
  raw: unknown,
): Promise<CreateOrderQuoteMutationResult> {
  const actor = await requirePermission('order:create');

  if (actor.role !== Role.ADMIN && actor.role !== Role.SALES) {
    return { status: 'error', message: '当前账号不使用外部销售结算' };
  }
  if (!isRecord(raw)) {
    return { status: 'invalid', fieldErrors: { _: ['报价数据格式非法'] } };
  }

  const factsKey = factsKeySchema.safeParse(raw.factsKey);
  const orderItemCount = orderItemCountSchema.safeParse(raw.orderItemCount);
  const settlementType = z
    .literal(OrderSettlementType.EXTERNAL_SALES, {
      error: '仅支持外部销售建单报价',
    })
    .safeParse(raw.settlementType);
  const items = createOrderQuoteItemsSchema.safeParse({
    items: raw.items,
    orderItemCount: raw.orderItemCount,
  });
  const packaging = quoteCreateOrderPackagingGroupsSchema.safeParse({
    groups: raw.packagingGroups,
  });
  const forbiddenManualPricingIssues = Array.isArray(raw.items)
    ? raw.items.flatMap((item, index) =>
        isRecord(item) &&
        Object.prototype.hasOwnProperty.call(item, 'manualQuoteReason')
          ? [
              {
                path: ['items', index, 'manualQuoteReason'],
                message: '外部销售建单不接受配置外备注',
              },
            ]
          : [],
      )
    : [];

  const logisticsRaw = isRecord(raw.logistics) ? raw.logistics : {};
  const authoritativeChargeItems = items.success
    ? items.data.items.map((item, index) => ({
        itemKey: String(index + 1),
        quantity: item.quantity,
        paperWeightGsm: item.paperWeightGsm,
        paperType: item.paperType,
        productStructure: item.productStructure,
      }))
    : undefined;
  const logistics = quoteExternalOrderChargesSchema.safeParse({
    ...logisticsRaw,
    items: authoritativeChargeItems,
  });

  const issues = [
    ...(factsKey.success
      ? []
      : prefixedIssues('factsKey', factsKey.error.issues)),
    ...(settlementType.success
      ? []
      : prefixedIssues('settlementType', settlementType.error.issues)),
    ...(orderItemCount.success
      ? []
      : prefixedIssues('orderItemCount', orderItemCount.error.issues)),
    ...(items.success ? [] : items.error.issues),
    ...forbiddenManualPricingIssues,
    ...(packaging.success
      ? []
      : packaging.error.issues.map((issue) => ({
          path: [
            issue.path[0] === 'groups' ? 'packagingGroups' : 'packagingGroups',
            ...issue.path.slice(1),
          ],
          message: issue.message,
        }))),
    ...(logistics.success
      ? []
      : prefixedIssues('logistics', logistics.error.issues)),
  ];
  if (issues.length > 0) {
    return { status: 'invalid', fieldErrors: collectFieldErrorsDeep(issues) };
  }
  // Keep the successful parse branches explicit for TypeScript and for future
  // schema changes that might add a non-issue failure path.
  if (
    !factsKey.success ||
    !settlementType.success ||
    !orderItemCount.success ||
    !items.success ||
    !packaging.success ||
    !logistics.success
  ) {
    return { status: 'invalid', fieldErrors: { _: ['报价数据格式非法'] } };
  }

  try {
    const input: CreateOrderQuoteActionInput = {
      factsKey: factsKey.data,
      settlementType: settlementType.data,
      items: items.data.items,
      orderItemCount: orderItemCount.data,
      packagingGroups: packaging.data.groups,
      logistics: logistics.data,
    };
    const quote = await quoteExternalCreateOrder(input);
    return { status: 'success', quote };
  } catch (error) {
    return {
      status: 'error',
      message:
        error instanceof CreateOrderQuoteError
          ? `报价失败：${error.message}`
          : '报价失败，请检查价目配置后重试',
    };
  }
}

/** Sample purposes share the create permission and the published price reader. */
export async function quoteSampleOrderAction(raw: unknown): Promise<
  | { status: 'success'; quote: import('@/lib/order/sample-order').SampleOrderQuote }
  | { status: 'error'; message: string }
> {
  await requirePermission('order:create');
  try {
    const { quoteSampleOrder } = await import('@/lib/order/sample-order');
    return { status: 'success', quote: await quoteSampleOrder(raw) };
  } catch (error) {
    if (error instanceof z.ZodError) return { status: 'error', message: error.issues.map((issue) => issue.message).join('；') };
    if (error instanceof Error && ['SampleOrderError', 'PublishedCreateOrderPriceAdapterError'].includes(error.name)) return { status: 'error', message: error.message };
    throw error;
  }
}
