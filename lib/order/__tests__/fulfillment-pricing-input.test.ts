import { describe, expect, it } from 'vitest';
import {
  finalizeFulfillmentPricingSchema,
  fulfillmentPricingGuardSchema,
  previewFulfillmentPricingSchema,
} from '../fulfillment-pricing-input';

const guard = {
  expectedOrderRevision: 4,
  expectedEditVersion: 0,
  expectedWorkOrderVersion: 1,
  expectedPriceRevision: 3,
  idempotencyKey: '018e2b38-533c-4ced-8f77-07d99272b580',
};
const command = { orderId: 'order-1', isSfCollect: true, shipments: [] };

describe('fulfillment pricing input boundary', () => {
  it('accepts explicit target and complete safe version guards', () => {
    expect(previewFulfillmentPricingSchema.parse(command)).toEqual(command);
    expect(finalizeFulfillmentPricingSchema.parse({
      ...command, ...guard, previewToken: 'fulfillment-pricing-v1:' + 'a'.repeat(64),
    })).toMatchObject(guard);
    expect(fulfillmentPricingGuardSchema.parse({
      ...guard, expectedOrderRevision: '4', expectedEditVersion: '0',
    })).toEqual(guard);
  });

  it.each(['', '1e2', '-1', '1.2', '9007199254740992', null])(
    'rejects malformed version %s instead of coercing a guard', (value) => {
      expect(fulfillmentPricingGuardSchema.safeParse({
        ...guard, expectedOrderRevision: value,
      }).success).toBe(false);
    },
  );

  it('requires an explicit target, preview token, and all version fields', () => {
    expect(previewFulfillmentPricingSchema.safeParse({ orderId: 'order-1' }).success).toBe(false);
    expect(finalizeFulfillmentPricingSchema.safeParse({ ...command, ...guard }).success).toBe(false);
    expect(fulfillmentPricingGuardSchema.safeParse({ expectedPriceRevision: 2 }).success).toBe(false);
  });

  it('rejects attempts to change processing prices through the logistics command', () => {
    expect(previewFulfillmentPricingSchema.safeParse({
      ...command, processingAmount: '0.01',
    }).success).toBe(false);
    expect(finalizeFulfillmentPricingSchema.safeParse({
      ...command, ...guard, previewToken: 'token', items: [{ unitPrice: '0.01' }],
    }).success).toBe(false);
  });

  it('preserves duplicate-shipment validation from the existing correction contract', () => {
    const shipment = { shipmentId: 'shipment-1', destinationProvince: '浙江', weightKg: '1', shippingFee: '10' };
    const parsed = previewFulfillmentPricingSchema.safeParse({
      ...command, isSfCollect: false, shipments: [shipment, shipment],
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues.some((issue) => issue.message.includes('重复'))).toBe(true);
  });
});
