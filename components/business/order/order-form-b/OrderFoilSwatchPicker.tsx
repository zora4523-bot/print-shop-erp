'use client';

import Image from 'next/image';
import { ArrowDown, ArrowUp, X } from 'lucide-react';
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
  tone?: OrderFoilSwatchTone;
  /** Optional color supplied by the FOIL material catalog. */
  color?: string | null;
  /** Optional local image path for a real foil texture, for example /images/order/foil/matte-gold.png. */
  imageSrc?: string | null;
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
    backgroundColor: '#f7f7f5',
    backgroundImage:
      'linear-gradient(45deg, #d9dcdf 25%, transparent 25%), linear-gradient(-45deg, #d9dcdf 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #d9dcdf 75%), linear-gradient(-45deg, transparent 75%, #d9dcdf 75%)',
    backgroundPosition: '0 0, 0 5px, 5px -5px, -5px 0',
    backgroundSize: '10px 10px',
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

export function moveOrderFoilSelection({
  current,
  option,
  direction,
}: {
  current: readonly string[];
  option: string;
  direction: 'up' | 'down';
}): string[] {
  const next = [...new Set(current)];
  const fromIndex = next.indexOf(option);
  const toIndex = fromIndex + (direction === 'up' ? -1 : 1);
  if (fromIndex < 0 || toIndex < 0 || toIndex >= next.length) return next;
  [next[fromIndex], next[toIndex]] = [next[toIndex], next[fromIndex]];
  return next;
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
          <span className="ml-2 font-normal tracking-normal text-muted-foreground">
            最多 {maximum} 色
          </span>
        ) : null}
      </legend>
      <div className="flex min-w-0 flex-wrap gap-2">
        {options.map((option) => {
          const selectedIndex = selected.indexOf(option.value);
          const isSelected = selectedIndex >= 0;
          const imageSrc = option.imageSrc?.trim();
          const unavailable =
            disabled || option.disabled || (selectionFull && !isSelected);
          return (
            <Button
              key={option.value}
              type="button"
              variant="ghost"
              aria-pressed={isSelected}
              aria-label={
                isSelected && maximum > 1
                  ? `${option.label}，第 ${selectedIndex + 1} 色`
                  : option.label
              }
              disabled={unavailable}
              className={cn(
                'relative h-auto min-h-[3.75rem] w-[3.75rem] max-w-full flex-col gap-1 overflow-visible whitespace-normal rounded-lg border-transparent bg-transparent p-1 text-center transition-colors hover:bg-muted/50 hover:text-foreground disabled:bg-transparent disabled:opacity-40',
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
              <span
                aria-hidden="true"
                className={cn(
                  'relative block h-8 w-full overflow-hidden rounded-md border border-border/70 bg-muted transition-[border-color,box-shadow]',
                  isSelected &&
                    'border-transparent ring-2 ring-foreground ring-offset-1 ring-offset-background',
                )}
              >
                {imageSrc ? (
                  <Image
                    src={imageSrc}
                    alt=""
                    aria-hidden="true"
                    fill
                    sizes="3rem"
                    className="object-cover"
                  />
                ) : (
                  <span
                    className="absolute inset-0"
                    style={
                      option.color
                        ? { background: option.color }
                        : FOIL_TONE_STYLES[option.tone ?? 'clear']
                    }
                  />
                )}
              </span>
              {isSelected && maximum > 1 ? (
                <span
                  aria-hidden="true"
                  data-selection-order={selectedIndex + 1}
                  className="absolute right-0 top-0 z-10 flex size-4 items-center justify-center rounded-full border border-border bg-background text-xs font-bold leading-none text-foreground"
                >
                  {selectedIndex + 1}
                </span>
              ) : null}
              <span className="text-xs font-semibold leading-tight">
                {option.label}
              </span>
            </Button>
          );
        })}
      </div>
      <p
        id={statusId}
        aria-live="polite"
        className="text-xs font-medium text-muted-foreground"
      >
        已选 {selected.length}/{maximum}
        {selected.length > 0 ? (
          <span className="sr-only">
            ，选择顺序：
            {selected
              .map((color, index) => `第 ${index + 1} 色 ${color}`)
              .join(' · ')}
          </span>
        ) : null}
      </p>
      {maximum > 1 && selected.length > 0 ? (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">烫印顺序</p>
          <ol className="flex min-w-0 flex-wrap gap-1.5">
            {selected.map((color, index) => (
              <li
                key={color}
                data-order-color={color}
                className="inline-flex min-h-7 items-center gap-1 rounded-full bg-muted py-0.5 pl-2.5 pr-1 text-xs text-foreground"
              >
                <span className="font-semibold tabular-nums">{index + 1}</span>
                <span className="font-medium">{color}</span>
                <span className="ml-0.5 inline-flex items-center">
                  {selected.length > 1 ? (
                    <>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`将第 ${index + 1} 色 ${color} 上移`}
                        data-order-action="up"
                        disabled={disabled || index === 0}
                        className="size-11 rounded-full text-muted-foreground hover:bg-background hover:text-foreground disabled:bg-transparent disabled:opacity-30"
                        onBlur={onBlur}
                        onClick={() =>
                          onChange(
                            moveOrderFoilSelection({
                              current: selected,
                              option: color,
                              direction: 'up',
                            }),
                          )
                        }
                      >
                        <ArrowUp aria-hidden="true" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`将第 ${index + 1} 色 ${color} 下移`}
                        data-order-action="down"
                        disabled={disabled || index === selected.length - 1}
                        className="size-11 rounded-full text-muted-foreground hover:bg-background hover:text-foreground disabled:bg-transparent disabled:opacity-30"
                        onBlur={onBlur}
                        onClick={() =>
                          onChange(
                            moveOrderFoilSelection({
                              current: selected,
                              option: color,
                              direction: 'down',
                            }),
                          )
                        }
                      >
                        <ArrowDown aria-hidden="true" />
                      </Button>
                    </>
                  ) : null}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`移除第 ${index + 1} 色 ${color}`}
                    data-order-action="remove"
                    disabled={disabled || selected.length <= minimumSelections}
                    className="size-11 rounded-full text-muted-foreground hover:bg-background hover:text-foreground disabled:bg-transparent disabled:opacity-30"
                    onBlur={onBlur}
                    onClick={() =>
                      onChange(
                        nextOrderFoilSelection({
                          current: selected,
                          option: color,
                          maxSelections: maximum,
                          minimumSelections,
                        }),
                      )
                    }
                  >
                    <X aria-hidden="true" />
                  </Button>
                </span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
      {error ? (
        <p id={messageId} className="text-xs text-destructive">
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
