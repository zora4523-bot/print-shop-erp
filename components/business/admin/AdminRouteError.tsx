'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/ui-business';

export type AdminRouteErrorProps = {
  error: Error & { digest?: string };
  retry: () => void;
};

export function AdminRouteError({ retry }: AdminRouteErrorProps) {
  return (
    <div data-slot="admin-route-error" className="break-words">
      <ErrorState
        scope="page"
        title="此页面暂时无法加载"
        description="其他功能仍可继续使用。请重试当前页面，或返回首页。"
        retryLabel="重试当前页面"
        onRetry={retry}
        action={
          <Button
            render={<Link href="/" prefetch={false} />}
            nativeButton={false}
            variant="outline"
          >
            返回首页
          </Button>
        }
      />
    </div>
  );
}
