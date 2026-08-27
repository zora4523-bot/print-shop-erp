'use client';

import type { CSSProperties } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type OrderFoilSwatchTone =
  | 'matte-gold'
  | 'light-gold'
  | 'red'
  | 'black'
  | 'silver'
  | 'blue'
  | 'clear'
  | 'green';

export type OrderFoilSwatchOption = {
  value: string;
  label: string;
  tone: OrderFoilSwatchTone;
  disabled?: boolean;
};

export type OrderFoilSwatchPickerProps = {
  id: string;
  label?: string;
  value: readonly string[];
  options: readonly OrderFoilSwatchOption[];
  maxSelections?: number;
  minimumSelections?: number;
  disabled?: boolean;
  hint?: string;
  error?: string;
  className?: string;
  onChange: (value: string[]) => void;
  onBlur?: () => void;
};

const FOIL_TONE_STYLES: Record<OrderFoilSwatchTone, CSSProperties> = {
  'matte-gold': {
    background:
      'linear-gradient(140deg, #e8cd83, #b98f2c 46%, #f3e0a8 62%, #a87c1f)',
  },
  'light-gold': {
    background:
      'linear-gradient(140deg, #f7edcf, #dcc590 50%, #fffaf0)',
  },
  red: {
    background: 'linear-gradient(140deg, #e04a52, #a8121a 55%, #f08c92)',
  },
  black: {
    background: 'linear-gradient(140deg, #4a4c52, #17181c 55%, #6a6c74)',
  },
  silver: {
    background:
      'linear-gradient(140deg, #e9ecef, #a8adb5 48%, #fdfdfd 64%, #8f959d)',
  },
  blue: {
    background: 'linear-gradient(140deg, #5b8fd4, #1f4f96 55%, #8fb8e8)',
  },
  clear: {
    background:
      'linear-gradient(140deg, #f2f2f0, #dcdcd8 50%, #fbfbfa)',
    opacity: 0.75,
  },
  green: {
    background: 'linear-gradient(140deg, #4f9c72, #1f6944 55%, #86c9a2)',
  },
};

export function nextOrderFoilSelection({
  current,
  option,
  maxSelections,
  minimumSelections,
}: {
  current: readonly string[];
  option: string;
  maxSelections: number;
  minimumSelections: number;
}): string[] {
  const uniqueCurrent = [...new Set(current)];
  const maximum = Math.max(1, Math.floor(maxSelections));
  const minimum = Math.min(maximum, Math.max(0, Math.floor(minimumSelections)));
  const selectedIndex = uniqueCurrent.indexOf(option);

  if (selectedIndex >= 0) {
    return uniqueCurrent.length <= minimum
      ? uniqueCurrent
      : uniqueCurrent.filter((value) => value !== option);
  }
  if (maximum === 1) return [option];
  if (uniqueCurrent.length >= maximum) return uniqueCurrent;
  return [...uniqueCurrent, option];
}

function colorCountLabel(count: number): string {
  if (count === 1) return '单色';
  if (count === 2) return '双色';
  if (count === 3) return '三色';
  return `${count} 色`;
}

export function OrderFoilSwatchPicker({
  id,
  label = '烫金颜色',
  value,
  options,
  maxSelections = 3,
  minimumSelections = 1,
  disabled = false,
  hint,
  error,
  className,
  onChange,
  onBlur,
}: OrderFoilSwatchPickerProps) {
  const maximum = Math.max(1, Math.floor(maxSelections));
  const selected = [...new Set(value)];
  const selectionFull = selected.length >= maximum;
  const messageId = `${id}-message`;
  const statusId = `${id}-status`;

  return (
    <fieldset
      className={cn('min-w-0 space-y-2', className)}
      aria-invalid={Boolean(error)}
      aria-describedby={
        [statusId, error || hint ? messageId : null].filter(Boolean).join(' ')
      }
    >
      <legend className="text-xs font-semibold tracking-[0.16em] text-muted-foreground">
        {label}
        {maximum > 1 ? (
          <span className="ml-2 tracking-normal text-destructive">
            最多 {maximum} 色
          </span>
        ) : null}
      </legend>
      <div className="flex min-w-0 flex-wrap gap-2">
        {options.map((option) => {
          const selectedIndex = selected.indexOf(option.value);
          const isSelected = selectedIndex >= 0;
          const unavailable =
            disabled || option.disabled || (selectionFull && !isSelected);
          return (
            <Button
              key={option.value}
              type="button"
              variant="outline"
              aria-pressed={isSelected}
              aria-label={
                isSelected && maximum > 1
                  ? `${option.label}，第 ${selectedIndex + 1} 色`
                  : option.label
              }
              disabled={unavailable}
              className={cn(
                'relative h-auto min-h-14 w-14 flex-col gap-1 whitespace-normal rounded-lg p-1 text-center hover:border-foreground',
                isSelected &&
                  'border-foreground ring-2 ring-foreground hover:bg-background',
              )}
              onBlur={onBlur}
              onClick={() => {
                const next = nextOrderFoilSelection({
                  current: selected,
                  option: option.value,
                  maxSelections: maximum,
                  minimumSelections,
                });
                if (next.join('\u0000') !== selected.join('\u0000')) onChange(next);
              }}
            >
              {isSelected && maximum > 1 ? (
                <span className="absolute -right-1.5 -top-1.5 flex size-[1.125rem] items-center justify-center rounded-full border border-background bg-foreground text-[9px] font-bold text-background">
                  {selectedIndex + 1}
                </span>
              ) : null}
              <span
                aria-hidden="true"
                className="block h-[1.875rem] w-full rounded-[5px] border border-border/50"
                style={FOIL_TONE_STYLES[option.tone]}
              />
              <span className="text-[0.65625rem] font-semibold leading-tight">
                {option.label}
              </span>
            </Button>
          );
        })}
      </div>
      <p
        id={statusId}
        aria-live="polite"
        className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs font-medium"
      >
        <span className={selected.length > 1 ? 'text-destructive' : undefined}>
          {colorCountLabel(selected.length)}
        </span>
        {selected.length > 0 ? (
          <span className="text-muted-foreground">
            {selected.map((color, index) => `色${index + 1} ${color}`).join(' · ')}
          </span>
        ) : null}
        {selectionFull ? (
          <span className="text-muted-foreground">已选满，取消一个再换</span>
        ) : null}
      </p>
      {error ? (
        <p id={messageId} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p id={messageId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </fieldset>
  );
}
