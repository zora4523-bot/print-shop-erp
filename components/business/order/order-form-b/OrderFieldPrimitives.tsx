'use client';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
type PillOption<T extends string | number> = {
  value: T;
  label: string;
  detail?: string;
  disabled?: boolean;
};

export function RequiredMark() {
  return (
    <span aria-hidden="true" className="ml-0.5 font-bold text-destructive">
      *
    </span>
  );
}

export function FieldLabel({
  htmlFor,
  children,
  required = false,
}: {
  htmlFor?: string;
  children: ReactNode;
  required?: boolean;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="mb-2 block text-xs font-bold tracking-[0.16em] text-muted-foreground"
    >
      {children}
      {required ? <RequiredMark /> : null}
    </label>
  );
}

export function FieldError({
  id,
  children,
  hint,
  reservedLines,
}: {
  id?: string;
  children?: string;
  hint?: ReactNode;
  reservedLines?: 1 | 2;
}) {
  if (!children && !hint && !reservedLines) return null;
  return (
    <p
      id={id}
      role={children ? 'alert' : undefined}
      aria-hidden={!children && !hint ? true : undefined}
      className={cn(
        'mt-1.5 flex items-start gap-1.5 text-xs',
        children ? 'font-semibold text-destructive' : 'text-muted-foreground',
        reservedLines === 1 && 'min-h-4',
        reservedLines === 2 && 'min-h-8',
      )}
    >
      {children ? (
        <span
          aria-hidden="true"
          className="mt-px flex size-3.5 shrink-0 items-center justify-center rounded-full bg-destructive text-xs text-destructive-foreground"
        >
          !
        </span>
      ) : null}
      <span>{children || hint}</span>
    </p>
  );
}

export function PillPicker<T extends string | number>({
  id,
  label,
  value,
  options,
  disabled,
  required,
  note,
  error,
  onChange,
}: {
  id: string;
  label: string;
  value: T;
  options: readonly PillOption<T>[];
  disabled?: boolean;
  required?: boolean;
  note?: string;
  error?: string;
  onChange: (value: T) => void;
}) {
  const messageId = `${id}-message`;
  return (
    <fieldset
      className="min-w-0"
      aria-invalid={Boolean(error)}
      aria-describedby={error ? messageId : undefined}
    >
      <legend className="mb-2 text-xs font-bold tracking-[0.16em] text-muted-foreground">
        {label}
        {required ? <RequiredMark /> : null}
        {note ? (
          <span className="ml-2 text-xs tracking-normal text-destructive">
            {note}
          </span>
        ) : null}
      </legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Button
              key={String(option.value)}
              id={`${id}-${String(option.value)}`}
              type="button"
              variant="outline"
              aria-pressed={selected}
              disabled={disabled || option.disabled}
              className={cn(
                'h-auto min-h-11 min-w-11 rounded-full px-3.5 py-1.5 text-sm font-semibold',
                option.detail && 'flex-col gap-0 py-1',
                selected &&
                  'border-foreground bg-foreground text-background hover:bg-foreground hover:text-background dark:border-foreground dark:bg-foreground dark:text-background dark:hover:bg-foreground dark:hover:text-background',
              )}
              onClick={() => onChange(option.value)}
            >
              <span>{option.label}</span>
              {option.detail ? (
                <span className="text-xs font-medium opacity-60">
                  {option.detail}
                </span>
              ) : null}
            </Button>
          );
        })}
      </div>
      <FieldError id={messageId}>{error}</FieldError>
    </fieldset>
  );
}

export function Group({
  title,
  children,
  first = false,
}: {
  title: string;
  children: ReactNode;
  first?: boolean;
}) {
  return (
    <section
      aria-label={title}
      className={cn('border-t pt-4', first ? 'border-0 pt-0' : 'mt-4')}
    >
      <h2 className="mb-3.5 text-xs font-extrabold tracking-[0.2em] text-muted-foreground">
        {title}
      </h2>
      {children}
    </section>
  );
}
