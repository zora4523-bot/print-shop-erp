'use client';

import type { Ref } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** Controlled tabs for an editor that retains its form state outside the panel. */
export function EditorTabs({ id, label, tabs, value, disabled, onChange, ref, variant = 'outline' }: {
  id: string;
  label: string;
  tabs: readonly { value: string; label: string }[];
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  ref?: Ref<HTMLDivElement>;
  variant?: 'folder' | 'outline';
}) {
  return <div ref={ref} role="tablist" aria-label={label} data-variant={variant}
    className={cn('flex min-w-0 flex-wrap', variant === 'folder' ? 'flex-1 gap-1 border-b border-border' : 'gap-2')}>
    {tabs.map((tab, index) => <Button
      key={tab.value} id={`${id}-tab-${tab.value}`} type="button" role="tab"
      // outline 形态直接用 Button 的标准选中变体，与分段按钮 / 筛选的选中态同一套视觉。
      variant={variant === 'outline' ? (tab.value === value ? 'selected' : 'outline') : 'ghost'}
      className={cn(
        'h-auto min-h-11 min-w-11 max-w-full whitespace-normal break-words active:not-aria-[haspopup]:translate-y-0',
        variant === 'folder'
          ? '-mb-px rounded-b-none rounded-t-lg border border-t-2 border-border bg-muted px-4 py-3 aria-selected:border-b-card aria-selected:border-t-primary aria-selected:bg-card aria-selected:text-primary aria-selected:font-semibold aria-selected:hover:bg-card aria-selected:hover:text-primary'
          : 'px-3 py-2',
      )}
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
