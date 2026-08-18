'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import type { BackgroundJobMutationResult } from '@/actions/background-jobs.types';

// 后台任务的「重试 / 取消」按钮。
//
// 这两个操作此前是全仓唯一一处「执行写操作却既没有 pending 态、也没有
// 任何结果反馈」的提交按钮：repository 用返回 false 表示「状态已变、什么
// 都没做」，而 action 把它吞掉返回 void，运维点完看不出到底成没成。
//
// 拆成客户端组件是为了拿到 useActionState 的 pending 与返回值；页面本身
// 仍是 Server Component。
export function BackgroundJobActionButton({
  action,
  jobId,
  label,
}: {
  action: (
    prev: BackgroundJobMutationResult | null,
    formData: FormData,
  ) => Promise<BackgroundJobMutationResult>;
  jobId: string;
  label: string;
}) {
  const [state, formAction, pending] = useActionState<
    BackgroundJobMutationResult | null,
    FormData
  >(action, null);

  return (
    <form action={formAction} className="inline-flex flex-col items-end gap-1">
      <input type="hidden" name="jobId" value={jobId} />
      <Button variant="outline" size="xs" type="submit" disabled={pending}>
        {pending ? '处理中…' : label}
      </Button>
      {state?.status === 'error' ? (
        <span role="alert" className="text-xs text-destructive">
          {state.message}
        </span>
      ) : null}
      {state?.status === 'success' ? (
        <span role="status" className="text-xs text-success-foreground">
          {state.message}
        </span>
      ) : null}
    </form>
  );
}
