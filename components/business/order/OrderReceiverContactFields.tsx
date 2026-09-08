'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type Props = {
  idPrefix?: string;
  controlled?: boolean;
  receiverName: string | null;
  receiverPhone: string | null;
  nameField?: string;
  phoneField?: string;
  disabled?: boolean;
  required?: boolean;
  nameRequired?: boolean;
  phoneRequired?: boolean;
  errors?: { receiverName?: string; receiverPhone?: string };
  onNameChange?: (value: string) => void;
  onPhoneChange?: (value: string) => void;
};

/** Shared by create and edit: the contact fields are separate persisted facts. */
export function OrderReceiverContactFields({
  idPrefix = '',
  controlled = false,
  receiverName,
  receiverPhone,
  nameField = 'receiverName',
  phoneField = 'receiverPhone',
  disabled = false,
  required = false,
  nameRequired = required,
  phoneRequired = required,
  errors,
  onNameChange,
  onPhoneChange,
}: Props) {
  // Parents key this field group by its saved version/address snapshot.
  // Preserve an explicitly cleared value instead of reapplying parsed defaults.
  const [name, setName] = useState(receiverName ?? '');
  const [phone, setPhone] = useState(receiverPhone ?? '');
  return (
    <div className="grid min-w-0 gap-4 sm:grid-cols-2">
      {(
        [
          {
            id: idPrefix ? `${idPrefix}-receiver-name` : nameField,
            name: nameField,
            label: '收件人',
            value: controlled ? receiverName ?? '' : name,
            setValue: setName,
            required: nameRequired,
            error: errors?.receiverName,
            change: onNameChange,
            type: 'text',
            maxLength: 64,
          },
          {
            id: idPrefix ? `${idPrefix}-receiver-phone` : phoneField,
            name: phoneField,
            label: '收货电话',
            value: controlled ? receiverPhone ?? '' : phone,
            setValue: setPhone,
            required: phoneRequired,
            error: errors?.receiverPhone,
            change: onPhoneChange,
            type: 'tel',
            maxLength: 32,
          },
        ] as const
      ).map((field) => (
        <div key={field.id} className="min-w-0 space-y-1.5">
          <Label htmlFor={field.id}>
            {field.label}
            {field.required ? (
              <span aria-hidden="true" className="text-destructive">
                *
              </span>
            ) : null}
          </Label>
          <Input
            id={field.id}
            name={field.name}
            type={field.type}
            value={field.value}
            maxLength={field.maxLength}
            disabled={disabled}
            required={field.required}
            aria-required={field.required || undefined}
            aria-invalid={Boolean(field.error)}
            aria-describedby={field.error ? `${field.id}-error` : undefined}
            className="min-h-11"
            onChange={(event) => {
              field.setValue(event.target.value);
              field.change?.(event.target.value);
            }}
          />
          {field.error ? (
            <p id={`${field.id}-error`} className="text-xs text-destructive">
              {field.error}
            </p>
          ) : null}
        </div>
      ))}
    </div>
  );
}
