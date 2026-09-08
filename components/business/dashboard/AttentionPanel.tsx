import Link from 'next/link';
import type { ReactNode } from 'react';
import {
  attentionHref,
  ATTENTION_TITLES,
  type AttentionKind,
} from '@/lib/dashboard/attention';

export function AttentionPanel({
  kind,
  count,
  emptyText,
  children,
}: {
  kind: AttentionKind;
  count: number;
  emptyText: string;
  children: ReactNode;
}) {
  return (
    <section
      data-slot={`dashboard-watchlist-${kind}`}
      aria-label={ATTENTION_TITLES[kind]}
      className="min-w-0 rounded-xl border bg-card shadow-sm"
    >
      <header className="flex min-w-0 items-center justify-between gap-3 border-b px-4 py-3">
        <h2 className="text-sm font-semibold">{ATTENTION_TITLES[kind]}</h2>
        <span className="shrink-0 font-sans text-sm tabular-nums text-muted-foreground">
          {count} 条
        </span>
      </header>
      {count === 0 ? (
        <p className="px-4 py-3 text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        <>
          <ul className="divide-y">{children}</ul>
          <footer className="border-t px-4">
            <Link
              prefetch={false}
              href={attentionHref(kind)}
              className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline-offset-2 hover:underline"
            >
              查看全部{ATTENTION_TITLES[kind]} →
            </Link>
          </footer>
        </>
      )}
    </section>
  );
}
