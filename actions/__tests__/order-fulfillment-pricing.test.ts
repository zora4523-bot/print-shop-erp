import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Role } from '@/generated/prisma/enums';

const { permission, preview, finalize, revalidate, DomainError } = vi.hoisted(() => ({
  permission: vi.fn(), preview: vi.fn(), finalize: vi.fn(), revalidate: vi.fn(),
  DomainError: class extends Error {},
}));
vi.mock('@/lib/auth/permissions', () => ({ requirePermission: permission }));
vi.mock('next/cache', () => ({ revalidatePath: revalidate }));
vi.mock('@/lib/order/fulfillment-pricing', () => ({
  previewFulfillmentPricing: preview,
  finalizeFulfillmentPricing: finalize,
  FulfillmentPricingError: DomainError,
}));

import {
  finalizeFulfillmentPricingAction,
  previewFulfillmentPricingAction,
} from '../order-fulfillment-pricing';

const actor = { id: 'admin-1', role: Role.ADMIN };
const input = { orderId: 'order-1', isSfCollect: true, shipments: [] };
const confirmed = {
  ...input,
  expectedOrderRevision: 4, expectedEditVersion: 0,
  expectedWorkOrderVersion: 1, expectedPriceRevision: 3,
  previewToken: 'fulfillment-pricing-v1:' + 'a'.repeat(64),
  idempotencyKey: '018e2b38-533c-4ced-8f77-07d99272b580',
};

beforeEach(() => {
  vi.clearAllMocks();
  permission.mockReset().mockResolvedValue(actor);
  preview.mockReset().mockResolvedValue({ canConfirm: true, newTotal: '100.00' });
  finalize.mockReset().mockResolvedValue({ orderId: 'order-1', confirmedFee: '100.00', priceRevision: 4 });
});

describe('fulfillment pricing actions', () => {
  it.each([previewFulfillmentPricingAction, finalizeFulfillmentPricingAction])(
    'requires pricing confirmation permission before parsing or accessing data', async (action) => {
      permission.mockRejectedValue(new Error('无权操作'));
      await expect(action(null, {})).rejects.toThrow('无权操作');
      expect(permission).toHaveBeenCalledWith('order:price:confirm');
      expect(preview).not.toHaveBeenCalled();
      expect(finalize).not.toHaveBeenCalled();
    },
  );

  it('previews without writing or invalidating pages', async () => {
    expect(await previewFulfillmentPricingAction(null, input)).toMatchObject({ status: 'success', preview: { newTotal: '100.00' } });
    expect(preview).toHaveBeenCalledWith(input, actor);
    expect(finalize).not.toHaveBeenCalled();
    expect(revalidate).not.toHaveBeenCalled();
  });

  it('rejects unguarded or non-logistics payloads', async () => {
    expect(await finalizeFulfillmentPricingAction(null, input)).toMatchObject({ status: 'invalid' });
    expect(await finalizeFulfillmentPricingAction(null, { ...confirmed, processingAmount: '1' })).toMatchObject({ status: 'invalid' });
    expect(finalize).not.toHaveBeenCalled();
  });

  it('confirms with the preview and version guards, then refreshes affected views', async () => {
    expect(await finalizeFulfillmentPricingAction(null, confirmed)).toMatchObject({ status: 'success', orderId: 'order-1' });
    expect(finalize).toHaveBeenCalledWith(confirmed, actor);
    expect(revalidate).toHaveBeenCalledWith('/orders');
    expect(revalidate).toHaveBeenCalledWith('/orders/order-1');
    expect(revalidate).toHaveBeenCalledWith('/sales/bills');
  });

  it('returns actionable domain failures without invalidating pages', async () => {
    finalize.mockRejectedValue(new DomainError('价格已变化，请重新预览'));
    expect(await finalizeFulfillmentPricingAction(null, confirmed)).toEqual({ status: 'error', message: '价格已变化，请重新预览' });
    expect(revalidate).not.toHaveBeenCalled();
    preview.mockRejectedValue(new DomainError('缺少原始确认依据'));
    expect(await previewFulfillmentPricingAction(null, input)).toEqual({ status: 'error', message: '缺少原始确认依据' });
  });
});
