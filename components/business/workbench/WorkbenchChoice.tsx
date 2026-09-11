'use client';

import { Select } from '@base-ui/react/select';
import { Check, ChevronDown } from 'lucide-react';
import { useId } from 'react';
import { DisabledReason } from '@/components/ui-business';

export function WorkbenchChoice({
  label,
  value,
  options,
  onChange,
  description,
}: {
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
  description?: string | null;
}) {
  const id = useId();
  const descriptionId = `${id}-description`;
  return (
    <div className="min-w-0 space-y-2">
      <span id={id} className="text-sm font-medium">
        {label}
      </span>
      <Select.Root
        value={value || null}
        onValueChange={(next) => onChange(next ?? '')}
        items={options}
        disabled={options.length === 0}
      >
        <Select.Trigger
          aria-labelledby={id}
          aria-describedby={description ? descriptionId : undefined}
          className="flex min-h-11 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 py-2 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Select.Value
            className="min-w-0 break-words"
            placeholder={options.length ? '请选择' : '暂无可选项'}
          />
          <Select.Icon>
            <ChevronDown aria-hidden className="size-4 shrink-0" />
          </Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          <Select.Positioner
            sideOffset={4}
            className="z-50 max-w-full"
            alignItemWithTrigger={false}
          >
            <Select.Popup className="max-h-80 max-w-sm overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
              <Select.List>
                {options.map((option) => (
                  <Select.Item
                    key={option.value}
                    value={option.value}
                    className="flex min-h-11 cursor-default items-center gap-2 rounded-md px-3 py-2 text-sm outline-none data-highlighted:bg-muted"
                  >
                    <Select.ItemText className="break-words">
                      {option.label}
                    </Select.ItemText>
                    <Select.ItemIndicator>
                      <Check aria-hidden className="size-4" />
                    </Select.ItemIndicator>
                  </Select.Item>
                ))}
              </Select.List>
            </Select.Popup>
          </Select.Positioner>
        </Select.Portal>
      </Select.Root>
      {description && (
        <div id={descriptionId}>
          <DisabledReason cause="prerequisite" reason={description} />
        </div>
      )}
    </div>
  );
}
