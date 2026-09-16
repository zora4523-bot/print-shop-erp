import { describe, expect, it } from 'vitest';
import type { OrderPricingReviewPreview } from '@/lib/order/pricing-review';
import { adminFeeRows, feeEditorCommand, feeEditorTotal } from '@/lib/order/admin-fee-draft';
function preview(): OrderPricingReviewPreview {
  return { orderId: 'order', orderNo: 'test', editAll: true, purpose: 'PROOF', orderRevision: 4, priceRevision: 2,
    currentProcessingAmount: '0.00', currentPackagingAmount: '0.00', currentTotalAmount: '0.00', processingPriceBook: null, logisticsPriceBook: null,
    items: [], packagingGroups: [], shipments: [], orderCharges: [{ chargeId: 'proof', businessKey: 'ORDER:PROOF:TOTAL', categoryCode: 'SAMPLE_FEE', description: '打样整单总价', complete: false, errors: [], suggestedAmount: null, currentAmount: null, currentReason: null }] };
}
describe('administrator fee draft', () => {
  it('does not silently replace an unknown price with zero', () => {
    const data = preview(); expect(feeEditorTotal(data, adminFeeRows(data), {})).toBeNull();
  });
  it('uses decimal arithmetic and sends the complete proof total with versions', () => {
    const data = preview(); const values = { proof: '88.19' };
    expect(feeEditorTotal(data, adminFeeRows(data), values)).toBe('88.19');
    expect(feeEditorCommand(data, values, '管理员整单定价')).toMatchObject({ editAll: true, expectedOrderRevision: 4, expectedPriceRevision: 2, items: [], packagingGroups: [], shipments: [], orderCharges: [{ amount: '88.19', reason: '管理员整单定价' }] });
  });
  it('retains excluded structured plate amounts in the aggregate preview', () => {
    const data = preview(); data.currentTotalAmount = '100.10'; data.orderCharges[0].currentAmount = '80.00';
    expect(feeEditorTotal(data, adminFeeRows(data), { proof: '75.15' })).toBe('95.25');
  });
  it('preserves zero overrides and rejects malformed amounts in the preview', () => {
    const data = preview(); expect(feeEditorCommand(data, { proof: '0' }, '免收').orderCharges[0].amount).toBe('0');
    expect(feeEditorTotal(data, adminFeeRows(data), { proof: 'abc' })).toBeNull();
  });
});
