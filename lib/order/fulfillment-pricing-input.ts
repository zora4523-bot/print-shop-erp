import { z } from 'zod';
import { setOrderSfCollectSchema } from '../auth/schemas';

function versionField(minimum: number) {
  return z.preprocess(
    (value) => typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value.trim())
      ? Number(value.trim())
      : value,
    z.number().int().min(minimum).max(Number.MAX_SAFE_INTEGER),
  );
}

// Keep tokens strict at the boundary. The domain checks them again against
// the locked order; absent tokens must never mean "use the latest version".
export const fulfillmentPricingGuardSchema = z.object({
  expectedOrderRevision: versionField(0),
  expectedEditVersion: versionField(0),
  expectedWorkOrderVersion: versionField(1),
  expectedPriceRevision: versionField(0),
  idempotencyKey: z.string().uuid('请求标识无效，请刷新后重试'),
}).strict();

export const previewFulfillmentPricingSchema = setOrderSfCollectSchema.safeExtend({
  orderId: z.string().trim().regex(/^[A-Za-z0-9_-]+$/, '工单标识无效'),
}).strict();

export const finalizeFulfillmentPricingSchema = previewFulfillmentPricingSchema.safeExtend({
  ...fulfillmentPricingGuardSchema.shape,
  previewToken: z.string().regex(/^fulfillment-pricing-v1:[a-f0-9]{64}$/, '请先预览物流费用差额'),
}).strict();
