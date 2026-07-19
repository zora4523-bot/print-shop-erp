'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function WorkerError({
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return (
    <section
      role="alert"
      className="worker-wrap-anywhere rounded-xl border bg-card p-5 shadow-sm"
    >
      <h1 className="text-lg font-semibold">师傅工作台暂时无法加载</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        可能是网络或服务短暂波动。你可以立即重试，或返回任务列表。
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        <Button variant="outline" className="min-h-11" onClick={() => unstable_retry()}>
          重新加载
        </Button>
        <Link
          href="/worker/tasks"
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border px-3 text-sm font-medium hover:bg-muted"
        >
          返回我的任务
        </Link>
      </div>
    </section>
  );
}
