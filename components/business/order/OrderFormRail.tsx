import { Button } from '@/components/ui/button';
import type { OrderFormGap, OrderFormQuoteStatus } from './order-form-gaps';

export type OrderFormRailQuoteItem = {
  key: string;
  label: string;
  status: OrderFormQuoteStatus;
  amount: string | null;
  components: Array<{ label: string; amount: string }>;
  message?: string | null;
};

export type OrderFormRailLogistics = {
  status: OrderFormQuoteStatus;
  shippingAmount: string | null;
  packagingAmount: string | null;
  totalAmount: string | null;
  shippingLabel?: string;
  packagingLabel?: string;
  message?: string | null;
};

const GAP_SECTION_LABELS: Record<OrderFormGap['step'], string> = {
  customer: '工单',
  items: '款式',
  shipping: '收货',
};

const QUOTE_STATUS_LABELS: Record<OrderFormQuoteStatus, string> = {
  missing: '待核价',
  loading: '核价中…',
  stale: '待重新核价',
  error: '核价失败',
  incomplete: '待管理员终价',
  complete: '已核价',
};

function money(value: number): string {
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'CNY',
    minimumFractionDigits: 2,
  }).format(value);
}

export function sumServerQuoteAmounts(values: readonly string[]): number {
  return (
    values.reduce((total, value) => {
      const amount = Number(value);
      return Number.isFinite(amount) ? total + Math.round(amount * 100) : total;
    }, 0) / 100
  );
}

export function OrderFormRail({
  itemCount,
  totalQuantity,
  settlementLabel,
  quoteItems,
  logistics,
  usesExternalSalesPricing,
  gaps,
  onJump,
}: {
  itemCount: number;
  totalQuantity: number;
  settlementLabel: string;
  quoteItems: readonly OrderFormRailQuoteItem[];
  logistics: OrderFormRailLogistics | null;
  usesExternalSalesPricing: boolean;
  gaps: readonly OrderFormGap[];
  onJump: (gap: OrderFormGap) => void;
}) {
  const completeItems = quoteItems.every(
    (item) => item.status === 'complete' && item.amount !== null,
  );
  const completeLogistics =
    !usesExternalSalesPricing ||
    (logistics?.status === 'complete' && logistics.totalAmount !== null);
  const hasCompleteTotal = completeItems && completeLogistics;
  const total = hasCompleteTotal
    ? sumServerQuoteAmounts([
        ...quoteItems.flatMap((item) => (item.amount ? [item.amount] : [])),
        ...(logistics?.totalAmount ? [logistics.totalAmount] : []),
      ])
    : null;

  return (
    <aside className="mt-4 min-w-0 space-y-3 lg:sticky lg:top-20 lg:mt-0 lg:max-h-[calc(100dvh-6rem)] lg:self-start lg:overflow-y-auto lg:overscroll-contain lg:pr-1">
      <section
        aria-labelledby="order-fee-rail-heading"
        className="rounded-xl border bg-card p-4 shadow-sm"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="order-fee-rail-heading" className="text-sm font-semibold">
              费用明细
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {itemCount} 款 · {totalQuantity.toLocaleString()} 个
            </p>
          </div>
          <span className="rounded-full border px-2 py-1 text-[11px] text-muted-foreground">
            {settlementLabel}
          </span>
        </div>

        <div className="mt-4 space-y-3" aria-live="polite">
          {quoteItems.map((item, index) => (
            <div
              key={item.key}
              className="border-b pb-3 last:border-b-0 last:pb-0"
            >
              <div className="flex items-start justify-between gap-3 text-sm">
                <span className="min-w-0 font-medium">
                  {index + 1}. {item.label}
                </span>
                <span
                  className={
                    item.status === 'complete'
                      ? 'shrink-0 font-semibold tabular-nums'
                      : 'shrink-0 text-xs font-medium text-destructive'
                  }
                >
                  {item.status === 'complete' && item.amount
                    ? money(Number(item.amount))
                    : QUOTE_STATUS_LABELS[item.status]}
                </span>
              </div>
              {item.status === 'complete' && item.components.length > 0 ? (
                <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                  {item.components.map((component, componentIndex) => (
                    <li
                      key={`${item.key}-${component.label}-${componentIndex}`}
                      className="flex justify-between gap-2"
                    >
                      <span className="min-w-0 break-words">
                        {component.label}
                      </span>
                      <span className="shrink-0 tabular-nums">
                        {money(Number(component.amount))}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : item.message ? (
                <p className="mt-1 break-words text-xs text-muted-foreground">
                  {item.message}
                </p>
              ) : null}
            </div>
          ))}

          {usesExternalSalesPricing ? (
            <div className="space-y-1 border-t pt-3 text-sm">
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">快递费</span>
                <span className="font-medium tabular-nums">
                  {logistics?.status === 'complete' && logistics.shippingAmount
                    ? money(Number(logistics.shippingAmount))
                    : QUOTE_STATUS_LABELS[logistics?.status ?? 'missing']}
                </span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">纸箱费</span>
                <span className="font-medium tabular-nums">
                  {logistics?.status === 'complete' && logistics.packagingAmount
                    ? money(Number(logistics.packagingAmount))
                    : QUOTE_STATUS_LABELS[logistics?.status ?? 'missing']}
                </span>
              </div>
              {logistics?.message ? (
                <p className="pt-1 text-xs text-muted-foreground">
                  {logistics.message}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="mt-4 border-t border-foreground pt-4">
          <p className="text-xs text-muted-foreground">当前合计</p>
          <p
            className={
              total === null
                ? 'mt-1 text-sm font-semibold text-destructive'
                : 'mt-1 text-3xl font-bold tracking-tight tabular-nums'
            }
          >
            {total === null
              ? usesExternalSalesPricing
                ? '待管理员终价'
                : '待完成核价'
              : money(total)}
          </p>
        </div>
        <p className="mt-3 text-[11px] text-muted-foreground">
          提交时服务端会重新核价。
        </p>
      </section>

      <section className="hidden rounded-xl border border-destructive/30 bg-card p-3 shadow-sm lg:block">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">待补信息</h2>
          <span className="rounded-full bg-destructive/10 px-2 py-0.5 font-sans text-xs tabular-nums text-destructive">
            {gaps.length}
          </span>
        </div>
        {gaps.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">必填信息已完整。</p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {gaps.map((gap) => (
              <li key={gap.id}>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onJump(gap)}
                  className="h-auto min-h-11 w-full min-w-0 items-start justify-start gap-2 whitespace-normal rounded-lg px-2 py-1.5 text-left text-xs"
                >
                  <span className="shrink-0 text-muted-foreground">
                    {GAP_SECTION_LABELS[gap.step]}
                  </span>
                  <span>{gap.label}</span>
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </aside>
  );
}
