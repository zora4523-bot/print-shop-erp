import type {
  ExternalSalesPackagingQuote,
  OrderFormBRailProps,
} from './order-create-fee-types';

export const ORDER_FORM_QUOTE_STATUS_LABELS: Record<
  ExternalSalesPackagingQuote['status'],
  string
> = {
  missing: '待核价',
  loading: '正在核价…',
  stale: '待重新核价',
  error: '核价失败',
  incomplete: '待工厂核价',
  complete: '已核价',
};

type SummaryInput = Pick<
  OrderFormBRailProps,
  | 'quoteItems'
  | 'packaging'
  | 'logistics'
  | 'plateFee'
  | 'totalSemantics'
  | 'usesExternalSalesPricing'
>;

export function orderCreateFeeSummary(input: SummaryInput) {
  const { quoteItems, packaging, plateFee, totalSemantics } = input;
  // Every billing settlement quotes delivery from the published logistics
  // book since 2026-09-18, so the summary reads logistics for internal orders too.
  const logistics = input.logistics;
  const pending = (status: string) =>
    status === 'incomplete' || status === 'error';
  const candidates = [
    ...quoteItems.flatMap((item, index) =>
      pending(item.status)
        ? [
            {
              key: `item:${item.key}`,
              message: `第 ${index + 1} 款：${item.message || '请核对款式价格'}`,
            },
          ]
        : [],
    ),
    ...(pending(packaging.status)
      ? [{ key: 'packaging', message: packaging.message || '请核对包装价格' }]
      : []),
    ...(logistics && pending(logistics.status)
      ? [{ key: 'logistics', message: logistics.message || '请核对物流费用' }]
      : []),
    ...(plateFee
      ? [{ key: 'plate-fee', message: `${plateFee.label}金额待工厂确认` }]
      : []),
  ];
  const messages = candidates
    .filter(
      (entry, index, all) =>
        all.findIndex((candidate) => candidate.message === entry.message) ===
        index,
    )
    .map((entry) => ({
      ...entry,
      key: entry.key.startsWith('item:')
        ? entry.key
        : `shared:${entry.message}`,
    }));
  const excludedLabels = [
    ...(quoteItems.some((item) => pending(item.status)) ? ['待核价款'] : []),
    ...(pending(packaging.status) ? ['待核包装费'] : []),
    ...(plateFee ? ['制版费'] : []),
    ...(logistics?.packagingAmount == null ? ['待核纸箱费'] : []),
    ...(logistics?.shippingAmount == null ? ['快递费'] : []),
  ];
  if (totalSemantics === 'EXCLUDES_MANUAL_ITEMS' && excludedLabels.length === 0)
    excludedLabels.push('待核费用');
  return {
    messages,
    excludedLabels,
    hasError:
      quoteItems.some((item) => item.status === 'error') ||
      packaging.status === 'error' ||
      logistics?.status === 'error',
    totalNote: excludedLabels.length
      ? `不含${excludedLabels.join('、')}`
      : null,
  };
}
