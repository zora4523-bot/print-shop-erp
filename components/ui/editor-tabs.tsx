'use client';

import type { Ref } from 'react';
import { Button } from '@/components/ui/button';

/** Controlled tabs for an editor that retains its form state outside the panel. */
export function EditorTabs({ id, label, tabs, value, disabled, onChange, ref }: {
  id: string;
  label: string;
  tabs: readonly { value: string; label: string }[];
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  ref?: Ref<HTMLDivElement>;
}) {
  return <div ref={ref} role="tablist" aria-label={label} className="flex min-w-0 flex-wrap gap-2">
    {tabs.map((tab, index) => <Button
      key={tab.value} id={`${id}-tab-${tab.value}`} type="button" role="tab"
      variant={tab.value === value ? 'default' : 'outline'}
      className="h-auto min-h-11 min-w-11 max-w-full whitespace-normal break-words"
      aria-selected={tab.value === value} aria-controls={`${id}-panel`}
      tabIndex={tab.value === value ? 0 : -1} disabled={disabled}
      onClick={() => onChange(tab.value)}
      onKeyDown={(event) => {
        const nextIndex = event.key === 'ArrowRight' ? (index + 1) % tabs.length
          : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length
          : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null;
        if (nextIndex === null) return;
        event.preventDefault();
        onChange(tabs[nextIndex].value);
        event.currentTarget.parentElement?.querySelectorAll<HTMLElement>('[role="tab"]')[nextIndex]?.focus();
      }}
    >{tab.label}</Button>)}
  </div>;
}
