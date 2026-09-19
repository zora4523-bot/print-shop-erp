'use client';

import { foilColorLabel } from '@/lib/order/foil-colors';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { MAX_ORDER_ITEM_FOIL_COLORS_PER_SIDE } from '@/lib/order/pricing-route';

/** Uses the same material names as create-order; saved historical colors remain visible. */
export function OrderFoilColorPicker({
  label,
  selected,
  options,
  disabled,
  allowNone = false,
  collapsedCount = 2,
  onChange,
}: {
  label: string;
  selected: string[];
  options: readonly string[];
  disabled: boolean;
  allowNone?: boolean;
  collapsedCount?: number;
  onChange: (colors: string[]) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const choices = [...new Set([...options, ...selected])];
  const visible = expanded
    ? choices
    : choices.filter(
        (color, index) => index < collapsedCount || selected.includes(color),
      );
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {allowNone ? (
        <Button
          type="button"
          variant={selected.length === 0 ? 'secondary' : 'outline'}
          aria-pressed={selected.length === 0}
          disabled={disabled}
          className="min-h-11 rounded-full px-3 text-xs"
          onClick={() => onChange([])}
        >
          不烫
        </Button>
      ) : null}
      {visible.map((color) => (
        <Button
          key={color}
          type="button"
          variant={selected.includes(color) ? 'secondary' : 'outline'}
          aria-pressed={selected.includes(color)}
          disabled={
            disabled ||
            (!allowNone && selected.length === 1 && selected.includes(color)) ||
            (!selected.includes(color) &&
              selected.length >= MAX_ORDER_ITEM_FOIL_COLORS_PER_SIDE)
          }
          className="min-h-11 rounded-full px-3 text-xs"
          onClick={() =>
            onChange(
              selected.includes(color)
                ? selected.filter((value) => value !== color)
                : [...selected, color],
            )
          }
        >
          {foilColorLabel(color)}
        </Button>
      ))}
      {choices.length > visible.length ? (
        <Button
          type="button"
          variant="ghost"
          className="min-h-11 px-2 text-xs"
          aria-label="更多颜色"
          aria-expanded={expanded}
          onClick={() => setExpanded(true)}
        >
          更多
        </Button>
      ) : null}
    </div>
  );
}
