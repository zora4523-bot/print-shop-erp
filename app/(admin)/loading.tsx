export default function AdminLoading() {
  return (
    <div aria-busy="true" aria-live="polite" className="space-y-4">
      <span className="sr-only">正在加载管理后台</span>
      <div className="h-8 w-40 animate-pulse rounded-md bg-muted motion-reduce:animate-none" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((item) => (
          <div
            key={item}
            aria-hidden="true"
            className="h-28 animate-pulse rounded-xl border bg-card motion-reduce:animate-none"
          />
        ))}
      </div>
      <div
        aria-hidden="true"
        className="h-72 animate-pulse rounded-xl border bg-card motion-reduce:animate-none"
      />
    </div>
  );
}
