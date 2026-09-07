import { describe, expect, it } from 'vitest';
import type { CancellationSettlementReference } from '@/lib/order/change-request';
import { cancellationReviewIssue } from '../admin-order-cancellation-review';

const preview: CancellationSettlementReference = {
  referenceSettleFee: '100.10',
  calculation: 'CURRENT_PUBLISHED_ENGINE_V1',
  components: { itemProcessing: '100.10', bagging: '0.00', carton: '0.00', preservedManualCharges: '0.00', shipping: '0.00' },
  allocation: [{ orderItemId: 'item-1', producedQty: 100 }],
  priceVersions: { processing: null, logistics: null },
};
const ready = { producedQuantity: 100, totalQuantity: 1000, preview, previewQuantity: 100, finalFee: '100.10', adjustmentReason: '' };

describe('cancellation review before confirmation', () => {
  it('requires a successful preview for the exact current quantity', () => {
    expect(cancellationReviewIssue({ ...ready, preview: null })).toContain('计算参考价');
    expect(cancellationReviewIssue({ ...ready, previewQuantity: 99 })).toContain('当前已产数量');
    expect(cancellationReviewIssue(ready)).toBeNull();
  });
  it('requires an explicit valid final amount and treats equivalent decimal text as unchanged', () => {
    for (const finalFee of ['', '-1', '1e2', '100.101', '10000000000.00']) {
      expect(cancellationReviewIssue({ ...ready, finalFee }), finalFee).toContain('最终结算金额');
    }
    expect(cancellationReviewIssue({ ...ready, finalFee: '100.1' })).toBeNull();
    expect(cancellationReviewIssue({ ...ready, finalFee: '100.11' })).toContain('调整原因');
    expect(cancellationReviewIssue({ ...ready, finalFee: '100.11', adjustmentReason: '客户确认差额' })).toBeNull();
  });
  it('allows explicitly reviewed zero-production cancellation', () => {
    expect(cancellationReviewIssue({ ...ready, producedQuantity: 0, previewQuantity: 0, preview: { ...preview, referenceSettleFee: '0.00', calculation: 'ZERO_PRODUCTION' }, finalFee: '0.00' })).toBeNull();
  });
  it('rejects quantity outside the order before approving', () => {
    for (const producedQuantity of [null, -1, 1.5, 1001, Number.NaN]) {
      expect(cancellationReviewIssue({ ...ready, producedQuantity })).toContain('已产数量');
    }
  });
});
