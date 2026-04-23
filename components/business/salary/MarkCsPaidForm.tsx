'use client';

import { useActionState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { markCsCommissionPaidAction } from '@/actions/owner-salary';
import type { SalaryMutationResult } from '@/actions/owner-salary.types';

type Props = {
  id: string;
  currentPaid: boolean;
};

export function MarkCsPaidForm({ id, currentPaid }: Props) {
  const bound = markCsCommissionPaidAction.bind(null, id);
  const [state, action] = useActionState<SalaryMutationResult | null, FormData>(
    bound,
    null,
  );
  const [pending, startTransition] = useTransition();
  const target = !currentPaid;

  return (
    <form
      action={(fd) => {
        fd.set('isPaid', String(target));
        startTransition(() => action(fd));
      }}
    >
      <input type="hidden" name="isPaid" value={String(target)} />
      <Button
        type="submit"
        size="sm"
        variant={currentPaid ? 'outline' : 'default'}
        disabled={pending}
      >
        {pending ? '处理中…' : currentPaid ? '撤销已发' : '标记全额已发'}
      </Button>
      {state?.status === 'error' ? (
        <span className="ml-2 text-xs text-destructive">{state.message}</span>
      ) : null}
    </form>
  );
}
