'use client';

import { useId } from 'react';
import { Disclosure, DisclosureSummary } from '@/components/ui/disclosure';

/** One display contract for the order-level note; never render empty placeholders. */
export function OrderRemark({ remark, compact = false }: { remark?: string | null; compact?: boolean }) {
  const fullTextId = useId();
  const text = remark?.trim();
  if (!text) return null;
  if (compact) return (
    <Disclosure data-slot="order-remark" className="mt-2 min-w-0 border-l-2 border-primary pl-3" onClick={(event) => event.stopPropagation()}>
      <DisclosureSummary className="min-w-0 flex-col items-start justify-center gap-1 text-primary">
        <span className="text-xs font-semibold">工单备注 · 展开/收起</span>
        <span aria-describedby={fullTextId} className="line-clamp-2 w-full whitespace-pre-wrap break-words text-left text-xs group-open:hidden">{text}</span>
      </DisclosureSummary>
      <p id={fullTextId} className="whitespace-pre-wrap break-words pb-2 text-sm font-semibold text-primary">{text}</p>
    </Disclosure>
  );
  return (
    <section aria-label="工单备注" data-slot="order-remark" className="min-w-0 border-l-2 border-primary pl-3 text-primary">
      <h2 className="text-sm font-semibold">工单备注</h2>
      <p className="mt-2 whitespace-pre-wrap break-words text-sm font-semibold">{text}</p>
    </section>
  );
}
