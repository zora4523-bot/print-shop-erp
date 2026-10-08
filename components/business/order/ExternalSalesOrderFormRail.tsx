export type * from './order-create-fee-types';
import type {
  OrderFormBRailProps,
  OrderFormBRailQuoteItem,
  OrderFormBRailLogistics,
  ExternalSalesPackagingQuote,
  OrderFormBQuoteStatus,
} from './order-create-fee-types';
import { useId } from 'react';
import Decimal from 'decimal.js';
import { Badge } from '@/components/ui/badge';
import { ActionNotice } from '@/components/ui-business';
import { OrderCreateFeeDetails } from './OrderCreateFeeDetails';
import { orderCreateFeeSummary } from './order-create-fee-summary';
import { formatMoney } from '@/lib/dashboard/format';
import { Button } from '@/components/ui/button';

function decimalAmount(value: string | null | undefined): Decimal | null {
  if (value === null || value === undefined || value.trim() === '') return null;
  try {
    const amount = new Decimal(value);
    return amount.isFinite() && !amount.isNegative() ? amount : null;
  } catch {
    return null;
  }
}

function numericAmount(value: string | null | undefined): number | null {
  return decimalAmount(value)?.toNumber() ?? null;
}

function roundedCurrencyNumber(value: Decimal): number {
  return value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
}

function isManualQuoteStatus(status: OrderFormBQuoteStatus): boolean {
  return status === 'incomplete' || status === 'error';
}

function internalOrderFormTotal(
  quoteItems: readonly OrderFormBRailQuoteItem[],
): number | null {
  if (
    quoteItems.some(
      (item) =>
        item.status !== 'complete' || decimalAmount(item.amount) === null,
    )
  ) {
    return null;
  }

  return roundedCurrencyNumber(
    quoteItems.reduce(
      (sum, item) => sum.plus(decimalAmount(item.amount) ?? 0),
      new Decimal(0),
    ),
  );
}

export function externalSalesOrderFormTotal(args: {
  quoteItems: readonly OrderFormBRailQuoteItem[];
  packaging: ExternalSalesPackagingQuote;
  logistics: OrderFormBRailLogistics | null;
  knownTotal?: string | null;
}): number | null {
  const serverKnownTotal = decimalAmount(args.knownTotal);
  if (serverKnownTotal) return roundedCurrencyNumber(serverKnownTotal);

  if (
    args.quoteItems.some(
      (item) =>
        (!isManualQuoteStatus(item.status) && item.status !== 'complete') ||
        (item.status === 'complete' && decimalAmount(item.amount) === null),
    ) ||
    (!isManualQuoteStatus(args.packaging.status) &&
      args.packaging.status !== 'complete') ||
    (args.packaging.status === 'complete' &&
      decimalAmount(args.packaging.amount) === null) ||
    !args.logistics ||
    decimalAmount(args.logistics.packagingAmount) === null ||
    (args.logistics.status === 'complete' &&
      decimalAmount(args.logistics.shippingAmount) === null)
  ) {
    return null;
  }

  const knownAmounts = [
    ...args.quoteItems.flatMap((item) =>
      item.status === 'complete' ? [decimalAmount(item.amount)] : [],
    ),
    ...(args.packaging.status === 'complete'
      ? [decimalAmount(args.packaging.amount)]
      : []),
    decimalAmount(args.logistics.packagingAmount),
    decimalAmount(args.logistics.shippingAmount),
  ].filter((amount): amount is Decimal => amount !== null);

  return roundedCurrencyNumber(
    knownAmounts.reduce((sum, amount) => sum.plus(amount), new Decimal(0)),
  );
}

export function OrderFormBRail(props: OrderFormBRailProps) {
  const {
    itemCount,
    quoteItems,
    packaging,
    logistics,
    usesExternalSalesPricing,
    settlementLabel,
    knownTotal,
    gaps,
    busy,
    onAttemptSubmit,
    onGapClick,
  } = props;
  const headingId = useId();
  const summary = orderCreateFeeSummary(props);
  const total = usesExternalSalesPricing
    ? externalSalesOrderFormTotal({
        quoteItems,
        packaging,
        logistics,
        knownTotal,
      })
    : (numericAmount(knownTotal) ?? internalOrderFormTotal(quoteItems));
  return (
    <div className="space-y-3">
      <section
        aria-labelledby={headingId}
        className="rounded-xl border bg-card p-4"
      >
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id={headingId} className="text-sm font-semibold">
              费用明细
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">{itemCount} 条规格明细</p>
          </div>
          <Badge variant="outline" className="h-auto max-w-full whitespace-normal">{settlementLabel}</Badge>
        </div>
        <OrderCreateFeeDetails {...props} />
        <div className="mt-3 border-t-2 border-foreground pt-3">
          <p className="text-xs font-semibold text-muted-foreground">
            {summary.excludedLabels.length ? '已知合计' : '当前合计'}
          </p>
          <p className="mt-1 text-3xl font-bold tracking-tight tabular-nums">
            {total === null ? '——' : formatMoney(total)}
          </p>
          {summary.totalNote ? (
            <p className="mt-2 text-xs text-muted-foreground">
              {summary.totalNote}
            </p>
          ) : null}
        </div>
        {summary.messages.length ? (
          <ActionNotice
            className="mt-4"
            tone={summary.hasError ? 'error' : 'primary'}
            title={summary.hasError ? '请核对费用后重试' : '待工厂核价'}
            description={
              <ul className="list-disc space-y-1 pl-4 text-xs">
                {summary.messages.map(({ key, message }) => (
                  <li key={key}>{message}</li>
                ))}
              </ul>
            }
          />
        ) : null}
        {(props.allowSaveDraft ?? !usesExternalSalesPricing) ? (
          <Button
            type="submit"
            name="creationIntent"
            value="draft"
            variant="outline"
            className="mt-4 min-h-11 w-full"
            disabled={busy}
            onClick={() => onAttemptSubmit('draft')}
          >
            {busy ? '正在处理…' : '保存草稿'}
          </Button>
        ) : null}
        {props.allowEditFees ? <Button type="submit" name="creationIntent" value="fees" variant="outline" className="mt-3 min-h-11 w-full" disabled={busy} onClick={() => onAttemptSubmit('submit')}>创建并编辑收费</Button> : null}
        <Button
          type="submit"
          name="creationIntent"
          value="submit"
          className="mt-3 min-h-12 w-full"
          disabled={busy}
          onClick={() => onAttemptSubmit('submit')}
        >
          {busy ? '正在处理…' : '创建并提交'}
        </Button>
      </section>
      {gaps.length ? (
        <section
          aria-label="待补信息"
          className="rounded-xl border bg-card p-4"
        >
          <h2 className="text-sm font-semibold">
            待补信息 <Badge variant="secondary">{gaps.length}</Badge>
          </h2>
          <ul className="mt-2 space-y-1 text-sm">
            {gaps.map((gap, index) => (
              <li key={`${gap}-${index}`}>
                {onGapClick ? (
                  <Button
                    type="button"
                    variant="link"
                    className="h-auto min-h-11 w-full justify-start whitespace-normal px-0 text-left"
                    onClick={() => onGapClick(index)}
                  >
                    {gap}
                  </Button>
                ) : (
                  gap
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
