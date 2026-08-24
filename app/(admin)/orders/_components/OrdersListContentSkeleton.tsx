import { Skeleton } from '@/components/ui/skeleton';

export function OrdersListContentSkeleton() {
  return (
    <section aria-busy="true" aria-live="polite" className="space-y-6">
      <span className="sr-only">正在加载工单数据</span>
      <div className="space-y-3 rounded-xl border bg-card p-4 shadow-sm" aria-hidden="true">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-2">
            <Skeleton className="h-5 w-24 motion-reduce:animate-none" />
            <Skeleton className="h-4 w-36 motion-reduce:animate-none" />
          </div>
          <Skeleton className="h-8 w-24 motion-reduce:animate-none" />
        </div>
        <Skeleton className="h-11 w-full motion-reduce:animate-none" />
      </div>
      <div className="space-y-3 rounded-xl border bg-card p-4 shadow-sm" aria-hidden="true">
        <Skeleton className="h-8 w-full motion-reduce:animate-none" />
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton
            key={index}
            className="h-10 w-full motion-reduce:animate-none"
          />
        ))}
        <Skeleton className="h-8 w-48 motion-reduce:animate-none" />
      </div>
    </section>
  );
}
