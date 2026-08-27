import { Button } from '@/components/ui/button';
import type {
  OrderFormRailLogistics,
  OrderFormRailQuoteItem,
} from './OrderFormRail';

export type ExternalSalesPackagingQuote = {
  status: 'missing' | 'loading' | 'stale' | 'error' | 'incomplete' | 'complete';
  amount: string | null;
  label?: string;
  message?: string | null;
};

const STATUS_LABELS: Record<
  ExternalSalesPackagingQuote['status'],
  string
> = {
  missing: '待核价',
  loading: '核价中…',
  stale: '待重新核价',
  error: '核价失败',
  incomplete: '待管理员终价',
  complete: '已核价',
};

function money(value: string | number): string {
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'CNY',
    minimumFractionDigits: 2,
  }).format(Number(value));
}

function numericAmount(value: string | null | undefined): number | null {
  if (value === null || value === undefined || value.trim() === '') return null;
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : null;
}

export function externalSalesOrderFormTotal(args: {
  quoteItems: readonly OrderFormRailQuoteItem[];
  packaging: ExternalSalesPackagingQuote;
  logistics: OrderFormRailLogistics | null;
}): number | null {
  if (
    args.quoteItems.some(
      (item) => item.status !== 'complete' || numericAmount(item.amount) === null,
    ) ||
    args.packaging.status !== 'complete' ||
    numericAmount(args.packaging.amount) === null ||
    !args.logistics ||
    numericAmount(args.logistics.packagingAmount) === null
  ) {
    return null;
  }

  return [
    ...args.quoteItems.map((item) => numericAmount(item.amount) ?? 0),
    numericAmount(args.packaging.amount) ?? 0,
    numericAmount(args.logistics.packagingAmount) ?? 0,
    numericAmount(args.logistics.shippingAmount) ?? 0,
  ].reduce((sum, amount) => sum + Math.round(amount * 100), 0) / 100;
}

export function ExternalSalesOrderFormRail({
  itemCount,
  quoteItems,
  packaging,
  logistics,
  busy,
  onAttemptSubmit,
}: {
  itemCount: number;
  quoteItems: readonly OrderFormRailQuoteItem[];
  packaging: ExternalSalesPackagingQuote;
  logistics: OrderFormRailLogistics | null;
  busy: boolean;
  onAttemptSubmit: () => void;
}) {
  const total = externalSalesOrderFormTotal({
    quoteItems,
    packaging,
    logistics,
  });
  const manualMessages = [
    ...quoteItems.flatMap((item, index) =>
      item.status === 'incomplete' || item.status === 'error'
        ? [`第 ${index + 1} 款：${item.message || STATUS_LABELS[item.status]}`]
        : [],
    ),
    ...(packaging.status === 'incomplete' || packaging.status === 'error'
      ? [packaging.message || STATUS_LABELS[packaging.status]]
      : []),
    ...(logistics?.status === 'incomplete' || logistics?.status === 'error'
      ? [logistics.message || STATUS_LABELS[logistics.status]]
      : []),
  ];
  const needsAdminPrice = manualMessages.length > 0;

  return (
    <section
      aria-labelledby="external-order-fee-heading"
      className={
        needsAdminPrice
          ? 'rounded-[14px] border border-destructive bg-destructive/5 p-[18px]'
          : 'rounded-[14px] border bg-card p-[18px]'
      }
    >
        <h2
          id="external-order-fee-heading"
          className="mb-3 text-[11px] font-bold tracking-[0.18em] text-muted-foreground"
        >
          费用明细
        </h2>

        <div aria-live="polite">
          {quoteItems.map((item, index) => {
            if (item.status !== 'complete' || !item.amount) {
              return (
                <div
                  key={item.key}
                  className="flex items-start justify-between gap-3 border-b py-2 text-[13px]"
                >
                  <span className="min-w-0 font-semibold text-muted-foreground">
                    {itemCount > 1 ? `${index + 1}· ` : ''}
                    {item.label}
                  </span>
                  <b className="shrink-0 text-destructive">
                    {STATUS_LABELS[item.status]}
                  </b>
                </div>
              );
            }

            const lines =
              item.components.length > 0
                ? item.components
                : [{ label: item.label, amount: item.amount }];
            return lines.map((line, lineIndex) => (
              <div
                key={`${item.key}-${line.label}-${lineIndex}`}
                className="flex items-start justify-between gap-3 border-b py-2 text-[13px]"
              >
                <span className="min-w-0 font-semibold text-muted-foreground">
                  {itemCount > 1 ? `${index + 1}· ` : ''}
                  {line.label}
                </span>
                <b className="shrink-0 tabular-nums">{money(line.amount)}</b>
              </div>
            ));
          })}

          <div className="flex justify-between gap-3 border-b py-2 text-[13px]">
            <span className="font-semibold text-muted-foreground">
              {packaging.label ?? '入袋'}
            </span>
            <b
              className={
                packaging.status === 'complete'
                  ? 'tabular-nums'
                  : 'text-destructive'
              }
            >
              {packaging.status === 'complete' && packaging.amount
                ? money(packaging.amount)
                : STATUS_LABELS[packaging.status]}
            </b>
          </div>
          <div className="flex justify-between gap-3 border-b py-2 text-[13px]">
            <span className="font-semibold text-muted-foreground">制烫金版费</span>
            <b className="text-destructive">待定</b>
          </div>
          <div className="flex justify-between gap-3 border-b py-2 text-[13px]">
            <span className="font-semibold text-muted-foreground">
              {logistics?.packagingLabel ?? '纸箱耗材'}
            </span>
            <b
              className={
                numericAmount(logistics?.packagingAmount) !== null
                  ? 'tabular-nums'
                  : 'text-destructive'
              }
            >
              {numericAmount(logistics?.packagingAmount) !== null &&
              logistics?.packagingAmount
                ? money(logistics.packagingAmount)
                : STATUS_LABELS[logistics?.status ?? 'missing']}
            </b>
          </div>
          <div className="flex justify-between gap-3 border-b py-2 text-[13px]">
            <span className="font-semibold text-muted-foreground">
              {logistics?.shippingLabel ?? '快递费'}
            </span>
            <b
              className={
                numericAmount(logistics?.shippingAmount) !== null
                  ? 'tabular-nums'
                  : 'text-destructive'
              }
            >
              {numericAmount(logistics?.shippingAmount) !== null &&
              logistics?.shippingAmount
                ? money(logistics.shippingAmount)
                : STATUS_LABELS[logistics?.status ?? 'missing']}
            </b>
          </div>
        </div>

        <div className="mt-3 border-t-2 border-foreground pt-3">
          <p className="text-[11px] font-semibold text-muted-foreground">
            当前合计
          </p>
          <p
            className={
              total === null
                ? 'mt-1 text-2xl font-extrabold text-destructive'
                : 'mt-1 text-[34px] font-extrabold leading-none tracking-tight tabular-nums'
            }
          >
            {total === null ? '——' : money(total)}
          </p>
          <p className="mt-1 text-[11px] font-semibold text-muted-foreground">
            {logistics?.status === 'complete'
              ? '不含制版费'
              : '不含制版费与快递费'}
          </p>
        </div>

        {needsAdminPrice ? (
          <div className="mt-3 border-l-[3px] border-destructive pl-3 text-destructive">
            <p className="text-sm font-extrabold">这张单需要管理员终价</p>
            <ul className="mt-1 list-disc space-y-1 pl-4 text-xs">
              {manualMessages.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <Button
          type="submit"
          name="creationIntent"
          value="submit"
          className={
            needsAdminPrice
              ? 'mt-4 min-h-12 w-full bg-destructive text-sm font-extrabold hover:bg-destructive/90'
              : 'mt-4 min-h-12 w-full bg-foreground text-sm font-extrabold text-background hover:bg-foreground/90'
          }
          disabled={busy}
          onClick={onAttemptSubmit}
        >
          {busy
            ? '处理中…'
            : needsAdminPrice
              ? '提交并申请管理员终价'
              : '提交工单'}
        </Button>
    </section>
  );
}
