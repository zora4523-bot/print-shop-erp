import type { HTMLAttributes } from 'react';
import { OrderKind } from '@/generated/prisma/enums';
import type { OrderFilterOption } from '@/lib/order/list-query';
import { cn } from '@/lib/utils';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';

export const ORDER_KIND_LABELS: Record<OrderKind, string> = {
  [OrderKind.NORMAL]: '普通工单',
  [OrderKind.REWORK]: '重做单',
};

export const selectClass =
  'h-8 w-full min-w-0 rounded-lg border border-input bg-background px-2.5 py-1 text-base text-foreground shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30';

export const fieldLabelClass = 'mb-1.5 block text-sm font-medium text-foreground';

export function TextFilter({
  id,
  name,
  label,
  value,
  placeholder,
  inputMode,
  maxLength = 80,
  className,
}: {
  id: string;
  name: string;
  label: string;
  value?: string;
  placeholder?: string;
  inputMode?: HTMLAttributes<HTMLInputElement>['inputMode'];
  maxLength?: number;
  className?: string;
}) {
  return (
    <div className={cn('min-w-0', className)}>
      <label htmlFor={id} className={fieldLabelClass}>
        {label}
      </label>
      <Input
        id={id}
        name={name}
        defaultValue={value ?? ''}
        placeholder={placeholder}
        inputMode={inputMode}
        maxLength={maxLength}
      />
    </div>
  );
}

export function NumberFilter({
  id,
  name,
  label,
  value,
  step,
}: {
  id: string;
  name: string;
  label: string;
  value?: string | number;
  step: string;
}) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className={fieldLabelClass}>
        {label}
      </label>
      <Input
        id={id}
        type="number"
        name={name}
        defaultValue={value ?? ''}
        min="0"
        step={step}
        inputMode={step === '1' ? 'numeric' : 'decimal'}
      />
    </div>
  );
}

export function DateField({
  id,
  name,
  label,
  value,
}: {
  id: string;
  name: string;
  label: string;
  value?: string;
}) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className={fieldLabelClass}>
        {label}
      </label>
      <Input id={id} type="date" name={name} defaultValue={value ?? ''} />
    </div>
  );
}

export function TriStateSelect({
  id,
  name,
  label,
  value,
  yesLabel,
  noLabel,
}: {
  id: string;
  name: string;
  label: string;
  value?: boolean;
  yesLabel: string;
  noLabel: string;
}) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className={fieldLabelClass}>
        {label}
      </label>
      <select
        id={id}
        name={name}
        defaultValue={value === undefined ? 'all' : value ? 'yes' : 'no'}
        className={selectClass}
      >
        <option value="all">全部</option>
        <option value="yes">{yesLabel}</option>
        <option value="no">{noLabel}</option>
      </select>
    </div>
  );
}

export function OptionSelect({
  id,
  name,
  label,
  emptyLabel,
  value,
  options,
}: {
  id: string;
  name: string;
  label: string;
  emptyLabel: string;
  value?: string;
  options: readonly OrderFilterOption[];
}) {
  const selectOptions = withSelectedOptions(options, value ? [value] : [], label);
  return (
    <div className="min-w-0">
      <label htmlFor={id} className={fieldLabelClass}>
        {label}
      </label>
      <select
        id={id}
        name={name}
        defaultValue={value ?? ''}
        className={selectClass}
      >
        <option value="">{emptyLabel}</option>
        {selectOptions.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function CheckboxGroup<T extends string>({
  legend,
  name,
  selected,
  options,
  emptyMessage,
  className,
  idPrefix = '',
}: {
  legend: string;
  name: string;
  selected: readonly T[];
  options: readonly { id: T; label: string }[];
  emptyMessage?: string;
  className?: string;
  /** 同一筛选器在响应式容器中出现时，保持 label/input id 全局唯一。 */
  idPrefix?: string;
}) {
  return (
    <fieldset className={cn('min-w-0', className)}>
      <legend className={fieldLabelClass}>{legend}</legend>
      {options.length > 0 ? (
        <div className="flex min-w-0 flex-wrap gap-x-3 gap-y-1 rounded-lg border border-border bg-background px-2 py-1 dark:bg-input/30">
          {options.map((option) => {
            const id = `${idPrefix}order-filter-${name}-${option.id}`;
            return (
              <label
                key={option.id}
                className="flex min-h-11 min-w-0 cursor-pointer items-center gap-2 text-sm text-foreground"
              >
                <Checkbox
                  id={id}
                  name={name}
                  value={option.id}
                  defaultChecked={selected.includes(option.id)}
                  aria-label={option.label}
                />
                <span className="admin-wrap-anywhere">{option.label}</span>
              </label>
            );
          })}
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          <input type="hidden" name={name} value="" />
          {emptyMessage ?? '暂无可选项'}
        </div>
      )}
    </fieldset>
  );
}

export function enumOptions<T extends string>(
  values: Record<string, T>,
  labels: Record<T, string> | ((value: T) => string),
): Array<{ id: T; label: string }> {
  return Object.values(values).map((value) => ({
    id: value,
    label: typeof labels === 'function' ? labels(value) : labels[value],
  }));
}

export function withSelectedOptions(
  options: readonly OrderFilterOption[],
  selectedIds: readonly string[],
  fallbackLabel: string,
): OrderFilterOption[] {
  const result = [...options];
  const known = new Set(result.map((option) => option.id));
  for (const id of selectedIds) {
    if (!known.has(id)) {
      result.push({ id, label: `${fallbackLabel}（${id}）` });
      known.add(id);
    }
  }
  return result;
}
