'use client';

import { useEffect } from 'react';
import { COMPANY_NAME } from '@/lib/app-brand';
import './globals.css';

export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="zh-CN">
      <body className="bg-background text-foreground">
        <title>{`系统暂时无法加载 · ${COMPANY_NAME}`}</title>
        <main className="touch-viewport mx-auto flex min-h-dvh w-full max-w-3xl items-center px-4 py-10 sm:px-6">
          <section
            role="alert"
            aria-live="assertive"
            aria-atomic="true"
            className="w-full rounded-xl border border-destructive/40 bg-card p-5 shadow-sm"
          >
            <h1 className="text-xl font-semibold">系统暂时无法加载</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              请重新加载；若问题持续，请联系管理员。
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={retry}
                className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                重新加载
              </button>
              <button
                type="button"
                onClick={() => window.location.assign('/')}
                className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-border bg-background px-3 text-sm font-medium outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                返回系统首页
              </button>
            </div>
          </section>
        </main>
      </body>
    </html>
  );
}
