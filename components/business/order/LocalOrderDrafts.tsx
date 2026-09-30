'use client';

import { useCallback, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { Disclosure, DisclosureSummary } from '@/components/ui/disclosure';
import { formatDateTimeShanghai } from '@/lib/format/dates';
import {
  listLocalWorkbenchDrafts,
  type LocalOrderFormDraftPricingScope,
  type LocalWorkbenchDraft,
} from './order-form-local-draft';

function subscribe(onChange: () => void) {
  window.addEventListener('storage', onChange);
  window.addEventListener('focus', onChange);
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener('focus', onChange);
  };
}
const emptySnapshot = () => '[]';

export function LocalOrderDrafts({
  baseKey,
  pricingScope,
  currentId,
  onNavigate,
}: {
  baseKey: string;
  pricingScope: LocalOrderFormDraftPricingScope;
  currentId?: string;
  onNavigate: (href: string, event: { preventDefault(): void }) => void;
}) {
  const getSnapshot = useCallback(() => {
    try {
      return JSON.stringify(
        listLocalWorkbenchDrafts(
          window.localStorage,
          baseKey,
          pricingScope,
        ).filter((draft) => draft.id !== currentId),
      );
    } catch {
      return '[]';
    }
  }, [baseKey, pricingScope, currentId]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, emptySnapshot);
  const drafts: LocalWorkbenchDraft[] = JSON.parse(snapshot);
  if (drafts.length === 0) return null;
  return (
    <Disclosure className="min-w-0 rounded-xl border p-4">
      <DisclosureSummary>报价工单草稿（{drafts.length}）</DisclosureSummary>
      <ul className="mt-2 divide-y">
        {drafts.map((draft) => (
          <li
            key={draft.id}
            className="flex min-w-0 flex-wrap items-center gap-3 py-3"
          >
            <div className="min-w-0 flex-1 basis-48">
              <p className="break-words text-sm font-medium">
                {draft.name ?? '未命名工单'}
              </p>
              <time
                dateTime={draft.savedAt}
                className="text-xs text-muted-foreground"
              >
                {formatDateTimeShanghai(new Date(draft.savedAt))}
              </time>
            </div>
            <Link
              href={`/orders/new?fromWorkbench=${encodeURIComponent(draft.id)}`}
              prefetch={false}
              className={buttonVariants({
                variant: 'outline',
                className: 'min-h-11',
              })}
              onNavigate={(event) => onNavigate(`/orders/new?fromWorkbench=${encodeURIComponent(draft.id)}`, event)}
            >
              恢复草稿
            </Link>
          </li>
        ))}
      </ul>
    </Disclosure>
  );
}
