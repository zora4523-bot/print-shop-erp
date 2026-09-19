'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ClipboardList, ListTodo, WalletCards } from 'lucide-react';
import { cn } from '@/lib/utils';

const WORKER_NAV_ITEMS = [
  { href: '/worker/tasks', label: '我的任务', icon: ListTodo },
  { href: '/worker/orders', label: '我的工单', icon: ClipboardList },
  { href: '/worker/salary', label: '我的工资', icon: WalletCards },
] as const;

export function workerNavItemIsCurrent(pathname: string, href: string) {
  if (href === '/worker/tasks' && (pathname === '/worker/reports' || pathname.startsWith('/worker/reports/'))) return true;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function WorkerBottomNavigation() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="师傅工作台导航"
      className="worker-safe-inline worker-safe-bottom fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 pt-1 shadow-[0_-6px_20px_-16px_var(--foreground)] backdrop-blur-sm"
    >
      <div className="mx-auto grid w-full max-w-3xl grid-cols-3 gap-1 text-xs">
        {WORKER_NAV_ITEMS.map((item) => {
          const current = workerNavItemIsCurrent(pathname, item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={current ? 'page' : undefined}
              className={cn(
                'flex min-h-12 min-w-0 flex-col items-center justify-center gap-0.5 rounded-lg px-2 py-1 text-center transition-colors',
                current
                  ? 'bg-muted font-semibold text-foreground'
                  : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
              )}
            >
              <Icon aria-hidden="true" className="size-4" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
