'use client';

import { useEffect, useState } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

export type ContentSkeletonVariant = 'table' | 'card' | 'form';

export type ContentSkeletonProps = {
  /** 骨架行数。列表页应传当前每页条数，避免加载完成后高度跳动。 */
  rows?: number;
  variant?: ContentSkeletonVariant;
  /** 外壳 / 页头 / 筛选立刻渲染，只有数据区出骨架。 */
  keepChrome?: boolean;
  /** 读屏器的加载区域名称。 */
  label?: string;
  className?: string;
};

const DEFAULT_ROWS = 20;
const SLOW_HINT_MS = 8_000;

const TABLE_ROW_HEIGHT = 'h-11';
const CARD_HEIGHT = 'h-24';
const FORM_FIELD_HEIGHT = 'h-16';

export function ContentSkeleton({
  rows = DEFAULT_ROWS,
  variant = 'table',
  keepChrome = true,
  label = '正在加载内容',
  className,
}: ContentSkeletonProps) {
  const count = Math.min(50, Math.max(1, Math.floor(rows)));
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), SLOW_HINT_MS);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div
      data-slot="content-skeleton"
      data-variant={variant}
      data-keep-chrome={keepChrome ? 'true' : 'false'}
      aria-busy="true"
      aria-live="polite"
      className={cn('min-w-0 space-y-3', className)}
    >
      {/* keepChrome=true 时页面自己的页头 / 筛选 / 表头已经存在，
          这里只画数据区。只有显式传 false 才补一小块内容外壳骨架。 */}
      {!keepChrome ? <ChromeSkeleton variant={variant} /> : null}
      <div className="space-y-2" aria-hidden="true">
        {Array.from({ length: count }, (_, index) => (
          <Skeleton
            key={index}
            className={cn(
              'w-full',
              variant === 'table' && TABLE_ROW_HEIGHT,
              variant === 'card' && CARD_HEIGHT,
              variant === 'form' && FORM_FIELD_HEIGHT,
              variant === 'table' && index % 2 === 1 && 'opacity-80',
              'motion-reduce:animate-none',
            )}
            style={{
              width:
                variant === 'table'
                  ? `${88 - (index % 4) * 4}%`
                  : undefined,
            }}
          />
        ))}
      </div>
      {slow ? (
        <p className="text-sm text-muted-foreground">仍在加载，可稍后重试。</p>
      ) : null}
      <span className="sr-only">{label}</span>
    </div>
  );
}

function ChromeSkeleton({ variant }: { variant: ContentSkeletonVariant }) {
  if (variant === 'form') {
    return (
      <div className="space-y-2" aria-hidden="true">
        <Skeleton className="h-7 w-40 motion-reduce:animate-none" />
        <Skeleton className="h-4 w-64 motion-reduce:animate-none" />
      </div>
    );
  }
  return (
    <div className="flex min-w-0 flex-wrap gap-2" aria-hidden="true">
      <Skeleton className="h-9 w-36 motion-reduce:animate-none" />
      <Skeleton className="h-9 w-24 motion-reduce:animate-none" />
      <Skeleton className="h-9 w-28 motion-reduce:animate-none" />
    </div>
  );
}
