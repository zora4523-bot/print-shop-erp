import { Badge } from '@/components/ui/badge';
import { formatMoney } from '@/lib/dashboard/format';
import { cn } from '@/lib/utils';
import type {
  OrderFormBRailProps,
  OrderFormBQuoteStatus,
} from './order-create-fee-types';
import { ORDER_FORM_QUOTE_STATUS_LABELS } from './order-create-fee-summary';

function FeeRow({
  label,
  amount,
  status = 'complete',
  source,
  detail = false,
}: {
  label: string;
  amount: string | null;
  status?: OrderFormBQuoteStatus;
  source?: 'AUTO' | 'ADMIN' | 'MIXED';
  detail?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex items-start justify-between gap-3 py-2',
        detail && 'pl-3 text-xs',
      )}
    >
      <dt className="min-w-0 break-words text-muted-foreground">{label}</dt>
      <dd className="flex shrink-0 flex-wrap items-center justify-end gap-1.5 text-right tabular-nums">
        {status === 'complete' && amount !== null ? (
          <>
            <span className={cn(!detail && 'font-semibold')}>
              {formatMoney(amount)}
            </span>
            {source ? (
              <Badge variant="outline">
                {source === 'ADMIN'
                  ? '人工价'
                  : source === 'MIXED'
                    ? '含人工价'
                    : '估'}
              </Badge>
            ) : null}
          </>
        ) : (
          <span
            className={cn(
              status === 'error' ? 'text-destructive' : 'text-muted-foreground',
            )}
          >
            {ORDER_FORM_QUOTE_STATUS_LABELS[status]}
          </span>
        )}
      </dd>
    </div>
  );
}

export function OrderCreateFeeDetails({
  quoteItems,
  packaging,
  plateFee,
  logistics,
  usesExternalSalesPricing,
}: Pick<
  OrderFormBRailProps,
  | 'quoteItems'
  | 'packaging'
  | 'plateFee'
  | 'logistics'
  | 'usesExternalSalesPricing'
>) {
  return (
    <div className="divide-y text-sm">
      {quoteItems.map((item, index) => (
        <dl key={item.key}>
          <FeeRow
            label={`${quoteItems.length > 1 ? `${index + 1}· ` : ''}${item.label}`}
            status={item.status}
            amount={item.amount}
            source={item.pricingSource ?? 'AUTO'}
          />
          {item.status === 'complete' && item.pricingSource !== 'ADMIN'
            ? item.components.map((line, i) => (
                <FeeRow
                  key={`${line.label}-${i}`}
                  label={line.label}
                  amount={line.amount}
                  detail
                />
              ))
            : null}
        </dl>
      ))}
      <dl className="divide-y">
        <FeeRow
          label={packaging.label ?? '包装费'}
          amount={packaging.amount}
          status={packaging.status}
          source={packaging.pricingSource ?? 'AUTO'}
        />
        {plateFee ? (
          <FeeRow label={plateFee.label} amount={null} status="incomplete" />
        ) : null}
        {usesExternalSalesPricing ? (
          <>
            <FeeRow
              label={logistics?.packagingLabel ?? '纸箱耗材'}
              amount={logistics?.packagingAmount ?? null}
              status={
                logistics?.packagingAmount != null
                  ? 'complete'
                  : (logistics?.status ?? 'missing')
              }
              source="AUTO"
            />
            <FeeRow
              label={logistics?.shippingLabel ?? '快递费'}
              amount={logistics?.shippingAmount ?? null}
              status={
                logistics?.shippingAmount != null
                  ? 'complete'
                  : (logistics?.status ?? 'missing')
              }
              source="AUTO"
            />
          </>
        ) : null}
      </dl>
    </div>
  );
}
