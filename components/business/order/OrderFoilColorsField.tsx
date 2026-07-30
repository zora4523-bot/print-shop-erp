'use client';

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  formatFoilColors,
  MAX_ORDER_ITEM_FOIL_COLORS,
  NO_FOIL_COLOR,
} from '@/lib/order/foil-colors';
import { ORDER_FOIL_COLOR_OPTIONS } from './order-item-options';

type Props = {
  id: string;
  value: string[];
  disabled?: boolean;
  error?: string;
  onChange: (value: string[]) => void;
  onBlur: () => void;
};

const PRESET_VALUES = new Set(
  ORDER_FOIL_COLOR_OPTIONS.map((option) => option.value),
);

export function OrderFoilColorsField({
  id,
  value,
  disabled = false,
  error,
  onChange,
  onBlur,
}: Props) {
  const customColors = useMemo(
    () => value.filter((color) => !PRESET_VALUES.has(color)),
    [value],
  );
  const [customOpen, setCustomOpen] = useState(customColors.length > 0);
  const [customDraft, setCustomDraft] = useState('');
  const [localMessage, setLocalMessage] = useState<string | null>(null);
  const helperId = `${id}-helper`;
  const errorId = `${id}-error`;
  const localMessageId = `${id}-local-message`;
  const describedBy = [
    helperId,
    error ? errorId : null,
    localMessage ? localMessageId : null,
  ]
    .filter(Boolean)
    .join(' ');

  function togglePreset(color: string) {
    setLocalMessage(null);
    if (value.includes(color)) {
      onChange(value.filter((entry) => entry !== color));
      return;
    }

    if (color === NO_FOIL_COLOR) {
      setCustomOpen(false);
      onChange([NO_FOIL_COLOR]);
      return;
    }

    const withoutNoColor = value.filter((entry) => entry !== NO_FOIL_COLOR);
    if (withoutNoColor.length >= MAX_ORDER_ITEM_FOIL_COLORS) {
      setLocalMessage(`最多选择 ${MAX_ORDER_ITEM_FOIL_COLORS} 种烫金颜色`);
      return;
    }
    onChange([...withoutNoColor, color]);
  }

  function addCustomColor() {
    const color = customDraft.trim();
    if (!color) {
      setLocalMessage('请输入自定义颜色或色号');
      return;
    }
    if (PRESET_VALUES.has(color)) {
      setLocalMessage(`“${color}”已有快捷选项，请直接勾选`);
      return;
    }
    if (value.includes(color)) {
      setLocalMessage(`“${color}”已经添加`);
      return;
    }

    const withoutNoColor = value.filter((entry) => entry !== NO_FOIL_COLOR);
    if (withoutNoColor.length >= MAX_ORDER_ITEM_FOIL_COLORS) {
      setLocalMessage(`最多选择 ${MAX_ORDER_ITEM_FOIL_COLORS} 种烫金颜色`);
      return;
    }

    onChange([...withoutNoColor, color]);
    setCustomDraft('');
    setLocalMessage(null);
  }

  return (
    <fieldset
      className="min-w-0 space-y-2"
      aria-invalid={Boolean(error || localMessage)}
      aria-describedby={describedBy}
    >
      <legend className="text-sm font-medium">烫金色（可多选）</legend>
      <p id={helperId} className="text-xs text-muted-foreground">
        最多选择 {MAX_ORDER_ITEM_FOIL_COLORS} 色；“{NO_FOIL_COLOR}
        ”会清除其他颜色
      </p>

      <div className="flex min-w-0 flex-wrap gap-2">
        {ORDER_FOIL_COLOR_OPTIONS.map((option) => {
          const selected = value.includes(option.value);
          return (
            <Button
              key={option.value}
              type="button"
              variant="outline"
              size="sm"
              aria-pressed={selected}
              disabled={disabled}
              className={
                selected
                  ? 'min-h-10 min-w-0 shrink gap-2 whitespace-normal border-primary bg-primary/10 px-3 py-2 text-primary hover:bg-primary/15 hover:text-primary'
                  : 'min-h-10 min-w-0 shrink gap-2 whitespace-normal border-input bg-background px-3 py-2 text-foreground hover:bg-muted'
              }
              onClick={() => togglePreset(option.value)}
            >
              <span
                aria-hidden="true"
                className={
                  selected
                    ? 'flex size-4 shrink-0 items-center justify-center rounded border border-primary bg-primary text-[10px] text-primary-foreground'
                    : 'block size-4 shrink-0 rounded border border-input'
                }
              >
                {selected ? '✓' : ''}
              </span>
              {option.label}
            </Button>
          );
        })}
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-expanded={customOpen}
          disabled={disabled}
          className="min-h-10 min-w-0 shrink whitespace-normal border-dashed border-input bg-background px-3 py-2 text-foreground hover:bg-muted"
          onClick={() => {
            setCustomOpen((current) => !current);
            setLocalMessage(null);
          }}
        >
          添加其他色
        </Button>
      </div>

      {customOpen ? (
        <div className="max-w-xl space-y-2 pt-1">
          <label
            htmlFor={`${id}-custom`}
            className="text-xs font-medium text-muted-foreground"
          >
            自定义烫金色 / 色号
          </label>
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
            <Input
              id={`${id}-custom`}
              value={customDraft}
              maxLength={32}
              disabled={disabled}
              placeholder="例如：古铜金、潘通 871C"
              aria-invalid={Boolean(localMessage)}
              aria-describedby={localMessage ? localMessageId : helperId}
              onBlur={onBlur}
              onChange={(event) => {
                setCustomDraft(event.target.value);
                setLocalMessage(null);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  addCustomColor();
                }
              }}
            />
            <Button
              type="button"
              variant="outline"
              className="min-h-10 sm:shrink-0"
              disabled={disabled}
              onClick={addCustomColor}
            >
              添加颜色
            </Button>
          </div>
        </div>
      ) : null}

      {customColors.length > 0 ? (
        <ul className="flex flex-wrap gap-2" aria-label="已添加的自定义颜色">
          {customColors.map((color) => (
            <li key={color}>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="min-h-10 whitespace-normal"
                disabled={disabled}
                aria-label={`移除自定义颜色：${color}`}
                onClick={() =>
                  onChange(value.filter((entry) => entry !== color))
                }
              >
                {color} ×
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      {value.length > 0 ? (
        <p aria-live="polite" className="text-xs font-medium text-foreground">
          {value.includes(NO_FOIL_COLOR)
            ? `已选：${NO_FOIL_COLOR}`
            : `已选 ${value.length} 色：${formatFoilColors(value)}`}
        </p>
      ) : null}
      {localMessage ? (
        <p
          id={localMessageId}
          role="alert"
          className="text-xs text-destructive"
        >
          {localMessage}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
