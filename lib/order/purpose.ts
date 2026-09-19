/** Purpose is independent of production craft and of NORMAL / REWORK. */
export const ORDER_PURPOSES = ['STANDARD', 'SAMPLE_SHIPMENT', 'PROOF'] as const;
export type OrderPurposeValue = (typeof ORDER_PURPOSES)[number];
export const ORDER_PURPOSE_LABELS: Record<OrderPurposeValue, string> = {
  STANDARD: '普通工单',
  SAMPLE_SHIPMENT: '寄样品',
  PROOF: '打样',
};
export function isSampleOrder(purpose: string | null | undefined) {
  return purpose === 'SAMPLE_SHIPMENT' || purpose === 'PROOF';
}
