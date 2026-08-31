'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/ui-business';

export type AdminRouteErrorProps = {
  error: Error & { digest?: string };
  unstable_retry: () => void;
};

export function AdminRouteError({ unstable_retry }: AdminRouteErrorProps) {
  return (
    <div data-slot="admin-route-error" className="break-words">
      <ErrorState
        scope="page"
        title="此页面暂时无法加载"
        description="其他后台功能仍可继续使用。请重试当前页面，或返回管理首页。"
        retryLabel="重试当前页面"
        onRetry={unstable_retry}
        action={
          <Button
            render={<Link href="/owner" prefetch={false} />}
            nativeButton={false}
            variant="outline"
          >
            返回管理首页
          </Button>
        }
      />
    </div>
  );
}
