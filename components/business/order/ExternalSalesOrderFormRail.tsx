import Decimal from 'decimal.js';
import { Button } from '@/components/ui/button';

export type OrderFormBQuoteStatus =
  | 'missing'
  | 'loading'
  | 'stale'
  | 'error'
  | 'incomplete'
  | 'complete';

export type OrderFormBRailQuoteItem = {
  key: string;
  label: string;
  status: OrderFormBQuoteStatus;
  amount: string | null;
  components: Array<{ label: string; amount: string }>;
  message?: string | null;
};

export type OrderFormBRailLogistics = {
  status: OrderFormBQuoteStatus;
  shippingAmount: string | null;
  packagingAmount: string | null;
  totalAmount: string | null;
  shippingLabel?: string;
  packagingLabel?: string;
  message?: string | null;
};

export type ExternalSalesPackagingQuote = {
  status: OrderFormBQuoteStatus;
  amount: string | null;
  label?: string;
  message?: string | null;
};

export type OrderFormBRailPlateFee = {
  status: 'PENDING';
  amount: null;
  displayAmount: '待定';
  label: string;
};

export type OrderFormBRailTotalSemantics =
  | 'COMPLETE'
  | 'EXCLUDES_MANUAL_ITEMS';

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
      (item) => item.status !== 'complete' || decimalAmount(item.amount) === null,
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

function InternalOrderFormRail({
  itemCount, quoteItems, knownTotal, totalSemantics, plateFee,
  settlementLabel, gaps, busy, onAttemptSubmit,
}: Pick<Parameters<typeof OrderFormBRail>[0],
  'itemCount' | 'quoteItems' | 'knownTotal' | 'totalSemantics' | 'plateFee' |
  'settlementLabel' | 'gaps' | 'busy' | 'onAttemptSubmit'
>) {
  const serverKnownTotal = decimalAmount(knownTotal);
  const total = serverKnownTotal
    ? roundedCurrencyNumber(serverKnownTotal)
    : internalOrderFormTotal(quoteItems);
  const requiresFactoryPricing =
    totalSemantics === 'EXCLUDES_MANUAL_ITEMS';
  return (
    <div className="space-y-3">
      <section className="rounded-[14px] border bg-card p-[18px]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-[11px] font-bold tracking-[0.18em] text-muted-foreground">
              费用明细
            </h2>
            <p className="mt-1 text-[11px] font-semibold text-muted-foreground">
              {itemCount} 款
            </p>
          </div>
          <span className="rounded-full border px-2 py-1 text-[11px] font-semibold text-muted-foreground">
            {settlementLabel}
          </span>
        </div>

        <div className="mt-3" aria-live="polite">
          {quoteItems.map((item, index) => (
            <div
              key={item.key}
              className="flex items-start justify-between gap-3 border-b py-2 text-[13px]"
            >
              <span className="min-w-0 font-semibold text-muted-foreground">
                {itemCount > 1 ? `${index + 1}· ` : ''}
                {item.label}
              </span>
              <b
                className={
                  item.status === 'complete' && item.amount
                    ? 'shrink-0 tabular-nums'
                    : 'shrink-0 text-destructive'
                }
              >
                {item.status === 'complete' && item.amount
                  ? money(item.amount)
                  : STATUS_LABELS[item.status]}
              </b>
            </div>
          ))}
        </div>

        <div className="mt-3 border-t-2 border-foreground pt-3">
          <p className="text-[11px] font-semibold text-muted-foreground">
            {requiresFactoryPricing ? '已知合计' : '当前合计'}
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
            {requiresFactoryPricing
              ? plateFee
                ? '不含待核价款与制版费；提交后由工厂确认'
                : '不含待核价款；提交后由工厂确认'
              : '提交时服务端会重新核价'}
          </p>
        </div>

        <Button
          type="submit"
          name="creationIntent"
          value="draft"
          variant="outline"
          className="mt-4 min-h-11 w-full text-sm font-extrabold"
          disabled={busy}
          onClick={() => onAttemptSubmit('draft')}
        >
          {busy ? '处理中…' : '保存草稿'}
        </Button>
        <Button
          type="submit"
          name="creationIntent"
          value="submit"
          className="mt-2 min-h-12 w-full bg-foreground text-sm font-extrabold text-background hover:bg-foreground/90"
          disabled={busy || gaps.length > 0}
          onClick={() => onAttemptSubmit('submit')}
        >
          {busy
            ? '处理中…'
            : requiresFactoryPricing
              ? '创建并提交核价'
              : '创建并提交'}
        </Button>
      </section>

      <section className="rounded-[14px] border bg-card p-[18px]">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-extrabold">待补信息</h2>
          <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs tabular-nums text-destructive">
            {gaps.length}
          </span>
        </div>
        {gaps.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            必填信息已完整。
          </p>
        ) : (
          <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-destructive">
            {gaps.map((gap, index) => (
              <li key={`${gap}-${index}`}>{gap}</li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export function OrderFormBRail({
  itemCount,
  quoteItems,
  packaging,
  logistics,
  usesExternalSalesPricing,
  settlementLabel,
  knownTotal,
  totalSemantics,
  plateFee,
  gaps,
  busy,
  onAttemptSubmit,
}: {
  itemCount: number;
  quoteItems: readonly OrderFormBRailQuoteItem[];
  packaging: ExternalSalesPackagingQuote;
  logistics: OrderFormBRailLogistics | null;
  usesExternalSalesPricing: boolean;
  settlementLabel: string;
  knownTotal?: string | null;
  totalSemantics?: OrderFormBRailTotalSemantics;
  plateFee?: OrderFormBRailPlateFee | null;
  gaps: readonly string[];
  busy: boolean;
  onAttemptSubmit: (intent: 'draft' | 'submit') => void;
}) {
  if (!usesExternalSalesPricing) {
    return (
      <InternalOrderFormRail
        itemCount={itemCount}
        quoteItems={quoteItems}
        knownTotal={knownTotal}
        totalSemantics={totalSemantics}
        plateFee={plateFee}
        settlementLabel={settlementLabel}
        gaps={gaps}
        busy={busy}
        onAttemptSubmit={onAttemptSubmit}
      />
    );
  }

  const total = externalSalesOrderFormTotal({
    quoteItems,
    packaging,
    logistics,
    knownTotal,
  });
  const excludesManualItems = totalSemantics === 'EXCLUDES_MANUAL_ITEMS';
  const hasNonPlateManualPricing =
    quoteItems.some(
      (item) => item.status === 'incomplete' || item.status === 'error',
    ) ||
    packaging.status === 'incomplete' ||
    packaging.status === 'error' ||
    (excludesManualItems && !plateFee);
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
    ...(plateFee ? [`${plateFee.label}金额待工厂确认`] : []),
  ];
  const needsAdminPrice = manualMessages.length > 0;
  const excludedLabels = [
    ...(hasNonPlateManualPricing ? ['待核价款'] : []),
    ...(plateFee ? ['制版费'] : []),
    ...(logistics?.status === 'complete' ? [] : ['快递费']),
  ];
  const hasExcludedAmounts = excludedLabels.length > 0;
  const totalNote =
    hasExcludedAmounts
      ? `不含${excludedLabels.join('、')}`
      : '当前已知费用已完整';

  return (
    <section
      aria-labelledby="external-order-fee-heading"
      className={
        needsAdminPrice
          ? 'rounded-[14px] border border-destructive bg-destructive/5 p-[18px]'
          : 'rounded-[14px] border bg-card p-[18px]'
      }
    >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2
              id="external-order-fee-heading"
              className="text-[11px] font-bold tracking-[0.18em] text-muted-foreground"
            >
              费用明细
            </h2>
            <p className="mt-1 text-[11px] font-semibold text-muted-foreground">
              {itemCount} 款
            </p>
          </div>
          <span className="rounded-full border px-2 py-1 text-[11px] font-semibold text-muted-foreground">
            {settlementLabel}
          </span>
        </div>

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
          {plateFee ? (
            <div className="flex justify-between gap-3 border-b py-2 text-[13px]">
              <span className="font-semibold text-muted-foreground">
                {plateFee.label}
              </span>
              <b className="text-destructive">{plateFee.displayAmount}</b>
            </div>
          ) : null}
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
            {hasExcludedAmounts ? '已知合计' : '当前合计'}
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
            {totalNote}
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
          onClick={() => onAttemptSubmit('submit')}
        >
          {busy
            ? '处理中…'
            : needsAdminPrice
              ? '提交并申请管理员终价'
              : '创建并提交'}
        </Button>
    </section>
  );
}
