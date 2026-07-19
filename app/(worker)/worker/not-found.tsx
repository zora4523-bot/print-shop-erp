import Link from 'next/link';

export default function WorkerNotFound() {
  return (
    <section className="worker-wrap-anywhere rounded-xl border bg-card p-5 shadow-sm">
      <h1 className="text-lg font-semibold">没有找到这条记录</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        记录可能已被取消，或不属于当前登录的师傅账号。
      </p>
      <Link
        href="/worker/tasks"
        className="mt-4 inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg bg-foreground px-3 text-sm font-medium text-background hover:bg-foreground/80"
      >
        返回我的任务
      </Link>
    </section>
  );
}
