import Link from 'next/link';

export default function AdminNotFound() {
  return (
    <section className="admin-wrap-anywhere rounded-xl border bg-card p-5 shadow-sm">
      <h1 className="text-lg font-semibold">没有找到这条记录</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        记录可能已被删除，或你没有查看该记录的权限。
      </p>
      <Link
        href="/owner"
        className="mt-4 inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90"
      >
        返回后台首页
      </Link>
    </section>
  );
}
