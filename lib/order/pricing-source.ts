const ORDER_PRICING_SOURCE_LABELS = {
  ORDER_CREATED_AUTO: '建单自动计价',
  ORDER_CREATED_PROVISIONAL: '建单暂定价',
  EXTERNAL_SUBMIT_QUOTE: '外部销售提交报价',
  ADMIN_FULL_REPRICE: '管理员重新计价',
  ADMIN_SNAPSHOT_CONFIRMATION: '管理员确认报价快照',
  FACTORY_CONFIRM_CURRENT_PUBLISHED: '工厂按当前价表确认',
  SHIPMENT_CHARGES_FINALIZED: '发货费用确认',
  SF_COLLECT_CHANGED_PENDING: '顺丰到付调整',
  FULFILLMENT_SHIPPING_CONFIRMED: '管理员确认物流费用',
  CHANGE_REQUEST_APPLIED_PENDING: '工单变更待确认',
  CHANGE_REQUEST_APPLIED_AUTO_CONFIRMED: '工单变更自动计价',
  CHANGE_REQUEST_APPROVED_CURRENT_PUBLISHED: '工单变更按当前价表确认',
  REWORK_ORDER_CREATED_NO_CHARGE: '返工单免收费',
  ADMIN_MANUAL_CHARGE: '管理员调整附加费用',
  ADMIN_MANUAL_CHARGE_REMOVED: '管理员删除附加费用',
  ORDER_ITEM_PLATE_DETAIL: '管理员调整制版费用',
  ORDER_ITEM_PLATE_DETAIL_REMOVED: '管理员删除制版费用',
  LEGACY_BACKFILL: '历史价格回填',
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
