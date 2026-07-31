'use client';

import { useActionState, useEffect, useState, useTransition } from 'react';
import type { FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { reviewOrderChangeRequestAction } from '@/actions/order';
import type { ReviewOrderChangeRequestMutationResult } from '@/actions/order.types';
import { Button } from '@/components/ui/button';

type Props = {
  requestId: string;
};

export function OrderChangeReviewForm({ requestId }: Props) {
  const router = useRouter();
  const [state, action] = useActionState<
    ReviewOrderChangeRequestMutationResult | null,
    unknown
  >(reviewOrderChangeRequestAction, null);
  const [pending, startTransition] = useTransition();
  const [reviewRemark, setReviewRemark] = useState('');

  useEffect(() => {
    if (state?.status === 'success') router.refresh();
  }, [router, state]);

  function submit(decision: 'APPROVE' | 'REJECT') {
    startTransition(() =>
      action({
        requestId,
        decision,
        reviewRemark: reviewRemark || null,
      }),
    );
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
  }

  const error =
    state?.status === 'error'
      ? state.message
      : state?.status === 'invalid'
        ? Object.values(state.fieldErrors).flat()[0]
        : null;

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <label className="block space-y-1 text-sm">
        <span>审核备注（可选）</span>
        <textarea
          value={reviewRemark}
          onChange={(event) => setReviewRemark(event.target.value)}
          rows={2}
          maxLength={500}
          className="w-full rounded-md border bg-background px-3 py-2"
        />
      </label>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={pending}
          onClick={() => submit('APPROVE')}
          className="min-h-11"
        >
          {pending ? '处理中…' : '批准并同步工单'}
        </Button>
        <Button
          type="button"
          variant="destructive"
          disabled={pending}
          onClick={() => submit('REJECT')}
          className="min-h-11"
        >
          拒绝申请
        </Button>
      </div>
    </form>
  );
}
