'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Card } from '@/components/ui/card';
import { Disclosure, DisclosureIndicator, DisclosureSummary } from '@/components/ui/disclosure';
import { LinkPendingHint } from '@/components/ui-business';
import { getActiveAdminMenuHref, type AdminMenuItem } from '@/lib/navigation/admin-menu';
import { RULE_CENTER_HREFS } from '@/lib/navigation/rule-center';
import { cn } from '@/lib/utils';

/** 子页目录只消费布局传入的授权菜单，总览页已有同源分类入口。 */
export function RuleCenterNavigation({ items }: { items: readonly AdminMenuItem[] }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  if (pathname === RULE_CENTER_HREFS.root || items.length === 0) return null;

  const activeHref = getActiveAdminMenuHref(pathname, items, searchParams);
  const groups = new Map<string, AdminMenuItem[]>();
  for (const item of items) {
    const label = item.menuGroupLabel ?? '规则';
    groups.set(label, [...(groups.get(label) ?? []), item]);
  }

  return (
    <Card className="mb-4 gap-0 py-0">
      <Disclosure>
        <DisclosureSummary className="gap-3 px-3">
          规则目录
          <DisclosureIndicator />
        </DisclosureSummary>
        <nav aria-label="规则模块导航" className="grid min-w-0 gap-4 border-t p-3 lg:grid-cols-3">
          {[...groups].map(([label, entries]) => (
            <section key={label} aria-label={label} className="min-w-0">
              <h2 className="mb-1 px-2 text-xs font-medium text-muted-foreground">{label}</h2>
              <ul className="space-y-0.5">
                {entries.map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      prefetch={false}
                      scroll={false}
                      aria-current={item.href === activeHref ? 'page' : undefined}
                      className={cn(
                        'relative flex min-h-11 min-w-0 items-center gap-2 rounded-md px-2 py-2 text-sm leading-5 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        item.href === activeHref && 'bg-primary/10 font-medium text-primary hover:bg-primary/15',
                      )}
                    >
                      <span className="min-w-0 flex-1">{item.label}</span>
                      <LinkPendingHint />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </nav>
      </Disclosure>
    </Card>
  );
}
