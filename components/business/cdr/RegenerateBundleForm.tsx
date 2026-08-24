'use client';

import { useActionState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createBundleAction } from '@/actions/foreman-cdr';
import type { CreateBundleResult } from '@/actions/foreman-cdr.types';
import { PendingButton } from '@/components/ui-business';

type RegenerateBundleFormProps = {
  from: string;
  to: string;
  orderIds: readonly string[];
};

/**
 * 用旧下载包的日期窗口与工单集合创建一个新包。
 *
 * 不复用旧 bundle：短链、过期时间和审计记录必须重新生成；原记录仍保留，
 * 以便追溯当时实际发送给外协的链接。
 */
export function RegenerateBundleForm({
  from,
  to,
  orderIds,
}: RegenerateBundleFormProps) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<
    CreateBundleResult | null,
    FormData
  >(createBundleAction, null);

  useEffect(() => {
    if (state?.status !== 'success' && state?.status !== 'queued') return;
    router.refresh();
  }, [router, state]);

  const error =
    state?.status === 'error'
      ? state.message
      : state?.status === 'invalid'
        ? Object.values(state.fieldErrors).flat()[0]
        : undefined;

  return (
    <form action={formAction} className="mt-2 space-y-1" aria-busy={pending}>
      <input type="hidden" name="from" value={from} />
      <input type="hidden" name="to" value={to} />
      {orderIds.map((orderId) => (
        <input key={orderId} type="hidden" name="orderIds" value={orderId} />
      ))}
      <PendingButton
        pending={pending}
        pendingLabel="重新生成中…"
        variant="outline"
        size="sm"
        className="min-h-9"
        groupNote="会创建新的下载包，原记录仍保留。"
      >
        按同条件重新生成
      </PendingButton>
      {error ? (
        <p role="alert" className="max-w-xs text-xs text-destructive">
          {error}
        </p>
      ) : null}
      {state?.status === 'queued' ? (
        <p role="status" className="text-xs text-muted-foreground">
          已受理，回执 {state.jobId}
        </p>
      ) : state?.status === 'success' ? (
        <p role="status" className="text-xs text-success">
          新下载包已生成
        </p>
      ) : null}
    </form>
  );
}
