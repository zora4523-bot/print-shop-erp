import Link from 'next/link';
import { Bell } from 'lucide-react';

export async function NotificationAttention({ countPromise }: { countPromise: Promise<number> }) {
  const count = await countPromise;
  if (count === 0) return null;
  return <div className="flex min-w-0 flex-wrap items-center gap-3 rounded-xl border border-warning/40 bg-warning/5 px-4 py-2 text-sm">
    <Bell aria-hidden="true" className="size-4 text-warning-foreground" />
    <p className="min-w-0 flex-1">近 24 小时有 <span className="font-semibold tabular-nums">{count}</span> 条推送异常</p>
    <Link href="/owner/notifications" className="inline-flex min-h-11 items-center font-medium text-primary underline-offset-2 hover:underline">查看推送记录 →</Link>
  </div>;
}
