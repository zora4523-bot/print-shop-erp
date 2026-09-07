import { createHash } from 'node:crypto';
import Decimal from 'decimal.js';

export const ORDER_CHANGE_APPROVAL_TOKEN_PREFIX =
  'order-change-approval-v1:';

export type OrderChangeApprovalResolutionEvidence = {
  businessKey: string;
  shipmentId: string;
  expectedSequence: number;
  expectedProjectedQuantity: number;
  expectedDestinationProvince: string | null;
  amount: string;
  reason: string;
};

export type OrderChangeApprovalTokenEvidence = {
  requestId: string;
  baseRevision: number;
  priceRevision: number;
  pureQuoteToken: string;
  pendingChargeResolutions: readonly OrderChangeApprovalResolutionEvidence[];
};

function canonicalResolution(
  resolution: OrderChangeApprovalResolutionEvidence,
) {
  return {
    businessKey: resolution.businessKey.trim().toUpperCase(),
    shipmentId: resolution.shipmentId.trim(),
    expectedSequence: resolution.expectedSequence,
    expectedProjectedQuantity: resolution.expectedProjectedQuantity,
    expectedDestinationProvince:
      resolution.expectedDestinationProvince?.trim() || null,
    amount: new Decimal(resolution.amount).toFixed(2),
    reason: resolution.reason.trim(),
  };
}

function compareCanonicalText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/**
 * Binds a read-only change-price preview to the exact approval command. The
 * pure quote token still owns catalog/rule/result integrity; this envelope adds
 * request/version identity and administrator-entered pending charge facts.
 */
export function createOrderChangeApprovalToken(
  evidence: OrderChangeApprovalTokenEvidence,
): string {
  const pendingChargeResolutions = evidence.pendingChargeResolutions
    .map(canonicalResolution)
    .sort(
      (left, right) =>
        compareCanonicalText(left.businessKey, right.businessKey) ||
        compareCanonicalText(left.shipmentId, right.shipmentId),
    );
  const digest = createHash('sha256')
    .update(
      JSON.stringify({
        requestId: evidence.requestId.trim(),
        baseRevision: evidence.baseRevision,
        priceRevision: evidence.priceRevision,
        pureQuoteToken: evidence.pureQuoteToken,
        pendingChargeResolutions,
      }),
    )
    .digest('hex');
  return `${ORDER_CHANGE_APPROVAL_TOKEN_PREFIX}${digest}`;
}
