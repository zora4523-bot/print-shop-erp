import { SlowLoadingHint } from '@/components/ui-business';

export default function CustomerPricingLoading() {
  return (
    <div className="min-w-0 space-y-6" aria-busy="true" aria-live="polite">
      <div className="space-y-2">
        <div className="h-8 w-52 max-w-full animate-pulse rounded bg-muted motion-reduce:animate-none" />
        <div className="h-4 w-full max-w-xl animate-pulse rounded bg-muted motion-reduce:animate-none" />
      </div>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div
            key={index}
            className="h-20 animate-pulse rounded-xl border bg-muted/50 motion-reduce:animate-none"
          />
        ))}
      </div>
      <div className="h-96 animate-pulse rounded-xl border bg-muted/40 motion-reduce:animate-none" />
      <SlowLoadingHint />
      <span className="sr-only">正在加载客户计价规则</span>
    </div>
  );
}
