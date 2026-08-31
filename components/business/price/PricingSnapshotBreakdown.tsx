import Decimal from 'decimal.js';
import { formatMoney } from '@/lib/dashboard/format';
import { formatUnitPrice } from '@/lib/format/unit-price';
import { externalPriceRuleDisplayName } from '@/lib/price/external-price-display';
import { cn } from '@/lib/utils';

export type ParsedPricingSnapshotComponent = {
  source: string | null;
  sourceId: string | null;
  name: string;
  adjustmentType: string | null;
  rate: string | null;
  units: string | null;
  amount: string;
  categoryName: string | null;
  categoryCode: string | null;
  ruleCode: string | null;
  sourceSheet: string | null;
  sourceRange: string | null;
};

export type ParsedPricingSnapshotSummary = {
  suggestedSubtotal: string | null;
  actualSubtotal: string | null;
  overrideReason: string | null;
};

type PricingSnapshotBreakdownProps = {
  pricingSnapshot: unknown;
  title?: string;
  className?: string;
};

const MAX_COMPONENT_AMOUNT = new Decimal('9999999999.99');
const MAX_COMPONENT_RATE = new Decimal('999999.9999');
const MAX_COMPONENT_UNITS = new Decimal('9999999999');

const ADJUSTMENT_TYPE_LABELS: Record<string, string> = {
  PER_SHEET: '按张',
  PER_PIECE: '按个',
  PER_ORDER: '每款一次',
  PER_10K: '每万个',
  FIXED_AMOUNT: '固定金额',
};

const UNIT_LABELS: Record<string, string> = {
  PER_SHEET: '张',
  PER_PIECE: '个',
  PER_ORDER: '次',
  PER_10K: '万个',
  FIXED_AMOUNT: '项',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function optionalText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized || null;
}

function decimalText(value: unknown, max: Decimal): string | null {
  if (
    (typeof value !== 'string' && typeof value !== 'number') ||
    (typeof value === 'number' && !Number.isFinite(value))
  ) {
    return null;
  }

  const raw = String(value).trim();
  // Stored quote values are short fixed-point decimals. A length guard keeps
  // a malformed JSON snapshot from forcing an enormous Decimal allocation.
  if (!raw || raw.length > 64) return null;

  try {
    const parsed = new Decimal(raw);
    if (!parsed.isFinite() || parsed.abs().gt(max)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

/**
 * Treats the persisted JSON snapshot as untrusted historical data. Invalid
 * envelopes and invalid component rows fail closed instead of throwing while
 * an otherwise valid snapshot can still render its remaining rows.
 */
export function parsePricingSnapshotComponents(
  pricingSnapshot: unknown,
): ParsedPricingSnapshotComponent[] {
  if (
    !isRecord(pricingSnapshot) ||
    !Array.isArray(pricingSnapshot.components)
  ) {
    return [];
  }

  return pricingSnapshot.components.flatMap((candidate, index) => {
    if (!isRecord(candidate)) return [];

    const amount = decimalText(candidate.amount, MAX_COMPONENT_AMOUNT);
    if (amount === null) return [];

    const source = optionalText(candidate.source);
    const categoryName = optionalText(candidate.categoryName);
    const persistedName = optionalText(candidate.name);
    const fallbackName =
      categoryName ??
      (source === 'BASE'
        ? '基础价'
        : source === 'ADJUSTMENT'
          ? '收费项目'
          : `分项 ${index + 1}`);

    return [
      {
        source,
        sourceId: optionalText(candidate.sourceId),
        name: persistedName
          ? externalPriceRuleDisplayName(persistedName)
          : fallbackName,
        adjustmentType: optionalText(candidate.adjustmentType),
        rate: decimalText(candidate.rate, MAX_COMPONENT_RATE),
        units: decimalText(candidate.units, MAX_COMPONENT_UNITS),
        amount,
        categoryName,
        categoryCode: optionalText(candidate.categoryCode),
        ruleCode: optionalText(candidate.ruleCode),
        sourceSheet: optionalText(candidate.sourceSheet),
        sourceRange: optionalText(candidate.sourceRange),
      },
    ];
  });
}

export function parsePricingSnapshotSummary(
  pricingSnapshot: unknown,
): ParsedPricingSnapshotSummary {
  if (!isRecord(pricingSnapshot)) {
    return {
      suggestedSubtotal: null,
      actualSubtotal: null,
      overrideReason: null,
    };
  }
  const actual = isRecord(pricingSnapshot.actual)
    ? pricingSnapshot.actual
    : null;
  return {
    suggestedSubtotal: decimalText(
      pricingSnapshot.suggestedSubtotal,
      MAX_COMPONENT_AMOUNT,
    ),
    actualSubtotal: actual
      ? decimalText(actual.subtotal, MAX_COMPONENT_AMOUNT)
      : null,
    overrideReason: actual ? optionalText(actual.overrideReason) : null,
  };
}

export function PricingSnapshotBreakdown({
  pricingSnapshot,
  title = '已保存价格明细',
  className,
}: PricingSnapshotBreakdownProps) {
  const components = parsePricingSnapshotComponents(pricingSnapshot);
  if (components.length === 0) return null;
  const summary = parsePricingSnapshotSummary(pricingSnapshot);
  const adjusted =
    summary.overrideReason !== null ||
    (summary.actualSubtotal !== null &&
      (summary.suggestedSubtotal === null ||
        !new Decimal(summary.actualSubtotal).equals(
          summary.suggestedSubtotal,
        )));

  return (
    <section
      aria-label={title}
      className={cn('min-w-0 rounded-lg bg-muted/20 p-3', className)}
    >
      <h4 className="text-sm font-semibold">
        {title}（{components.length}）
      </h4>
      {summary.suggestedSubtotal !== null || summary.actualSubtotal !== null ? (
        <div
          className={cn(
            'mt-3 rounded-md border p-3 text-xs',
            adjusted ? 'border-warning/40 bg-warning/10' : 'bg-card',
          )}
        >
          <dl className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
            {summary.suggestedSubtotal !== null ? (
              <BreakdownField
                label="自动计价小计"
                value={formatMoney(summary.suggestedSubtotal)}
                tabular
              />
            ) : null}
            {summary.actualSubtotal !== null ? (
              <BreakdownField
                label="已保存价格小计"
                value={formatMoney(summary.actualSubtotal)}
                tabular
              />
            ) : null}
            {summary.overrideReason ? (
              <BreakdownField
                label="价格调整原因"
                value={summary.overrideReason}
                full
              />
            ) : null}
          </dl>
          {adjusted ? (
            <p className="mt-2 text-warning-foreground">
              收费以“已保存价格小计”为准。
            </p>
          ) : null}
        </div>
      ) : null}
      <ol
        aria-label={`${title}项目`}
        className="mt-3 grid min-w-0 grid-cols-1 gap-3 xl:grid-cols-2"
      >
        {components.map((component, index) => (
          <li
            key={`${component.source ?? 'UNKNOWN'}:${component.sourceId ?? component.ruleCode ?? 'row'}:${index}`}
            className="admin-wrap-anywhere min-w-0 rounded-lg border bg-card p-3"
          >
            <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
              <div className="min-w-0">
                <p className="admin-wrap-anywhere font-medium">
                  {component.name}
                </p>
                <p className="admin-wrap-anywhere text-xs text-muted-foreground">
                  {sourceLabel(component.source)}
                </p>
              </div>
              <p className="shrink-0 font-sans font-semibold tabular-nums">
                <span className="sr-only">金额：</span>
                {formatMoney(component.amount)}
              </p>
            </div>

            <dl className="mt-3 grid min-w-0 grid-cols-1 gap-x-4 gap-y-2 text-xs sm:grid-cols-2">
              {component.adjustmentType ? (
                <BreakdownField
                  label="计价方式"
                  value={
                    ADJUSTMENT_TYPE_LABELS[component.adjustmentType] ??
                    '其他计价方式'
                  }
                />
              ) : null}
              {component.rate && component.units ? (
                <BreakdownField
                  label="计算"
                  value={`${formatUnitPrice(component.rate)} × ${component.units}${
                    component.adjustmentType
                      ? (UNIT_LABELS[component.adjustmentType] ?? '')
                      : ''
                  }`}
                  tabular
                />
              ) : null}
              {component.categoryName ? (
                <BreakdownField
                  label="收费类目"
                  value={component.categoryName}
                />
              ) : null}
            </dl>
          </li>
        ))}
      </ol>
    </section>
  );
}

function BreakdownField({
  label,
  value,
  tabular,
  full,
}: {
  label: string;
  value: string;
  tabular?: boolean;
  full?: boolean;
}) {
  return (
    <div className={cn('min-w-0', full && 'sm:col-span-2')}>
      <dt className="text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          'admin-wrap-anywhere mt-0.5 text-foreground',
          tabular && 'font-sans tabular-nums',
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function sourceLabel(source: string | null): string {
  if (source === 'BASE') return '基础价格';
  if (source === 'ADJUSTMENT') return '加价 / 收费项';
  return '报价分项';
}
