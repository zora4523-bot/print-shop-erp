'use client';

import { useActionState, useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Decimal from 'decimal.js';
import {
  ArrowRight,
  Check,
  RefreshCw,
  RotateCcw,
  Save,
  Undo2,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CustomerPriceCalculationType } from '@/generated/prisma/enums';
import { cn } from '@/lib/utils';
import type {
  CustomerPriceBookMutationResult,
  UpdateCustomerPriceRuleDraftGroupActionInput,
} from '@/actions/customer-price-books.types';
import { usePriceWorkspaceUnsavedTierChanges } from './PriceWorkspaceNavigationGuard';
import { formatRate } from '@/lib/format/unit-price';

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

function TierActivationControl({
  active,
  disabled,
  quantity,
  onChange,
}: {
  active: boolean;
  disabled: boolean;
  quantity: number;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex min-w-0 items-center justify-end">
      <label
        aria-label={`${quantityFormatter.format(quantity)} 个价格档${active ? '启用' : '停用'}`}
        className="flex min-h-11 min-w-0 cursor-pointer items-center gap-1 text-sm has-[[data-disabled]]:cursor-not-allowed has-[[data-disabled]]:opacity-60"
      >
        <Checkbox
          checked={active}
          disabled={disabled}
          onCheckedChange={onChange}
        />
        <span>{active ? '启用' : '停用'}</span>
      </label>
    </div>
  );
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

function parseSignedPercent(value: string): Decimal | null {
  const trimmed = value.trim();
  const match = /^([+-])?((?:0|[1-9]\d{0,3})(?:\.\d{1,4})?)$/.exec(trimmed);
  if (!match) return null;
  try {
    const amount = new Decimal(match[2] ?? '0');
    return match[1] === '-' ? amount.neg() : amount;
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

function decimalInputValue(value: Decimal.Value): string {
  return new Decimal(value)
    .toFixed(4)
    .replace(/\.0+$/, '')
    .replace(/(\.\d*?)0+$/, '$1');
}

function amountLabel(value: string | null): string {
  if (value === null || value.trim() === '') return '待设置';
  const amount = parseAmount(value);
  return amount ? formatRate(amount) : '待设置';
}

type PricingPresentation = {
  calculationLabel: string;
  currentColumnLabel: string;
  draftColumnLabel: string;
  amountSuffix: string;
  valueNoun: string;
  instruction: string;
};

const PRICING_PRESENTATIONS: Record<
  CustomerPriceCalculationType,
  PricingPresentation
> = {
  [CustomerPriceCalculationType.FIXED_AMOUNT]: {
    calculationLabel: '整批固定总价',
    currentColumnLabel: '当前总价',
    draftColumnLabel: '草稿总价（元）',
    amountSuffix: ' / 批',
    valueNoun: '总价',
    instruction: '修改各数量档总价；折合单价自动计算。',
  },
  [CustomerPriceCalculationType.PER_PIECE]: {
    calculationLabel: '按个计价',
    currentColumnLabel: '当前单价',
    draftColumnLabel: '草稿单价（元/个）',
    amountSuffix: ' / 个',
    valueNoun: '单价',
    instruction: '修改各数量档单价。',
  },
  [CustomerPriceCalculationType.PER_SHEET]: {
    calculationLabel: '按张计价',
    currentColumnLabel: '当前每张价',
    draftColumnLabel: '草稿每张价（元/张）',
    amountSuffix: ' / 张',
    valueNoun: '每张价',
    instruction: '修改各数量档每张价。',
  },
  [CustomerPriceCalculationType.PER_10K]: {
    calculationLabel: '每万个计价',
    currentColumnLabel: '当前每万个价',
    draftColumnLabel: '草稿每万个价（元/万个）',
    amountSuffix: ' / 万个',
    valueNoun: '每万个价',
    instruction: '修改各数量档每万个价。',
  },
  [CustomerPriceCalculationType.PER_ITEM]: {
    calculationLabel: '每款一次',
    currentColumnLabel: '当前每款价',
    draftColumnLabel: '草稿每款价（元/款）',
    amountSuffix: ' / 款',
    valueNoun: '每款价',
    instruction: '修改各数量档每款价。',
  },
  [CustomerPriceCalculationType.PER_BAG]: {
    calculationLabel: '按实际袋数',
    currentColumnLabel: '当前每袋价',
    draftColumnLabel: '草稿每袋价（元/袋）',
    amountSuffix: ' / 袋',
    valueNoun: '每袋价',
    instruction: '入袋费 = 实际袋数 × 每袋价。',
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
  if (left.trim() === '' && right.trim() === '') return true;
  const leftValue = parseAmount(left);
  const rightValue = parseAmount(right);
  return leftValue !== null && rightValue !== null && leftValue.eq(rightValue);
}

export type ExternalSalesTierDraftState = {
  amounts: string[];
  activeStates: boolean[];
};

export function createExternalSalesTierDraftState(
  tiers: ExternalSalesPriceTier[],
): ExternalSalesTierDraftState {
  return {
    amounts: tiers.map((tier) => tier.draftAmount ?? ''),
    activeStates: tiers.map((tier) => tier.isActive),
  };
}

function cloneTierDraftState(
  state: ExternalSalesTierDraftState,
): ExternalSalesTierDraftState {
  return {
    amounts: [...state.amounts],
    activeStates: [...state.activeStates],
  };
}

function tierDraftStatesEqual(
  left: ExternalSalesTierDraftState,
  right: ExternalSalesTierDraftState,
): boolean {
  return (
    left.amounts.length === right.amounts.length &&
    left.activeStates.length === right.activeStates.length &&
    left.amounts.every((amount, index) =>
      numericValuesEqual(amount, right.amounts[index] ?? ''),
    ) &&
    left.activeStates.every(
      (active, index) => active === right.activeStates[index],
    )
  );
}

export function undoExternalSalesTierDraftChange(
  history: ExternalSalesTierDraftState[],
):
  | { state: ExternalSalesTierDraftState; history: ExternalSalesTierDraftState[] }
  | null {
  const previous = history.at(-1);
  if (!previous) return null;
  return {
    state: cloneTierDraftState(previous),
    history: history.slice(0, -1).map(cloneTierDraftState),
  };
}

export function countExternalSalesTierDraftChanges(
  state: ExternalSalesTierDraftState,
  tiers: ExternalSalesPriceTier[],
): number {
  return tiers.filter(
    (tier, index) =>
      !numericValuesEqual(state.amounts[index] ?? '', tier.draftAmount ?? '') ||
      (state.activeStates[index] ?? tier.isActive) !== tier.isActive,
  ).length;
}

export type ExternalSalesTierPercentResult =
  | { success: true; state: ExternalSalesTierDraftState }
  | { success: false; message: string };

export function applyExternalSalesTierPercentAdjustment(
  state: ExternalSalesTierDraftState,
  percentInput: string,
): ExternalSalesTierPercentResult {
  if (percentInput.trim() === '') {
    return { success: false, message: '请输入调整百分比' };
  }
  const percent = parseSignedPercent(percentInput);
  if (percent === null) {
    return {
      success: false,
      message: '请输入有效百分比，最多 4 位小数',
    };
  }
  if (percent.lte(-100)) {
    return { success: false, message: '降价幅度必须大于 -100%' };
  }
  if (!state.activeStates.some(Boolean)) {
    return {
      success: false,
      message: '当前没有启用档，批量调整未应用',
    };
  }

  const multiplier = new Decimal(1).plus(percent.div(100));
  const nextAmounts = [...state.amounts];
  for (let index = 0; index < state.amounts.length; index += 1) {
    if (!state.activeStates[index]) continue;
    const amount = parseAmount(state.amounts[index] ?? '');
    if (amount === null) {
      return {
        success: false,
        message: '请先修正启用档的草稿价',
      };
    }
    const adjusted = amount.mul(multiplier).toDecimalPlaces(4);
    if (adjusted.gt('9999999999.9999')) {
      return {
        success: false,
        message: '调整后金额超出允许范围',
      };
    }
    nextAmounts[index] = decimalInputValue(adjusted);
  }

  return {
    success: true,
    state: {
      amounts: nextAmounts,
      activeStates: [...state.activeStates],
    },
  };
}

export type DraftAmountDelta = {
  kind: 'none' | 'up' | 'down';
  amountLabel: string;
  percentLabel: string;
};

export function formatDraftAmountDelta(
  currentAmount: string | null,
  draftAmount: string,
): DraftAmountDelta {
  const current = parseAmount(currentAmount ?? '');
  const draft = parseAmount(draftAmount);
  if (current === null || draft === null || current.eq(draft)) {
    return { kind: 'none', amountLabel: '未修改', percentLabel: '' };
  }
  const diff = draft.minus(current);
  const down = diff.lt(0);
  const abs = diff.abs();
  const sign = down ? '−' : '+';
  const percent = current.eq(0)
    ? ''
    : `${sign}${decimalLabel(abs.div(current).mul(100))}%`;
  return {
    kind: down ? 'down' : 'up',
    amountLabel: `${sign}${formatRate(abs)}`,
    percentLabel: percent,
  };
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
        草稿已保存。
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
  const editorIdentity = `${priceBookId}:${anchorRuleId}`;
  const editorIdentityRef = useRef(editorIdentity);
  const initialDraftState = useRef(createExternalSalesTierDraftState(tiers));
  const lastSubmittedDraftState = useRef<ExternalSalesTierDraftState | null>(
    null,
  );
  const [draftState, setDraftState] = useState(() =>
    createExternalSalesTierDraftState(tiers),
  );
  const [undoStack, setUndoStack] = useState<ExternalSalesTierDraftState[]>([]);
  const [batchPercent, setBatchPercent] = useState('');
  const [batchPercentError, setBatchPercentError] = useState<string | null>(null);
  const locallyChangedTierCount = countExternalSalesTierDraftChanges(
    draftState,
    tiers,
  );
  const clearWorkspaceUnsavedChanges = usePriceWorkspaceUnsavedTierChanges(
    locallyChangedTierCount,
  );

  function commitDraftState(nextState: ExternalSalesTierDraftState) {
    if (tierDraftStatesEqual(draftState, nextState)) return;
    setUndoStack((current) => [
      ...current.slice(-49),
      cloneTierDraftState(draftState),
    ]);
    setDraftState(cloneTierDraftState(nextState));
  }

  const [state, formAction, pending] = useActionState<FormState, FormData>(
    async (_previousState, formData) => {
      const parsed = externalSalesPriceTierSaveInputFromFormData(
        priceBookId,
        anchorRuleId,
        tiers,
        formData,
        draftState.activeStates,
      );
      if (!parsed.success) return parsed.result;
      lastSubmittedDraftState.current = cloneTierDraftState(draftState);
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
    if (editorIdentityRef.current === editorIdentity) return;
    const nextState = createExternalSalesTierDraftState(tiers);
    editorIdentityRef.current = editorIdentity;
    initialDraftState.current = cloneTierDraftState(nextState);
    lastSubmittedDraftState.current = null;
    setDraftState(nextState);
    setUndoStack([]);
    setBatchPercent('');
    setBatchPercentError(null);
  }, [editorIdentity, tiers]);

  useEffect(() => {
    if (state?.status !== 'success') return;
    if (lastSubmittedDraftState.current) {
      initialDraftState.current = cloneTierDraftState(
        lastSubmittedDraftState.current,
      );
      setUndoStack([]);
    }
    clearWorkspaceUnsavedChanges();
    if (successHref) {
      router.replace(successHref);
      return;
    }
    router.refresh();
  }, [clearWorkspaceUnsavedChanges, router, state, successHref]);

  return (
    <form
      ref={formRef}
      action={formAction}
      aria-labelledby={headingId}
      aria-busy={pending}
      className="@container min-w-0 overflow-hidden rounded-xl border bg-card shadow-sm"
    >
      <header className="min-w-0 border-b bg-muted/30 p-4">
        <div className="flex min-w-0 flex-col gap-3 @min-[31rem]:flex-row @min-[31rem]:items-start @min-[31rem]:justify-between">
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
        <div className="mt-3 flex min-w-0 flex-wrap items-start gap-2">
          <div className="min-w-0 flex-1 space-y-1">
            <Label htmlFor={`${headingId}-batch-percent`} className="text-xs">
              按百分比批量调草稿价
            </Label>
            <Input
              id={`${headingId}-batch-percent`}
              value={batchPercent}
              inputMode="decimal"
              autoComplete="off"
              disabled={pending}
              placeholder="如 5.8 或 -3"
              className="min-h-11 w-full font-sans tabular-nums"
              aria-invalid={Boolean(batchPercentError)}
              aria-describedby={
                batchPercentError ? `${headingId}-batch-percent-error` : undefined
              }
              onChange={(event) => {
                setBatchPercent(event.target.value);
                setBatchPercentError(null);
              }}
            />
            <p className="text-xs text-muted-foreground">仅作用于当前启用档</p>
            {batchPercentError ? (
              <p
                id={`${headingId}-batch-percent-error`}
                role="alert"
                className="admin-wrap-anywhere text-xs text-destructive"
              >
                {batchPercentError}
              </p>
            ) : null}
          </div>
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            disabled={pending}
            onClick={() => {
              const result = applyExternalSalesTierPercentAdjustment(
                draftState,
                batchPercent,
              );
              if (!result.success) {
                setBatchPercentError(result.message);
                return;
              }
              setBatchPercentError(null);
              commitDraftState(result.state);
            }}
          >
            应用到启用档
          </Button>
        </div>
        <div className="mt-2 flex min-w-0 flex-wrap gap-2">
          <Button
            type="button"
            variant="ghost"
            className="min-h-11"
            disabled={pending || undoStack.length === 0}
            onClick={() => {
              const undone = undoExternalSalesTierDraftChange(undoStack);
              if (!undone) return;
              setDraftState(undone.state);
              setUndoStack(undone.history);
              setBatchPercentError(null);
            }}
          >
            <Undo2 aria-hidden="true" />
            撤销上一步
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="min-h-11 text-muted-foreground"
            disabled={pending || locallyChangedTierCount === 0}
            title="恢复本次修改前的值"
            onClick={() => {
              setDraftState(cloneTierDraftState(initialDraftState.current));
              setUndoStack([]);
              setBatchPercent('');
              setBatchPercentError(null);
            }}
          >
            <RotateCcw aria-hidden="true" />
            撤销本次修改
          </Button>
        </div>
      </header>

      <div className="min-w-0">
        <div
          aria-hidden="true"
          className="hidden min-w-0 grid-cols-[minmax(4.75rem,0.65fr)_minmax(5.5rem,0.9fr)_minmax(7rem,1fr)_minmax(5.5rem,0.8fr)_5.25rem] gap-2 border-b bg-muted/20 px-3 py-2 text-xs font-medium text-muted-foreground @min-[31rem]:grid"
        >
          <span>数量</span>
          <span className="text-right">当前</span>
          <span className="text-right">草稿</span>
          <span className="text-right">变化</span>
          <span className="text-right">启用</span>
        </div>
        <ol className="min-w-0 divide-y">
          {tiers.map((tier, index) => {
            const amountInputId = `${headingId}-amount-${index}`;
            const errorId = `${headingId}-amount-${index}-error`;
            const errors = fieldErrorsForTier(state, index);
            const value = draftState.amounts[index] ?? '';
            const active = draftState.activeStates[index] ?? tier.isActive;
            const locallyChanged =
              !numericValuesEqual(value, tier.draftAmount ?? '') ||
              active !== tier.isActive;
            const delta = formatDraftAmountDelta(tier.currentAmount, value);

            return (
              <li
                key={tier.ruleId}
                className={cn(
                  'grid min-w-0 grid-cols-2 items-center gap-3 px-4 py-3 @min-[31rem]:min-h-12 @min-[31rem]:grid-cols-[minmax(4.75rem,0.65fr)_minmax(5.5rem,0.9fr)_minmax(7rem,1fr)_minmax(5.5rem,0.8fr)_5.25rem] @min-[31rem]:gap-2 @min-[31rem]:px-3 @min-[31rem]:py-1',
                  (tier.changed || locallyChanged) &&
                    'bg-warning/5 ring-1 ring-inset ring-warning/30',
                )}
              >
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground @min-[31rem]:hidden">
                    数量
                  </p>
                  <p className="font-sans font-semibold tabular-nums">
                    {quantityFormatter.format(tier.quantity)} 个
                  </p>
                </div>

                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground @min-[31rem]:hidden">
                    {presentation.currentColumnLabel}
                  </p>
                  <p className="flex min-w-0 items-center justify-end gap-2 font-sans tabular-nums">
                    <span className="admin-wrap-anywhere">
                      {priceAmountLabel(tier.currentAmount, presentation)}
                    </span>
                    <ArrowRight
                      aria-label="调整为"
                      className="size-3.5 shrink-0 text-muted-foreground @min-[31rem]:hidden"
                    />
                  </p>
                </div>

                <div className="min-w-0 space-y-1">
                  <Label
                    htmlFor={amountInputId}
                    className="text-xs @min-[31rem]:sr-only"
                    title={presentation.draftColumnLabel}
                  >
                    {presentation.draftColumnLabel}
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
                      disabled={pending}
                      className="min-h-11 min-w-0 pl-7 text-right font-sans tabular-nums @min-[31rem]:h-10 @min-[31rem]:!min-h-10"
                      pattern="(?:0|[1-9]\d{0,9})(?:\.\d{1,4})?"
                      required
                      aria-required="true"
                      aria-invalid={Boolean(errors?.length)}
                      aria-describedby={errors?.length ? errorId : undefined}
                      onChange={(event) => {
                        const nextValue = event.target.value;
                        const nextAmounts = [...draftState.amounts];
                        nextAmounts[index] = nextValue;
                        commitDraftState({
                          amounts: nextAmounts,
                          activeStates: draftState.activeStates,
                        });
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

                <div className="min-w-0 text-right">
                  <p className="text-xs text-muted-foreground @min-[31rem]:hidden">
                    变化
                  </p>
                  {delta.kind === 'none' ? (
                    <p className="text-xs text-muted-foreground">未修改</p>
                  ) : (
                    <p
                      className={cn(
                        'font-sans text-sm tabular-nums',
                        delta.kind === 'down'
                          ? 'text-warning-foreground'
                          : 'text-foreground',
                      )}
                    >
                      {delta.amountLabel}
                      {delta.percentLabel ? (
                        <span className="ml-1 text-xs">{delta.percentLabel}</span>
                      ) : null}
                    </p>
                  )}
                </div>

                <TierActivationControl
                  active={active}
                  disabled={pending}
                  quantity={tier.quantity}
                  onChange={(checked) => {
                    const nextActiveStates = [...draftState.activeStates];
                    nextActiveStates[index] = checked;
                    commitDraftState({
                      amounts: draftState.amounts,
                      activeStates: nextActiveStates,
                    });
                  }}
                />
              </li>
            );
          })}
        </ol>
      </div>

      <footer className="sticky bottom-0 z-[5] min-w-0 border-t bg-card/95 p-4 backdrop-blur supports-[backdrop-filter]:bg-card/85 admin-safe-bottom">
        <div className="flex min-w-0 flex-col gap-3 @min-[31rem]:flex-row @min-[31rem]:items-center @min-[31rem]:justify-between">
          <div className="min-w-0">
            <TierMutationFeedback
              state={state}
              onRefresh={router.refresh}
              valueNoun={presentation.valueNoun}
            />
            {!state ? (
              <p className="text-xs text-muted-foreground">
                {locallyChangedTierCount > 0
                  ? `${locallyChangedTierCount} 档待保存；保存失败时不修改任何档。`
                  : '暂无修改'}
              </p>
            ) : null}
          </div>
          <Button
            type="submit"
            className="min-h-11 w-full shrink-0 @min-[31rem]:w-auto"
            disabled={
              pending || tiers.length === 0 || locallyChangedTierCount === 0
            }
          >
            <Save aria-hidden="true" />
            {pending
              ? `正在保存${presentation.valueNoun}…`
              : `保存（${locallyChangedTierCount} 档）`}
          </Button>
        </div>
      </footer>
    </form>
  );
}
