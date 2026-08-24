'use client';

import { useSyncExternalStore } from 'react';
import Link from 'next/link';
import { BookmarkPlus } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const STORAGE_KEY = 'print-shop-erp:orders:saved-view';
const listeners = new Set<() => void>();
let cachedRaw = '';

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener('storage', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', listener);
  };
}

function snapshot() {
  const raw = window.localStorage.getItem(STORAGE_KEY) ?? '';
  cachedRaw = raw;
  return cachedRaw;
}

function serverSnapshot() {
  return '';
}

function saveHref(href: string) {
  window.localStorage.setItem(STORAGE_KEY, href);
  cachedRaw = href;
  listeners.forEach((listener) => listener());
}

export function OrderSavedViews({ currentHref }: { currentHref: string }) {
  const savedHref = useSyncExternalStore(subscribe, snapshot, serverSnapshot);

  return (
    <div className="relative flex shrink-0 items-center gap-2">
      {savedHref ? (
        <Link
          href={savedHref}
          prefetch={false}
          className={cn(
            buttonVariants({ variant: 'outline', size: 'sm' }),
            'min-h-11 rounded-full sm:min-h-8',
          )}
        >
          已保存条件
        </Link>
      ) : null}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="min-h-11 shrink-0 rounded-full text-primary sm:min-h-8"
        onClick={() => saveHref(currentHref)}
      >
        <BookmarkPlus aria-hidden="true" />
        保存当前条件
      </Button>
      <span className="sr-only top-0 left-0" aria-live="polite">
        {savedHref === currentHref ? '当前筛选条件已保存' : ''}
      </span>
    </div>
  );
}
