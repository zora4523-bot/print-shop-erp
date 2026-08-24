'use client';

import { useActionState, useMemo, useState } from 'react';
import {
  AdjustmentType,
  OrderSettlementType,
} from '../../../generated/prisma/enums';
import type { PriceMutationResult } from '@/actions/owner-prices.types';
import { Button, buttonVariants } from '@/components/ui/button';
import { PendingLink } from '@/components/ui-business/PendingLink';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ADJUSTMENT_TYPE_LABELS } from '@/lib/price-labels';
import {
  PRICE_ADJUSTMENT_CONDITION_KEYS,
  validatePriceAdjustmentTriggerCondition,
  type PriceAdjustmentConditionKey,
  type PriceAdjustmentTriggerCondition,
} from '@/lib/price/adjustment-condition';
import { ORDER_SETTLEMENT_LABELS } from '@/lib/order/settlement';

type PriceAdjustmentInitial = {
  name: string;
  adjustmentType: AdjustmentType;
  amount: string;
  triggerCondition: string;
};

export type PriceAdjustmentSelectOption = {
  id: string;
  label: string;
};

type Props =
  | {
      mode: 'create';
      action: (
        prev: PriceMutationResult | null,
        fd: FormData,
      ) => Promise<PriceMutationResult>;
      products: PriceAdjustmentSelectOption[];
      crafts: PriceAdjustmentSelectOption[];
    }
  | {
      mode: 'edit';
      action: (
        prev: PriceMutationResult | null,
        fd: FormData,
      ) => Promise<PriceMutationResult>;
      initial: PriceAdjustmentInitial;
      products: PriceAdjustmentSelectOption[];
      crafts: PriceAdjustmentSelectOption[];
    };

const selectClass =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50';

export function PriceAdjustmentForm(props: Props) {
  const [state, formAction, pending] = useActionState<
    PriceMutationResult | null,
    FormData
  >(props.action, null);

  const initial = props.mode === 'edit' ? props.initial : undefined;
  const [adjustmentType, setAdjustmentType] = useState<AdjustmentType>(
    initial?.adjustmentType ?? AdjustmentType.PER_ORDER,
  );
  const [triggerCondition, setTriggerCondition] = useState(
    initial?.triggerCondition ?? '',
  );
  const errs = state?.status === 'invalid' ? state.fieldErrors : {};
  const generalError = state?.status === 'error' ? state.message : null;
  const success = state?.status === 'success';
  const parsedDraft = useMemo(
    () => parseConditionDraft(triggerCondition),
    [triggerCondition],
  );
  const condition = parsedDraft.condition ?? {};
  const draftErrors = parsedDraft.error
    ? [parsedDraft.error]
    : validatePriceAdjustmentTriggerCondition(
        parsedDraft.condition,
        adjustmentType,
      );

  function setConditionField(
    key: PriceAdjustmentConditionKey,
    value: PriceAdjustmentTriggerCondition[PriceAdjustmentConditionKey],
  ) {
    setTriggerCondition((current) => updateConditionJson(current, key, value));
  }

  return (
    <form action={formAction} aria-busy={pending} className="space-y-5" noValidate>
      <TextField
        id="name"
        label="收费项目名称"
        required
        disabled={pending}
        error={errs.name?.[0]}
        defaultValue={initial?.name ?? ''}
      />

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="adjustmentType">加价类型</Label>
          <select
            id="adjustmentType"
            name="adjustmentType"
            className={selectClass}
            value={adjustmentType}
            onChange={(event) =>
              setAdjustmentType(event.target.value as AdjustmentType)
            }
            disabled={pending}
          >
            {Object.values(AdjustmentType).map((type) => (
              <option key={type} value={type}>
                {ADJUSTMENT_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
          {errs.adjustmentType?.[0] ? (
            <p className="text-sm text-destructive">{errs.adjustmentType[0]}</p>
          ) : null}
        </div>

        <TextField
          id="amount"
          label="加价金额"
          hint="最多 6 位整数、4 位小数。"
          required
          disabled={pending}
          error={errs.amount?.[0]}
          defaultValue={initial?.amount ?? ''}
        />
      </div>

      <section className="space-y-4 rounded-xl border bg-muted/20 p-4">
        <div>
          <h2 className="text-sm font-semibold">触发条件</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            选择这项费用适用的产品、工艺和工单条件；全部留空表示通用。
          </p>
        </div>

        {adjustmentType === AdjustmentType.PER_SHEET ? (
          <p className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-warning-foreground">
            “按张”规则必须填写“每张可生产数量”，否则不允许保存。
          </p>
        ) : null}

        <ConditionBuilder
          condition={condition}
          products={props.products}
          crafts={props.crafts}
          disabled={pending}
          onChange={setConditionField}
        />

        <input
          type="hidden"
          name="triggerCondition"
          value={triggerCondition}
        />

        {errs.triggerCondition?.[0] ? (
          <div id="triggerCondition-error" role="alert" className="space-y-1 text-sm text-destructive">
            {errs.triggerCondition.map((error) => (
              <p key={error}>{error}</p>
            ))}
          </div>
        ) : draftErrors.length > 0 ? (
          <div id="triggerCondition-help" className="space-y-1 text-sm text-warning-foreground">
            {draftErrors.map((error) => (
              <p key={error}>{error}</p>
            ))}
            {parsedDraft.error ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => setTriggerCondition('')}
              >
                清空旧条件后重新设置
              </Button>
            ) : null}
          </div>
        ) : (
          <p
            id="triggerCondition-help"
            className="text-xs text-success-foreground"
          >
            当前业务条件可以保存。
          </p>
        )}
      </section>

      {generalError ? (
        <p role="alert" className="text-sm text-destructive">
          {generalError}
        </p>
      ) : null}
      {success ? (
        <p role="status" className="text-sm text-success-foreground">
          ✓ 已保存
        </p>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? '提交中…' : props.mode === 'create' ? '创建收费项目' : '保存修改'}
        </Button>
        <PendingLink
          href="/owner/prices"
          pending={pending}
          className={buttonVariants({ variant: 'outline' })}
        >
          返回报价管理
        </PendingLink>
      </div>
    </form>
  );
}

function ConditionBuilder({
  condition,
  products,
  crafts,
  disabled,
  onChange,
}: {
  condition: PriceAdjustmentTriggerCondition;
  products: PriceAdjustmentSelectOption[];
  crafts: PriceAdjustmentSelectOption[];
  disabled: boolean;
  onChange: (
    key: PriceAdjustmentConditionKey,
    value: PriceAdjustmentTriggerCondition[PriceAdjustmentConditionKey],
  ) => void;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <MultiSelectField
        id="condition-productIds"
        label="限定产品"
        hint="可多选；不选表示不限产品。"
        options={products}
        value={stringArray(condition.productIds)}
        disabled={disabled}
        onChange={(value) => onChange('productIds', value)}
      />
      <MultiSelectField
        id="condition-craftIds"
        label="限定工艺"
        hint="可多选；不选表示不限工艺。"
        options={crafts}
        value={stringArray(condition.craftIds)}
        disabled={disabled}
        onChange={(value) => onChange('craftIds', value)}
      />

      <SelectField
        id="condition-craftMode"
        label="多工艺匹配方式"
        value={condition.craftMode ?? ''}
        disabled={disabled}
        options={[
          { value: '', label: '任意一项' },
          { value: 'ANY', label: '任意一项' },
          { value: 'ALL', label: '必须全部包含' },
        ]}
        onChange={(value) =>
          onChange(
            'craftMode',
            value === 'ANY' || value === 'ALL' ? value : undefined,
          )
        }
      />
      <MultiSelectField
        id="condition-settlementTypes"
        label="结算类型"
        hint="可多选；不选表示不限。外部销售已由独立版本化价目簿管理，在此选择不会改变外部销售报价。"
        value={stringArray(condition.settlementTypes)}
        disabled={disabled}
        options={Object.values(OrderSettlementType).map((value) => ({
          id: value,
          label:
            value === OrderSettlementType.EXTERNAL_SALES
              ? `${ORDER_SETTLEMENT_LABELS[value]}（独立价目簿）`
              : ORDER_SETTLEMENT_LABELS[value],
        }))}
        onChange={(value) => onChange('settlementTypes', value)}
      />

      <StringListField
        id="condition-specifications"
        label="规格"
        hint="多项用逗号分隔，例如：大号, 中号。"
        value={stringArray(condition.specifications)}
        disabled={disabled}
        onChange={(value) => onChange('specifications', value)}
      />
      <StringListField
        id="condition-paperTypes"
        label="纸张"
        hint="多项用逗号分隔。"
        value={stringArray(condition.paperTypes)}
        disabled={disabled}
        onChange={(value) => onChange('paperTypes', value)}
      />
      <StringListField
        id="condition-foilColors"
        label="烫金色"
        hint="多项用逗号分隔。"
        value={stringArray(condition.foilColors)}
        disabled={disabled}
        onChange={(value) => onChange('foilColors', value)}
      />
      <BooleanField
        id="condition-isDoubleSided"
        label="是否双面"
        value={condition.isDoubleSided}
        disabled={disabled}
        onChange={(value) => onChange('isDoubleSided', value)}
      />
      <BooleanField
        id="condition-isDoubleColor"
        label="是否双色"
        value={condition.isDoubleColor}
        disabled={disabled}
        onChange={(value) => onChange('isDoubleColor', value)}
      />
      <BooleanField
        id="condition-perFoilColor"
        label="是否按烫金色数量倍增"
        value={condition.perFoilColor}
        disabled={disabled}
        onChange={(value) => onChange('perFoilColor', value)}
      />

      <NumberField
        id="condition-minQty"
        label="最小数量"
        value={positiveInteger(condition.minQty)}
        disabled={disabled}
        onChange={(value) => onChange('minQty', value)}
      />
      <NumberField
        id="condition-maxQty"
        label="最大数量"
        value={positiveInteger(condition.maxQty)}
        disabled={disabled}
        onChange={(value) => onChange('maxQty', value)}
      />
      <NumberField
        id="condition-unitsPerSheet"
        label="每张可生产数量"
        hint="按张计价必填；例如一张排 4 个就填 4。"
        value={positiveInteger(condition.unitsPerSheet)}
        disabled={disabled}
        onChange={(value) => onChange('unitsPerSheet', value)}
      />
    </div>
  );
}

function MultiSelectField({
  id,
  label,
  hint,
  options,
  value,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  options: PriceAdjustmentSelectOption[];
  value: string[];
  disabled: boolean;
  onChange: (value: string[] | undefined) => void;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        multiple
        size={Math.min(Math.max(options.length, 3), 6)}
        value={value}
        disabled={disabled || options.length === 0}
        onChange={(event) => {
          const selected = Array.from(
            event.currentTarget.selectedOptions,
            (option) => option.value,
          );
          onChange(selected.length > 0 ? selected : undefined);
        }}
        className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
      <p className="text-xs text-muted-foreground">
        {options.length === 0 ? '暂无可用选项。' : hint}
      </p>
      {value.length > 0 ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={disabled}
          onClick={() => onChange(undefined)}
        >
          清除选择
        </Button>
      ) : null}
    </div>
  );
}

function SelectField({
  id,
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className={selectClass}
      >
        {options.map((option) => (
          <option key={option.value || 'none'} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function BooleanField({
  id,
  label,
  value,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  value: boolean | undefined;
  disabled: boolean;
  onChange: (value: boolean | undefined) => void;
}) {
  return (
    <SelectField
      id={id}
      label={label}
      value={value === undefined ? '' : String(value)}
      disabled={disabled}
      options={[
        { value: '', label: '不限' },
        { value: 'true', label: '是' },
        { value: 'false', label: '否' },
      ]}
      onChange={(next) =>
        onChange(next === '' ? undefined : next === 'true')
      }
    />
  );
}

function StringListField({
  id,
  label,
  hint,
  value,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  value: string[];
  disabled: boolean;
  onChange: (value: string[] | undefined) => void;
}) {
  const serialized = value.join(', ');
  const [draftState, setDraftState] = useState({
    source: serialized,
    value: serialized,
  });
  const draft =
    draftState.source === serialized ? draftState.value : serialized;

  function commit() {
    const values = draft
      .split(/[,\n，、]/)
      .map((entry) => entry.trim())
      .filter(Boolean);
    onChange(values.length > 0 ? [...new Set(values)] : undefined);
  }

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={draft}
        disabled={disabled}
        onChange={(event) =>
          setDraftState({ source: serialized, value: event.target.value })
        }
        onBlur={commit}
      />
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

function NumberField({
  id,
  label,
  hint,
  value,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  value: number | undefined;
  disabled: boolean;
  onChange: (value: number | undefined) => void;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        min={1}
        step={1}
        value={value ?? ''}
        disabled={disabled}
        onChange={(event) =>
          onChange(
            event.target.value === '' ? undefined : Number(event.target.value),
          )
        }
      />
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function parseConditionDraft(value: string): {
  condition: PriceAdjustmentTriggerCondition | null;
  error: string | null;
} {
  if (value.trim() === '') return { condition: null, error: null };
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { condition: null, error: '旧条件格式无法识别，请清空后重新设置。' };
    }
    return {
      condition: parsed as PriceAdjustmentTriggerCondition,
      error: null,
    };
  } catch {
    return { condition: null, error: '旧条件格式无法识别，请清空后重新设置。' };
  }
}

function updateConditionJson(
  current: string,
  key: PriceAdjustmentConditionKey,
  value: PriceAdjustmentTriggerCondition[PriceAdjustmentConditionKey],
): string {
  const parsed = parseConditionDraft(current).condition;
  const next: Record<string, unknown> = {};
  if (parsed) {
    for (const supportedKey of PRICE_ADJUSTMENT_CONDITION_KEYS) {
      if (supportedKey in parsed) next[supportedKey] = parsed[supportedKey];
    }
  }

  if (value === undefined || (Array.isArray(value) && value.length === 0)) {
    delete next[key];
  } else {
    next[key] = value;
  }
  return Object.keys(next).length === 0 ? '' : JSON.stringify(next, null, 2);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function TextField({
  id,
  label,
  hint,
  error,
  type = 'text',
  ...inputProps
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string | undefined;
  type?: string;
  required?: boolean;
  disabled?: boolean;
  defaultValue?: string;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name={id}
        type={type}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        {...inputProps}
      />
      {error ? (
        <p id={`${id}-error`} className="text-sm text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
