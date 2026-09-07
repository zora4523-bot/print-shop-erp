import { Skeleton } from '@/components/ui/skeleton';
import { SlowLoadingHint } from '@/components/ui-business';

export function AdminOrdersWorkspaceSkeleton() {
  return (
    <section data-slot="admin-orders-workspace-skeleton" aria-busy="true" aria-live="polite" className="@container mx-auto min-w-0 max-w-[1180px] space-y-3.5">
      <span className="sr-only">正在加载管理端工单</span>
      <div aria-hidden="true" className="flex flex-wrap gap-2.5">
        {Array.from({ length: 8 }, (_, index) => (
          <Skeleton key={index} className="h-[72px] w-[104px] rounded-xl motion-reduce:animate-none" />
        ))}
      </div>
      <div aria-hidden="true" className="flex flex-wrap items-center gap-2">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="h-11 w-20 rounded-full motion-reduce:animate-none" />
        ))}
        <Skeleton className="ml-auto h-11 w-52 max-w-full rounded-full motion-reduce:animate-none" />
        <Skeleton className="h-11 w-full rounded-full motion-reduce:animate-none" />
      </div>
      <Skeleton aria-hidden="true" className="h-5 w-80 max-w-full motion-reduce:animate-none" />
      <div aria-hidden="true" className="space-y-2">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="flex min-h-[84px] items-center gap-3 rounded-xl border bg-card px-3.5 py-[11px]">
            <Skeleton className="size-6 shrink-0 motion-reduce:animate-none" />
            <Skeleton className="h-[46px] w-[34px] shrink-0 rounded-md motion-reduce:animate-none" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-4 w-40 max-w-full motion-reduce:animate-none" />
              <Skeleton className="h-3 w-60 max-w-full motion-reduce:animate-none" />
            </div>
            <Skeleton className="hidden h-6 w-40 rounded-full motion-reduce:animate-none @min-[960px]:block" />
            <Skeleton className="hidden h-4 w-24 motion-reduce:animate-none @min-[960px]:block" />
            <Skeleton className="hidden h-8 w-20 rounded-lg motion-reduce:animate-none @min-[960px]:block" />
          </div>
        ))}
      </div>
      <SlowLoadingHint />
    </section>
  );
}

export function OrdersListContentSkeleton() {
  return (
    <section aria-busy="true" aria-live="polite" className="space-y-6">
      <span className="sr-only">正在加载工单数据</span>
      <OrdersListFiltersSkeleton announce={false} />
      <OrdersListTableSkeleton announce={false} />
      <SlowLoadingHint />
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
        <OrderExportControlsSkeleton announce={false} />
      </div>
      <Skeleton
        className="h-11 w-full motion-reduce:animate-none"
        aria-hidden="true"
      />
      {announce ? <SlowLoadingHint /> : null}
    </div>
  );
}

export function OrderExportControlsSkeleton({
  announce = true,
}: {
  announce?: boolean;
}) {
  return (
    <div
      aria-busy="true"
      aria-live={announce ? 'polite' : undefined}
      className="inline-flex flex-col items-end gap-2"
    >
      {announce ? <span className="sr-only">正在加载导出记录</span> : null}
      <span className="inline-flex">
        <Skeleton
          className="h-11 w-24 motion-reduce:animate-none lg:h-8"
          aria-hidden="true"
        />
      </span>
      {announce ? <SlowLoadingHint className="text-right" /> : null}
    </div>
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
      {announce ? <SlowLoadingHint /> : null}
    </div>
  );
}

export function SalesOrdersListContentSkeleton() {
  return (
    <section aria-busy="true" aria-live="polite" className="space-y-6">
      <span className="sr-only">正在加载销售工单数据</span>
      <SalesOrdersFiltersSkeleton announce={false} />
      <SalesOrdersListSkeleton announce={false} />
      <SlowLoadingHint />
    </section>
  );
}

export function SalesOrdersFiltersSkeleton({
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
      {announce ? <span className="sr-only">正在加载销售工单筛选</span> : null}
      <div className="space-y-2" aria-hidden="true">
        <Skeleton className="h-5 w-24 motion-reduce:animate-none" />
        <Skeleton className="h-4 w-44 motion-reduce:animate-none" />
      </div>
      <div className="flex gap-2 overflow-hidden" aria-hidden="true">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton
            key={index}
            className="h-9 w-20 shrink-0 rounded-full motion-reduce:animate-none"
          />
        ))}
      </div>
      <Skeleton
        className="h-10 w-full rounded-full motion-reduce:animate-none"
        aria-hidden="true"
      />
      {announce ? <SlowLoadingHint /> : null}
    </div>
  );
}

export function SalesOrdersListSkeleton({
  announce = true,
}: {
  announce?: boolean;
}) {
  return (
    <div
      aria-busy="true"
      aria-live={announce ? 'polite' : undefined}
      className="space-y-2"
    >
      {announce ? <span className="sr-only">正在加载销售工单列表</span> : null}
      <div className="space-y-2" aria-hidden="true">
        {Array.from({ length: 5 }, (_, index) => (
          <Skeleton
            key={index}
            className="h-32 w-full rounded-xl motion-reduce:animate-none"
          />
        ))}
      </div>
      {announce ? <SlowLoadingHint /> : null}
    </div>
  );
}
