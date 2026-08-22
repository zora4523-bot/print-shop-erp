'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';

export type AdminRouteErrorProps = {
  error: Error & { digest?: string };
  unstable_retry: () => void;
};

export function AdminRouteError({ unstable_retry }: AdminRouteErrorProps) {
  return (
    <section
      role="alert"
      className="break-words rounded-xl border bg-card p-5 shadow-sm"
      data-slot="admin-route-error"
    >
      <h1 className="text-lg font-semibold">此页面暂时无法加载</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        其他后台功能仍可继续使用。请重试当前页面，或返回管理首页。
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        <Button variant="outline" onClick={() => unstable_retry()}>
          重试当前页面
        </Button>
        <Link
          href="/owner"
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border px-3 text-sm font-medium hover:bg-muted"
        >
          返回管理首页
        </Link>
      </div>
    </section>
  );
}
