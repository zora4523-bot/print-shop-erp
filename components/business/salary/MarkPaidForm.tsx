'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { setDailySalaryPaidAction } from '@/actions/owner-salary';
import type { SalaryMutationResult } from '@/actions/owner-salary.types';

type Props = {
  id: string;
  currentPaid: boolean;
  // 当前列表的完整 URL（含筛选）。成功后 action 会 redirect 回这里并
  // 附上确认信息——「仅未发」筛选下这一行会消失，组件跟着卸载，内联
  // 提示根本没机会渲染。
  returnTo: string;
};

export function MarkPaidForm({ id, currentPaid, returnTo }: Props) {
  const bound = setDailySalaryPaidAction.bind(null, id);
  const [state, action, pending] = useActionState<
    SalaryMutationResult | null,
    FormData
  >(bound, null);
  const target = !currentPaid;

  return (
    <form action={action}>
      <input type="hidden" name="isPaid" value={String(target)} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <Button
        type="submit"
        size="sm"
        variant={currentPaid ? 'outline' : 'default'}
        disabled={pending}
      >
        {pending
          ? '处理中…'
          : currentPaid
            ? '撤销发放'
            : '标记已发'}
      </Button>
      {state?.status === 'error' ? (
        <span role="alert" className="ml-2 text-xs text-destructive">{state.message}</span>
      ) : null}
    </form>
  );
}
