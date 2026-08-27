const ORDER_PRICING_SOURCE_LABELS = {
  ORDER_CREATED_AUTO: '建单自动计价',
  ORDER_CREATED_PROVISIONAL: '建单暂定价',
  ADMIN_FULL_REPRICE: '管理员重新计价',
  SHIPMENT_CHARGES_FINALIZED: '发货费用确认',
  SF_COLLECT_CHANGED_PENDING: '顺丰到付调整',
  CHANGE_REQUEST_APPLIED_PENDING: '工单变更待确认',
  REWORK_ORDER_CREATED_NO_CHARGE: '返工单免收费',
  ADMIN_MANUAL_CHARGE: '管理员调整附加费用',
  ADMIN_MANUAL_CHARGE_REMOVED: '管理员删除附加费用',
  ORDER_ITEM_PLATE_DETAIL: '管理员调整制版费用',
  ORDER_ITEM_PLATE_DETAIL_REMOVED: '管理员删除制版费用',
} as const;

export function orderPricingSourceLabel(
  source: string | null | undefined,
): string {
  if (!source) return '—';
  return (
    ORDER_PRICING_SOURCE_LABELS[
      source as keyof typeof ORDER_PRICING_SOURCE_LABELS
    ] ?? '未识别来源'
  );
}
