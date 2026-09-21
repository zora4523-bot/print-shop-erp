'use client';

import { useEffect, useState } from 'react';
import { useLinkStatus } from 'next/link';
import { LoaderCircle } from 'lucide-react';

/** Must remain inside its Link: Next owns cancellation and latest navigation. */
export function OrderQueuePending({ label }: { label: string }) {
  const { pending } = useLinkStatus();
  const [delayed, setDelayed] = useState(false);
  useEffect(() => {
    if (!pending) return;
    const timer = window.setTimeout(() => setDelayed(true), 300);
    return () => { window.clearTimeout(timer); setDelayed(false); };
  }, [pending]);
  const showIndicator = pending && delayed;
  return (
    <span data-order-queue-pending={pending ? 'true' : undefined} className="inline-flex size-3 shrink-0 items-center justify-center">
      <LoaderCircle aria-hidden="true" className={`size-3 ${showIndicator ? 'visible motion-safe:animate-spin' : 'invisible'}`} />
      <span role="status" className="sr-only">{pending ? `正在切换至${label}，当前仍显示切换前的结果` : ''}</span>
    </span>
  );
}
