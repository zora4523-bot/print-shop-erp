import { Skeleton } from '@/components/ui/skeleton';

export function AdminRouteLoading({
  label = '正在加载页面',
}: {
  label?: string;
}) {
  return (
    <section
      aria-busy="true"
      aria-live="polite"
      className="space-y-6"
      data-slot="admin-route-loading"
    >
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" className="space-y-2">
        <Skeleton className="h-7 w-40 motion-reduce:animate-none" />
        <Skeleton className="h-4 w-full max-w-xl motion-reduce:animate-none" />
      </div>
      <div
        aria-hidden="true"
        className="flex min-h-16 max-w-3xl items-center rounded-lg border bg-card p-3 shadow-sm"
      >
        <Skeleton className="h-9 w-full motion-reduce:animate-none" />
      </div>
      <div
        aria-hidden="true"
        className="min-h-72 rounded-xl border bg-card p-4 shadow-sm"
      >
        <div className="space-y-4">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton
              key={index}
              className="h-8 w-full motion-reduce:animate-none"
            />
          ))}
        </div>
      </div>
    </section>
  );
}
