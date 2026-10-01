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
      // 两种形态的选中都用 Button 的标准选中变体（§8.2 选中态只有一种）；folder 只保留
      // 「上圆角、底边并入面板」的形状差异，不再手写品牌色顶线。
      variant={tab.value === value ? 'selected' : variant === 'outline' ? 'outline' : 'ghost'}
      className={cn(
        'h-auto min-h-11 min-w-11 max-w-full whitespace-normal break-words active:not-aria-[haspopup]:translate-y-0',
        variant === 'folder'
          ? cn('-mb-px rounded-b-none rounded-t-lg border px-4 py-3', tab.value === value ? 'border-b-transparent' : 'border-border bg-muted')
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
