import Decimal from 'decimal.js';
import type { CancellationSettlementReference } from '@/lib/order/change-request';

export function cancellationReviewIssue({
  producedQuantity,
  totalQuantity,
  preview,
  previewQuantity,
  finalFee,
  adjustmentReason,
}: {
  producedQuantity: number | null;
  totalQuantity: number;
  preview: CancellationSettlementReference | null;
  previewQuantity: number | null;
  finalFee: string;
  adjustmentReason: string;
}): string | null {
  if (producedQuantity === null || !Number.isSafeInteger(producedQuantity) || producedQuantity < 0 || producedQuantity > totalQuantity) {
    return `请填写 0–${totalQuantity} 之间的已产数量。`;
  }
  if (!preview || previewQuantity !== producedQuantity) {
    return '请先按当前已产数量计算参考价，再核对最终结算金额。';
  }
  const amount = finalFee.trim();
  if (!/^\d{1,10}(?:\.\d{1,2})?$/u.test(amount)) {
    return '请填写最终结算金额，最多两位小数。';
  }
  if (!new Decimal(amount).eq(preview.referenceSettleFee) && !adjustmentReason.trim()) {
    return '最终金额与参考价不同，请填写结算调整原因。';
  }
  return null;
}
