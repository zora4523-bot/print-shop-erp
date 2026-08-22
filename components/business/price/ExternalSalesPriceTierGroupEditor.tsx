'use client';

import { useActionState, useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Decimal from 'decimal.js';
import { ArrowRight, Check, RefreshCw, Save } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CustomerPriceCalculationType } from '@/generated/prisma/enums';
import { cn } from '@/lib/utils';
import type {
  CustomerPriceBookMutationResult,
  UpdateCustomerPriceRuleDraftGroupActionInput,
} from '@/actions/customer-price-books.types';

export type ExternalSalesPriceTier = {
  ruleId: string;
  quantity: number;
  currentAmount: string | null;
  draftAmount: string | null;
  expectedUpdatedAt: string;
  isActive: boolean;
  changed: boolean;
};

export type ExternalSalesPriceTierSaveInput =
  UpdateCustomerPriceRuleDraftGroupActionInput;

export type ExternalSalesPriceTierSaveResult =
  CustomerPriceBookMutationResult;

export type ExternalSalesPriceTierGroupEditorProps = {
  productTitle: string;
  paperLabel: string;
  sizeLabel: string;
  calculationType: CustomerPriceCalculationType;
  priceBookId: string;
  anchorRuleId: string;
  tiers: ExternalSalesPriceTier[];
  saveAction: (
    input: ExternalSalesPriceTierSaveInput,
  ) => Promise<ExternalSalesPriceTierSaveResult>;
  successHref?: string;
};

type FormState = ExternalSalesPriceTierSaveResult | null;

type TierFormParseResult =
  | { success: true; input: ExternalSalesPriceTierSaveInput }
  | { success: false; result: Extract<FormState, { status: 'invalid' }> };

const quantityFormatter = new Intl.NumberFormat('zh-CN', {
  maximumFractionDigits: 0,
});

function tierAmountFieldName(index: number): string {
  return `tierAmount-${index}`;
}

function tierAmountErrorKey(index: number): string {
  return `rows.${index}.amount`;
}

function parseAmount(value: string): Decimal | null {
  const trimmed = value.trim();
  if (!/^(?:0|[1-9]\d{0,9})(?:\.\d{1,4})?$/.test(trimmed)) return null;
  try {
    const amount = new Decimal(trimmed);
    return amount.lte('9999999999.9999') ? amount : null;
  } catch {
    return null;
  }
}

function decimalLabel(value: Decimal.Value): string {
  const [integer = '0', fraction = ''] = new Decimal(value)
    .toFixed(4)
    .replace(/\.0+$/, '')
    .replace(/(\.\d*?)0+$/, '$1')
    .split('.');
  const groupedInteger = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return fraction ? `${groupedInteger}.${fraction}` : groupedInteger;
}

function amountLabel(value: string | null): string {
  if (value === null || value.trim() === '') return '待设置';
  const amount = parseAmount(value);
  return amount ? `¥${decimalLabel(amount)}` : '待设置';
}

function fixedAmountUnitLabel(value: string, quantity: number): string {
  const amount = parseAmount(value);
  if (amount === null || quantity <= 0) return '—';
  return `¥${decimalLabel(amount.div(quantity))} / 个`;
}

type PricingPresentation = {
  calculationLabel: string;
  currentColumnLabel: string;
  draftColumnLabel: string;
  supportingColumnLabel: string;
  inputLabel: string;
  amountSuffix: string;
  valueNoun: string;
  instruction: string;
  supportingValue: (value: string, quantity: number) => string;
};

const PRICING_PRESENTATIONS: Record<
  CustomerPriceCalculationType,
  PricingPresentation
> = {
  [CustomerPriceCalculationType.FIXED_AMOUNT]: {
    calculationLabel: '整批固定总价',
    currentColumnLabel: '当前总价',
    draftColumnLabel: '草稿总价（元）',
    supportingColumnLabel: '折合单价',
    inputLabel: '草稿总价（元）',
    amountSuffix: ' / 批',
    valueNoun: '总价',
    instruction:
      '数量档保持不变，只需修改每档整批总价；保存时整组一次更新。',
    supportingValue: fixedAmountUnitLabel,
  },
  [CustomerPriceCalculationType.PER_PIECE]: {
    calculationLabel: '按个计价',
    currentColumnLabel: '当前单价',
    draftColumnLabel: '草稿单价（元/个）',
    supportingColumnLabel: '计价单位',
    inputLabel: '草稿单价（元/个）',
    amountSuffix: ' / 个',
    valueNoun: '单价',
    instruction:
      '数量档保持不变，只需修改每档的每个单价；系统不会将单价再除以数量。',
    supportingValue: () => '每个成品',
  },
  [CustomerPriceCalculationType.PER_SHEET]: {
    calculationLabel: '按张计价',
    currentColumnLabel: '当前每张价',
    draftColumnLabel: '草稿每张价（元/张）',
    supportingColumnLabel: '计价单位',
    inputLabel: '草稿每张价（元/张）',
    amountSuffix: ' / 张',
    valueNoun: '每张价',
    instruction:
      '数量档保持不变，只需修改每张价格；保存时整组一次更新。',
    supportingValue: () => '每张用纸',
  },
  [CustomerPriceCalculationType.PER_10K]: {
    calculationLabel: '每万个计价',
    currentColumnLabel: '当前每万个价',
    draftColumnLabel: '草稿每万个价（元/万个）',
    supportingColumnLabel: '计价单位',
    inputLabel: '草稿每万个价（元/万个）',
    amountSuffix: ' / 万个',
    valueNoun: '每万个价',
    instruction:
      '数量档保持不变，只需修改每万个价格；保存时整组一次更新。',
    supportingValue: () => '每 10,000 个成品',
  },
  [CustomerPriceCalculationType.PER_ITEM]: {
    calculationLabel: '每款一次',
    currentColumnLabel: '当前每款价',
    draftColumnLabel: '草稿每款价（元/款）',
    supportingColumnLabel: '计价单位',
    inputLabel: '草稿每款价（元/款）',
    amountSuffix: ' / 款',
    valueNoun: '每款价',
    instruction:
      '数量档保持不变，只需修改每款一次的价格；保存时整组一次更新。',
    supportingValue: () => '每款一次',
  },
};

function priceAmountLabel(
  value: string | null,
  presentation: PricingPresentation,
): string {
  const label = amountLabel(value);
  return label === '待设置' ? label : `${label}${presentation.amountSuffix}`;
}

function numericValuesEqual(left: string, right: string): boolean {
  const leftValue = parseAmount(left);
  const rightValue = parseAmount(right);
  return leftValue !== null && rightValue !== null && leftValue.eq(rightValue);
}

function fieldErrorsForTier(
  state: FormState,
  index: number,
): string[] | undefined {
  if (state?.status !== 'invalid') return undefined;
  return (
    state.fieldErrors[tierAmountErrorKey(index)] ??
    state.fieldErrors[tierAmountFieldName(index)]
  );
}

export function externalSalesPriceTierSaveInputFromFormData(
  priceBookId: string,
  anchorRuleId: string,
  tiers: ExternalSalesPriceTier[],
  formData: FormData,
  activeStates: boolean[] = tiers.map((tier) => tier.isActive),
): TierFormParseResult {
  const fieldErrors: Record<string, string[]> = {};
  const submittedTiers = tiers.map((tier, index) => {
    const rawValue = formData.get(tierAmountFieldName(index));
    const amount = typeof rawValue === 'string' ? rawValue.trim() : '';

    if (parseAmount(amount) === null) {
      fieldErrors[tierAmountErrorKey(index)] = [
        '金额必须是非负数字，最多 4 位小数',
      ];
    }

    return {
      ruleId: tier.ruleId,
      amount,
      expectedUpdatedAt: tier.expectedUpdatedAt,
      isActive: activeStates[index] ?? tier.isActive,
    };
  });

  if (Object.keys(fieldErrors).length > 0) {
    return {
      success: false,
      result: { status: 'invalid', fieldErrors },
    };
  }

  return {
    success: true,
    input: {
      priceBookId,
      anchorRuleId,
      rows: submittedTiers,
    },
  };
}

function TierMutationFeedback({
  state,
  onRefresh,
  valueNoun,
}: {
  state: FormState;
  onRefresh: () => void;
  valueNoun: string;
}) {
  if (!state) return null;
  if (state.status === 'success') {
    return (
      <p
        role="status"
        className="flex items-center gap-2 text-sm text-success-foreground"
      >
        <Check aria-hidden="true" className="size-4" />
        这一组{valueNoun}已全部保存到调价草稿。
      </p>
    );
  }
  if (state.status === 'error') {
    return (
      <div className="space-y-2">
        <p
          role="alert"
          className="admin-wrap-anywhere text-sm text-destructive"
        >
          {state.message}
        </p>
        {state.message.includes('刷新') ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-11"
            onClick={onRefresh}
          >
            <RefreshCw aria-hidden="true" />
            刷新最新价格
          </Button>
        ) : null}
      </div>
    );
  }

  const messages = [...new Set(Object.values(state.fieldErrors).flat())];
  return (
    <div role="alert" className="text-sm text-destructive">
      <p className="font-medium">请先修正未保存的{valueNoun}：</p>
      <ul className="mt-1 list-disc space-y-1 pl-5">
        {messages.map((message) => (
          <li key={message} className="admin-wrap-anywhere">
            {message}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ExternalSalesPriceTierGroupEditor({
  productTitle,
  paperLabel,
  sizeLabel,
  calculationType,
  priceBookId,
  anchorRuleId,
  tiers,
  saveAction,
  successHref,
}: ExternalSalesPriceTierGroupEditorProps) {
  const presentation = PRICING_PRESENTATIONS[calculationType];
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const headingId = useId();
  const [draftAmounts, setDraftAmounts] = useState(() =>
    tiers.map((tier) => tier.draftAmount ?? ''),
  );
  const [draftActiveStates, setDraftActiveStates] = useState(() =>
    tiers.map((tier) => tier.isActive),
  );
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    async (_previousState, formData) => {
      const parsed = externalSalesPriceTierSaveInputFromFormData(
        priceBookId,
        anchorRuleId,
        tiers,
        formData,
        draftActiveStates,
      );
      if (!parsed.success) return parsed.result;
      return saveAction(parsed.input);
    },
    null,
  );

  useEffect(() => {
    if (state?.status !== 'invalid') return;
    const firstInvalidIndex = tiers.findIndex(
      (_tier, index) => fieldErrorsForTier(state, index)?.length,
    );
    if (firstInvalidIndex < 0) return;
    const control = formRef.current?.elements.namedItem(
      tierAmountFieldName(firstInvalidIndex),
    );
    if (control instanceof HTMLElement) control.focus();
  }, [state, tiers]);

  useEffect(() => {
    if (state?.status !== 'success') return;
    if (successHref) {
      router.replace(successHref);
      return;
    }
    router.refresh();
  }, [router, state, successHref]);

  return (
    <form
      ref={formRef}
      action={formAction}
      aria-labelledby={headingId}
      aria-busy={pending}
      className="@container min-w-0 overflow-hidden rounded-xl border bg-card shadow-sm"
    >
      <header className="min-w-0 border-b bg-muted/30 p-4">
        <div className="flex min-w-0 flex-col gap-3 @min-[32rem]:flex-row @min-[32rem]:items-start @min-[32rem]:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted-foreground">
              产品价格阶梯
            </p>
            <h3
              id={headingId}
              className="admin-wrap-anywhere mt-1 text-base font-semibold"
            >
              {productTitle}
            </h3>
          </div>
          <Badge variant="outline" className="w-fit font-sans tabular-nums">
            {tiers.length} 个数量档
          </Badge>
        </div>
        <dl className="mt-3 flex min-w-0 flex-wrap gap-x-5 gap-y-2 text-sm">
          <div className="flex min-w-0 gap-2">
            <dt className="shrink-0 text-muted-foreground">纸张</dt>
            <dd className="admin-wrap-anywhere font-medium">{paperLabel}</dd>
          </div>
          <div className="flex min-w-0 gap-2">
            <dt className="shrink-0 text-muted-foreground">规格</dt>
            <dd className="admin-wrap-anywhere font-medium">{sizeLabel}</dd>
          </div>
          <div className="flex min-w-0 gap-2">
            <dt className="shrink-0 text-muted-foreground">计价</dt>
            <dd className="admin-wrap-anywhere font-medium">
              {presentation.calculationLabel}
            </dd>
          </div>
        </dl>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          {presentation.instruction}
        </p>
      </header>

      <div className="min-w-0">
        <div
          aria-hidden="true"
          className="hidden min-w-0 grid-cols-[minmax(5.5rem,0.7fr)_minmax(6.5rem,0.85fr)_minmax(9rem,1fr)_minmax(7rem,0.9fr)_auto] gap-3 border-b bg-muted/20 px-4 py-2 text-xs font-medium text-muted-foreground @min-[42rem]:grid"
        >
          <span>数量</span>
          <span>{presentation.currentColumnLabel}</span>
          <span>{presentation.draftColumnLabel}</span>
          <span>{presentation.supportingColumnLabel}</span>
          <span>状态</span>
        </div>
        <ol className="min-w-0 divide-y">
          {tiers.map((tier, index) => {
            const amountInputId = `${headingId}-amount-${index}`;
            const errorId = `${headingId}-amount-${index}-error`;
            const errors = fieldErrorsForTier(state, index);
            const value = draftAmounts[index] ?? '';
            const active = draftActiveStates[index] ?? tier.isActive;
            const locallyChanged =
              !numericValuesEqual(value, tier.draftAmount ?? '') ||
              active !== tier.isActive;

            return (
              <li
                key={tier.ruleId}
                className={cn(
                  'grid min-w-0 gap-3 p-4 @min-[42rem]:grid-cols-[minmax(5.5rem,0.7fr)_minmax(6.5rem,0.85fr)_minmax(9rem,1fr)_minmax(7rem,0.9fr)_auto] @min-[42rem]:items-center',
                  (tier.changed || locallyChanged) && 'bg-warning/5',
                )}
              >
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground @min-[42rem]:hidden">
                    数量
                  </p>
                  <p className="font-sans font-semibold tabular-nums">
                    {quantityFormatter.format(tier.quantity)} 个
                  </p>
                </div>

                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground @min-[42rem]:hidden">
                    {presentation.currentColumnLabel}
                  </p>
                  <p className="flex min-w-0 items-center gap-2 font-sans tabular-nums">
                    <span className="admin-wrap-anywhere">
                      {priceAmountLabel(tier.currentAmount, presentation)}
                    </span>
                    <ArrowRight
                      aria-label="调整为"
                      className="size-3.5 shrink-0 text-muted-foreground sm:hidden"
                    />
                  </p>
                </div>

                <div className="min-w-0 space-y-1.5">
                  <Label htmlFor={amountInputId} className="text-xs">
                    {quantityFormatter.format(tier.quantity)} 个
                    {presentation.inputLabel}
                  </Label>
                  <div className="relative min-w-0">
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 font-sans text-sm text-muted-foreground"
                    >
                      ¥
                    </span>
                    <Input
                      id={amountInputId}
                      name={tierAmountFieldName(index)}
                      value={value}
                      inputMode="decimal"
                      autoComplete="off"
                      className="min-h-11 min-w-0 pl-7 font-sans tabular-nums"
                      pattern="(?:0|[1-9]\d{0,9})(?:\.\d{1,4})?"
                      required
                      aria-required="true"
                      aria-invalid={Boolean(errors?.length)}
                      aria-describedby={errors?.length ? errorId : undefined}
                      onChange={(event) => {
                        const nextValue = event.target.value;
                        setDraftAmounts((current) =>
                          current.map((amount, amountIndex) =>
                            amountIndex === index ? nextValue : amount,
                          ),
                        );
                      }}
                    />
                  </div>
                  {errors?.length ? (
                    <ul id={errorId} className="space-y-1 text-xs text-destructive">
                      {errors.map((message) => (
                        <li key={message} className="admin-wrap-anywhere">
                          {message}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>

                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground @min-[42rem]:hidden">
                    {presentation.supportingColumnLabel}
                  </p>
                  <p className="admin-wrap-anywhere font-sans text-sm tabular-nums">
                    {presentation.supportingValue(value, tier.quantity)}
                  </p>
                </div>

                <div className="flex min-w-0 flex-wrap items-center gap-1.5 @min-[42rem]:justify-end">
                  <label className="relative flex min-h-11 min-w-0 cursor-pointer items-center pl-11 text-sm">
                    <input
                      type="checkbox"
                      checked={active}
                      className="peer absolute top-0 left-0 size-11 cursor-pointer opacity-0"
                      aria-label={`${quantityFormatter.format(tier.quantity)} 个价格档启用`}
                      onChange={(event) => {
                        const checked = event.target.checked;
                        setDraftActiveStates((current) =>
                          current.map((state, stateIndex) =>
                            stateIndex === index ? checked : state,
                          ),
                        );
                      }}
                    />
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute left-3 flex size-5 items-center justify-center rounded border border-input text-xs text-transparent peer-checked:border-primary peer-checked:bg-primary peer-checked:text-primary-foreground peer-focus-visible:ring-3 peer-focus-visible:ring-ring/50"
                    >
                      ✓
                    </span>
                    <span>{active ? '启用' : '停用'}</span>
                  </label>
                  {locallyChanged ? (
                    <Badge variant="secondary">待保存</Badge>
                  ) : tier.changed ? (
                    <Badge variant="secondary">草稿已调整</Badge>
                  ) : (
                    <span className="text-xs text-muted-foreground">未修改</span>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </div>

      <footer className="sticky bottom-0 min-w-0 border-t bg-card/95 p-4 backdrop-blur supports-[backdrop-filter]:bg-card/85 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="flex min-w-0 flex-col gap-3 @min-[32rem]:flex-row @min-[32rem]:items-center @min-[32rem]:justify-between">
          <div className="min-w-0">
            <TierMutationFeedback
              state={state}
              onRefresh={router.refresh}
              valueNoun={presentation.valueNoun}
            />
            {!state ? (
              <p className="text-xs text-muted-foreground">
                任意一行校验失败时，整组价格都不会保存。
              </p>
            ) : null}
          </div>
          <Button
            type="submit"
            className="min-h-11 w-full shrink-0 @min-[32rem]:w-auto"
            disabled={pending || tiers.length === 0}
          >
            <Save aria-hidden="true" />
            {pending
              ? `正在保存全部${presentation.valueNoun}…`
              : `保存全部${presentation.valueNoun}（${tiers.length} 项）`}
          </Button>
        </div>
      </footer>
    </form>
  );
}
