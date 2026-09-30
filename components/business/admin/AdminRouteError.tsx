'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/ui-business';

export type AdminRouteErrorProps = {
  error: Error & { digest?: string };
  retry: () => void;
};

function isChunkLoadError(error: Error): boolean {
  return error.name === 'ChunkLoadError' || /Loading (?:CSS )?chunk .+ failed|Failed to load chunk|Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(error.message);
}

export function AdminRouteError({ error, retry }: AdminRouteErrorProps) {
  const needsReload = isChunkLoadError(error);
  const reload = () => window.location.reload();
  return (
    <div data-slot="admin-route-error" className="break-words">
      <ErrorState
        scope="page"
        title="此页面暂时无法加载"
        description={needsReload ? '请重新加载页面后继续，或返回首页。' : '请重试当前页面；仍无法打开时，重新加载页面或返回首页。'}
        retryLabel={needsReload ? '重新加载页面' : '重试当前页面'}
        onRetry={needsReload ? reload : retry}
        action={
          <>
            {!needsReload ? <Button type="button" size="sm" variant="outline" onClick={reload}>重新加载页面</Button> : null}
            <Button
              render={<Link href="/" prefetch={false} />}
              nativeButton={false}
              variant="outline"
            >
              返回首页
            </Button>
          </>
        }
      />
    </div>
  );
}
