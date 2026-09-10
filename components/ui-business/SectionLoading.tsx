'use client';

import type { ReactNode } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { SlowLoadingHint } from './ContentSkeleton';

export type SectionLoadingProps = {
  /** 读屏器播报「正在加载{label}」。 */
  label: string;
  /** 单块骨架的尺寸类；传 children 时忽略。 */
  className?: string;
  /** 自定义骨架布局（网格、多块）。每块用 `Skeleton`，容器已 aria-hidden。 */
  children?: ReactNode;
};

/**
 * 区块级加载态：Suspense fallback / route loading 共用的一块或多块骨架，
 * 自带 role="status"、aria-busy、sr-only 标签与 8 秒慢加载提示。
 * 列表数据区仍用 `ContentSkeleton`（按行数撑高，避免加载后跳动）。
 */
export function SectionLoading({ label, className, children }: SectionLoadingProps) {
  return (
    <div
      data-slot="section-loading"
      role="status"
      aria-busy="true"
      aria-live="polite"
      className="min-w-0 space-y-2"
    >
      <span className="sr-only">正在加载{label}</span>
      <div aria-hidden="true">
        {children ?? (
          <Skeleton
            className={cn('h-48 w-full rounded-xl border bg-card motion-reduce:animate-none', className)}
          />
        )}
      </div>
      <SlowLoadingHint />
    </div>
  );
}
