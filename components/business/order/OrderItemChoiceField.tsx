'use client';

import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { OrderItemQuickOption } from './order-item-options';

type Props = {
  id: string;
  label: string;
  value: string | null;
  options: readonly OrderItemQuickOption[];
  customLabel: string;
  customInputLabel: string;
  customPlaceholder: string;
  maxLength: number;
  disabled?: boolean;
  error?: string;
  onChange: (value: string | null) => void;
  onBlur: () => void;
};

type ChoicePresentationInput = {
  value: string | null;
  options: readonly OrderItemQuickOption[];
  isEditingCustom: boolean;
  customDraft: string;
};

/**
 * Keep the controlled value authoritative while protecting the text currently
 * being edited. This also lets a value supplied by another field (for example,
 * a SKU specification) immediately reveal the custom input when it is not one
 * of the quick options.
 */
export function resolveOrderItemChoicePresentation({
  value,
  options,
  isEditingCustom,
  customDraft,
}: ChoicePresentationInput) {
  const controlledCustomSelected = Boolean(
    value && !options.some((option) => option.value === value),
  );
  const customSelected = isEditingCustom || controlledCustomSelected;

  return {
    controlledCustomSelected,
    customSelected,
    customInputValue: isEditingCustom
      ? customDraft
      : controlledCustomSelected
        ? (value ?? '')
        : customDraft,
  };
}

export function OrderItemChoiceField({
  id,
  label,
  value,
  options,
  customLabel,
  customInputLabel,
  customPlaceholder,
  maxLength,
  disabled = false,
  error,
  onChange,
  onBlur,
}: Props) {
  const initialIsCustom = Boolean(
    value && !options.some((option) => option.value === value),
  );
  const [isEditingCustom, setIsEditingCustom] = useState(false);
  const [customDraft, setCustomDraft] = useState(
    initialIsCustom ? (value ?? '') : '',
  );
  const customInputRef = useRef<HTMLInputElement>(null);
  const messageId = `${id}-message`;
  const {
    controlledCustomSelected,
    customSelected,
    customInputValue,
  } = resolveOrderItemChoicePresentation({
    value,
    options,
    isEditingCustom,
    customDraft,
  });

  function selectPreset(optionValue: string) {
    if (!customSelected && value === optionValue) {
      onChange(null);
      return;
    }
    if (controlledCustomSelected) {
      setCustomDraft(value ?? '');
    }
    setIsEditingCustom(false);
    onChange(optionValue);
  }

  function toggleCustom() {
    if (customSelected) {
      if (controlledCustomSelected) {
        setCustomDraft(value ?? '');
      }
      setIsEditingCustom(false);
      onChange(null);
      return;
    }

    setIsEditingCustom(true);
    onChange(customDraft);
    requestAnimationFrame(() => customInputRef.current?.focus());
  }

  return (
    <fieldset
      className="min-w-0 space-y-2"
      aria-invalid={Boolean(error)}
      aria-describedby={error ? `${messageId} ${id}-error` : messageId}
    >
      <legend className="text-sm font-medium">{label}</legend>
      <p id={messageId} className="text-xs text-muted-foreground">
        直接点击选择；再次点击已选项可清除
      </p>
      <div className="flex min-w-0 flex-wrap gap-2">
        {options.map((option) => {
          const selected = !customSelected && value === option.value;
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
                  ? 'min-h-10 min-w-0 shrink whitespace-normal border-primary bg-primary/10 px-3 py-2 text-primary hover:bg-primary/15 hover:text-primary'
                  : 'min-h-10 min-w-0 shrink whitespace-normal border-input bg-background px-3 py-2 text-foreground hover:bg-muted'
              }
              onClick={() => selectPreset(option.value)}
            >
              {option.label}
            </Button>
          );
        })}
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-pressed={customSelected}
          disabled={disabled}
          className={
            customSelected
              ? 'min-h-10 min-w-0 shrink whitespace-normal border-primary bg-primary/10 px-3 py-2 text-primary hover:bg-primary/15 hover:text-primary'
              : 'min-h-10 min-w-0 shrink whitespace-normal border-dashed border-input bg-background px-3 py-2 text-foreground hover:bg-muted'
          }
          onClick={toggleCustom}
        >
          {customLabel}
        </Button>
      </div>

      {customSelected ? (
        <div className="max-w-xl space-y-1 pt-1">
          <label
            htmlFor={`${id}-custom`}
            className="text-xs font-medium text-muted-foreground"
          >
            {customInputLabel}
          </label>
          <Input
            ref={customInputRef}
            id={`${id}-custom`}
            value={customInputValue}
            maxLength={maxLength}
            disabled={disabled}
            placeholder={customPlaceholder}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? `${id}-error` : undefined}
            onFocus={() => {
              if (!isEditingCustom) {
                if (controlledCustomSelected) {
                  setCustomDraft(value ?? '');
                }
                setIsEditingCustom(true);
              }
            }}
            onBlur={() => {
              setIsEditingCustom(false);
              onBlur();
            }}
            onChange={(event) => {
              const next = event.target.value;
              setCustomDraft(next);
              onChange(next);
            }}
          />
        </div>
      ) : null}

      {error ? (
        <p id={`${id}-error`} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
