'use client';

import { useEffect, useRef, useState } from 'react';
import type { OrderCommercialDetailMutationResult } from '@/actions/order.types';
import { Button } from '@/components/ui/button';
import { ActionNotice } from '@/components/ui-business';

type Result = OrderCommercialDetailMutationResult | null;
type Action = (previous: Result, input: unknown) => Promise<OrderCommercialDetailMutationResult>;

/** Only transport failures have an unknown outcome here. Domain rejections are
 * structured results; programming/auth/framework errors still reach Next. */
function isFeeConnectionFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === 'AbortError' || error.name === 'TimeoutError') return true;
  return error.name === 'TypeError' &&
    /^(Failed to fetch|Load failed|NetworkError when attempting to fetch resource\.?)$/i.test(error.message);
}

export function useCommercialFeeRecovery() {
  const isInFlight = useRef(false);
  const hasUnknownResultRef = useRef(false);
  const [isPending, setIsPending] = useState(false);
  const [hasUnknownResult, setHasUnknownResult] = useState(false);

  async function run(action: Action, previous: Result, input: unknown): Promise<Result> {
    if (isInFlight.current || hasUnknownResultRef.current) return previous;
    isInFlight.current = true;
    setIsPending(true);
    try {
      return await action(previous, input);
    } catch (error) {
      if (!isFeeConnectionFailure(error)) throw error;
      // A lost response cannot prove a rollback. Never replay this write or
      // clear this guard on draft reset / priceRevision / RSC refresh alone.
      hasUnknownResultRef.current = true;
      setHasUnknownResult(true);
      return null;
    } finally {
      isInFlight.current = false;
      setIsPending(false);
    }
  }

  return { run, isPending, hasUnknownResult, isBlocked: isPending || hasUnknownResult };
}

export type CommercialFeeRecovery = ReturnType<typeof useCommercialFeeRecovery>;

export function CommercialFeeRecoveryNotice({ orderId }: { orderId: string }) {
  const notice = useRef<HTMLDivElement>(null);
  useEffect(() => { notice.current?.focus(); }, []);
  return (
    <div ref={notice} tabIndex={-1} aria-label="费用处理结果待核对">
      <ActionNotice
        tone="warning"
        title="暂时无法确认费用处理结果"
        description="本页保留了输入。请在新标签页核对费用记录，再重新加载本页；重新加载会清除尚未保存的输入。"
        action={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              nativeButton={false}
              render={<a href={`/orders/${orderId}#commercial-fees`} target="_blank" rel="noopener noreferrer" />}
            >
              在新标签页核对费用
            </Button>
            <Button type="button" variant="outline" onClick={() => window.location.reload()}>
              核对后重新加载
            </Button>
          </div>
        }
      />
    </div>
  );
}
