import { SlowLoadingHint } from '@/components/ui-business';

export default function WorkerLoading() {
  return (
    <div aria-busy="true" aria-live="polite" className="space-y-4">
      <span className="sr-only">正在加载师傅工作台</span>
      <div className="h-7 w-32 animate-pulse rounded-md bg-muted motion-reduce:animate-none" />
      <div className="space-y-3">
        {[0, 1, 2].map((item) => (
          <div
            key={item}
            aria-hidden="true"
            className="h-28 animate-pulse rounded-xl border bg-card motion-reduce:animate-none"
          />
        ))}
      </div>
      <SlowLoadingHint />
    </div>
  );
}
