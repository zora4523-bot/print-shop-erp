import { Skeleton } from '@/components/ui/skeleton';

export function OrdersListContentSkeleton() {
  return (
    <section aria-busy="true" aria-live="polite" className="space-y-6">
      <span className="sr-only">正在加载工单数据</span>
      <OrdersListFiltersSkeleton announce={false} />
      <OrdersListTableSkeleton announce={false} />
    </section>
  );
}

export function OrdersListFiltersSkeleton({
  announce = true,
}: {
  announce?: boolean;
}) {
  return (
    <div
      aria-busy="true"
      aria-live={announce ? 'polite' : undefined}
      className="space-y-3 rounded-xl border bg-card p-4 shadow-sm"
    >
      {announce ? <span className="sr-only">正在加载工单筛选</span> : null}
      <div
        className="flex items-center justify-between gap-4"
        aria-hidden="true"
      >
        <div className="space-y-2">
          <Skeleton className="h-5 w-24 motion-reduce:animate-none" />
          <Skeleton className="h-4 w-36 motion-reduce:animate-none" />
        </div>
        <OrderExportControlsSkeleton />
      </div>
      <Skeleton
        className="h-11 w-full motion-reduce:animate-none"
        aria-hidden="true"
      />
    </div>
  );
}

export function OrderExportControlsSkeleton() {
  return (
    <span className="inline-flex" aria-label="正在加载导出记录">
      <Skeleton
        className="h-11 w-24 motion-reduce:animate-none lg:h-8"
        aria-hidden="true"
      />
    </span>
  );
}

export function OrdersListTableSkeleton({
  announce = true,
}: {
  announce?: boolean;
}) {
  return (
    <div
      aria-busy="true"
      aria-live={announce ? 'polite' : undefined}
      className="space-y-3 rounded-xl border bg-card p-4 shadow-sm"
    >
      {announce ? <span className="sr-only">正在加载工单列表</span> : null}
      <div className="space-y-3" aria-hidden="true">
        <Skeleton className="h-8 w-full motion-reduce:animate-none" />
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton
            key={index}
            className="h-10 w-full motion-reduce:animate-none"
          />
        ))}
        <Skeleton className="h-8 w-48 motion-reduce:animate-none" />
      </div>
    </div>
  );
}
