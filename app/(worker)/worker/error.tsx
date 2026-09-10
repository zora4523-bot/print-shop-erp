'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/ui-business';

export default function WorkerError({
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return (
    <div data-slot="worker-route-error" className="worker-wrap-anywhere">
      <ErrorState
        scope="page"
        title="师傅工作台暂时无法加载"
        description="可能是网络或服务短暂波动。你可以立即重试，或返回任务列表。"
        retryLabel="重新加载"
        onRetry={unstable_retry}
        action={
          <Button
            render={<Link href="/worker/tasks" prefetch={false} />}
            nativeButton={false}
            variant="outline"
          >
            返回我的任务
          </Button>
        }
      />
    </div>
  );
}
