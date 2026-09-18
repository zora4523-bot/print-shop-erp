'use client';

import { useRef, type ClipboardEventHandler, type ReactNode } from 'react';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import {
  parseReceiverAddressInput,
  pastedTextareaValue,
  type ParsedReceiverAddress,
  type ReceiverFactSource,
} from '@/lib/order/receiver-address-paste';

export const RECEIVER_ADDRESS_PASTE_PLACEHOLDER = '粘贴电商后台地址串，自动拆分';

type Props = {
  /** Textarea id; create forms keep the `-receiver-address-paste` suffix that tests target. */
  id: string;
  /** Set for native `<form action>` submissions. */
  name?: string;
  value: string;
  /** `source` tells the parent whether to overwrite (paste) or only fill blanks (typing). */
  onChange: (value: string, parsed: ParsedReceiverAddress, source: ReceiverFactSource) => void;
  /**
   * Overrides the default paste handling. By default the browser inserts the
   * text natively (so form-level onChange / dirty tracking still fire) and the
   * change that follows is reported as `paste`.
   */
  onPaste?: ClipboardEventHandler<HTMLTextAreaElement>;
  label?: ReactNode;
  /** A complete label element, for forms with their own label primitive. */
  labelElement?: ReactNode;
  required?: boolean;
  disabled?: boolean;
  maxLength?: number;
  placeholder?: string;
  invalid?: boolean;
  describedBy?: string;
  /** Parsed 地址 / 平台码 rows under the textarea; on by default. */
  preview?: boolean;
  /** Contact fields shown at the top of the preview box (create forms). */
  children?: ReactNode;
  /** Error message slot rendered right after the textarea. */
  after?: ReactNode;
  className?: string;
  textareaClassName?: string;
};

/**
 * The one delivery-address input. Pasting a whole receiver string splits it
 * into contact facts for the parent; the textarea grows with its content so
 * the full pasted text stays visible.
 */
export function ReceiverAddressPasteField({
  id,
  name,
  value,
  onChange,
  onPaste,
  label = '收货地址',
  labelElement,
  required = false,
  disabled = false,
  maxLength,
  placeholder = RECEIVER_ADDRESS_PASTE_PLACEHOLDER,
  invalid,
  describedBy,
  preview = true,
  children,
  after,
  className,
  textareaClassName,
}: Props) {
  const parsed = parseReceiverAddressInput(value);
  const showPreview = preview && value.trim().length > 0;
  // Set on paste, consumed by the input event the browser fires right after.
  // Cleared on the next tick in case the paste inserted nothing (maxLength).
  const pasteRef = useRef(false);
  return (
    <div className={cn('min-w-0', className)}>
      {labelElement ?? (
        <Label htmlFor={id} className="mb-2 block">
          {label}
          {required ? (
            <span aria-hidden="true" className="text-destructive">
              *
            </span>
          ) : null}
        </Label>
      )}
      <Textarea
        id={id}
        name={name}
        value={value}
        required={required}
        aria-required={required ? 'true' : undefined}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        disabled={disabled}
        maxLength={maxLength}
        placeholder={placeholder}
        rows={3}
        className={cn('min-h-24 field-sizing-content', textareaClassName)}
        onPaste={
          onPaste ??
          ((event) => {
            const next = pastedTextareaValue(event);
            if (next === value) {
              // Re-pasting the same text changes nothing in the DOM, so no
              // input event follows; still let the parent re-apply the facts.
              onChange(next, parseReceiverAddressInput(next), 'paste');
              return;
            }
            pasteRef.current = true;
            setTimeout(() => {
              pasteRef.current = false;
            }, 0);
          })
        }
        onChange={(event) => {
          const source: ReceiverFactSource = pasteRef.current ? 'paste' : 'input';
          pasteRef.current = false;
          onChange(event.target.value, parseReceiverAddressInput(event.target.value), source);
        }}
      />
      {after}
      {showPreview ? (
        <div className="mt-3 overflow-hidden rounded-xl border">
          {children ? <div className="border-b p-3">{children}</div> : null}
          <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-center px-3 py-2.5">
            <span className="text-xs font-bold tracking-[0.14em] text-muted-foreground">
              地址
            </span>
            <p className="min-w-0 break-words text-sm font-semibold">
              {parsed.address || '—'}
            </p>
          </div>
          {parsed.platformCode ? (
            <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-center border-t px-3 py-2.5">
              <span className="text-xs font-bold tracking-[0.14em] text-muted-foreground">
                平台码
              </span>
              <p className="min-w-0 break-words font-mono text-sm font-semibold">
                {parsed.platformCode}
              </p>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
