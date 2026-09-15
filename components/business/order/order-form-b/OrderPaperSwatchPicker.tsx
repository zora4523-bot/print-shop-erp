'use client';

import type { CSSProperties } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type OrderPaperSwatchTexture =
  | 'pearl'
  | 'pearl-red'
  | 'variegated-pearl'
  | 'solid-red'
  | 'matte-red'
  | 'glitter-red'
  | 'linen-red'
  | 'ice-white'
  | 'coated-white';

export type OrderPaperSwatchOption = {
  value: string;
  label: string;
  texture: OrderPaperSwatchTexture;
  disabled?: boolean;
};

export type OrderPaperSwatchPickerProps = {
  id: string;
  label?: string;
  value: string | null;
  options: readonly OrderPaperSwatchOption[];
  disabled?: boolean;
  hint?: string;
  error?: string;
  className?: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
};

const PAPER_TEXTURE_STYLES: Record<OrderPaperSwatchTexture, CSSProperties> = {
  pearl: {
    background:
      'linear-gradient(115deg, #d4262e, #f4535c 32%, #fff0f0 44%, #e03a43 58%, #b81c25)',
  },
  'pearl-red': {
    background:
      'linear-gradient(115deg, #a80f18, #d8323c 34%, #ffdada 46%, #c02630 60%, #8e0d15)',
  },
  'variegated-pearl': {
    background:
      'linear-gradient(115deg, #7b4b9c, #c86ea8 30%, #fff2f8 44%, #5a7fc0 62%, #3f9c8a)',
  },
  'solid-red': { background: '#c2181f' },
  'matte-red': {
    background: 'linear-gradient(160deg, #a81620, #8e1119)',
    boxShadow: 'inset 0 0 18px rgb(0 0 0 / 28%)',
  },
  'glitter-red': {
    backgroundColor: '#b8151f',
    backgroundImage:
      'radial-gradient(circle at 18% 22%, #ffe8a8 0.7px, transparent 0.8px), radial-gradient(circle at 62% 44%, #ffdf8f 0.8px, transparent 0.9px), radial-gradient(circle at 34% 72%, #ffe8a8 0.7px, transparent 0.8px), radial-gradient(circle at 82% 78%, #ffd97a 0.8px, transparent 0.9px), radial-gradient(circle at 48% 16%, #fff0c0 0.6px, transparent 0.7px)',
    backgroundSize: '16px 16px, 21px 21px, 18px 18px, 25px 25px, 13px 13px',
  },
  'linen-red': {
    background: 'repeating-linear-gradient(58deg, #b31620 0 3px, #9c1119 3px 5px)',
  },
  'ice-white': { background: 'linear-gradient(150deg, #fdfdfd, #eef1f4)' },
  'coated-white': {
    background: 'linear-gradient(150deg, #fbfbf9, #e7e5df)',
  },
};

export function OrderPaperSwatchPicker({
  id,
  label = '纸张材质',
  value,
  options,
  disabled = false,
  hint,
  error,
  className,
  onChange,
  onBlur,
}: OrderPaperSwatchPickerProps) {
  const messageId = `${id}-message`;

  return (
    <fieldset
      className={cn('min-w-0 space-y-2', className)}
      aria-invalid={Boolean(error)}
      aria-describedby={error || hint ? messageId : undefined}
    >
      <legend className="text-xs font-semibold tracking-[0.16em] text-muted-foreground">
        {label}
      </legend>
      <div className="flex min-w-0 flex-wrap gap-2.5">
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Button
              key={option.value}
              type="button"
              variant="outline"
              aria-pressed={selected}
              disabled={disabled || option.disabled}
              className={cn(
                'h-auto min-h-16 w-[5.375rem] flex-col items-stretch gap-1.5 whitespace-normal rounded-lg p-1.5 text-left transition-transform hover:-translate-y-px hover:border-foreground motion-reduce:transform-none',
                selected &&
                  'border-foreground ring-2 ring-foreground hover:bg-background',
              )}
              onBlur={onBlur}
              onClick={() => onChange(option.value)}
            >
              <span
                aria-hidden="true"
                className="block h-11 w-full overflow-hidden rounded-md border border-border/60"
                style={PAPER_TEXTURE_STYLES[option.texture]}
              />
              <span className="block text-xs font-semibold leading-tight">
                {option.label}
              </span>
            </Button>
          );
        })}
      </div>
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
