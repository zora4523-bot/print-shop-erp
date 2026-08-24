'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/ui-business';

export default function RootRouteError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    // Next.js 会在生产环境隐藏服务端错误详情；这里只把原始错误交给
    // 浏览器日志/现有 Sentry instrumentation，不把 message 渲染给用户。
    console.error(error);
  }, [error]);

  return (
    <main className="touch-viewport mx-auto flex min-h-dvh w-full max-w-3xl items-center px-4 py-10 sm:px-6">
      <ErrorState
        scope="page"
        title="页面暂时无法加载"
        description="可能是网络或服务短暂波动。请重试当前页面；如果问题持续，可以先返回系统首页。"
        retryLabel="重试当前页面"
        onRetry={unstable_retry}
        action={
          <Button
            render={<Link href="/" prefetch={false} />}
            nativeButton={false}
            variant="outline"
          >
            返回系统首页
          </Button>
        }
        className="w-full"
      />
    </main>
  );
}
