import Link from 'next/link';
import {
  ArrowRight,
  Calculator,
  Database,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { requirePermission } from '@/lib/auth/permissions';
import { RuleCenterPageHeader } from '@/components/business/rules/RuleCenterPageHeader';
import {
  RULE_CENTER_SIDEBAR_ITEMS,
  type RuleCenterEffect,
} from '@/lib/navigation/rule-center';

export const metadata = {
  title: '规则配置中心',
};

const RULE_GROUPS = [
  {
    label: '客户计价规则',
    description:
      '加工费、包装与快递价格',
    effect: 'versioned',
    icon: Calculator,
  },
  {
    label: '建单主数据',
    description:
      '纸张、产品结构与工艺',
    effect: 'immediate',
    icon: Database,
  },
  {
    label: '员工薪酬规则',
    description:
      '计件工价、标准工时与加班起点',
    effect: 'effective-dated',
    icon: Users,
  },
] as const satisfies readonly {
  label: string;
  description: string;
  effect: RuleCenterEffect;
  icon: LucideIcon;
}[];

export default async function RuleCenterPage() {
  await requirePermission('dict:price:manage');

  return (
    <div className="space-y-6">
      <RuleCenterPageHeader
        title="规则配置中心"
        effect="mixed"
      />

      <div className="grid min-w-0 gap-4 xl:grid-cols-2 2xl:grid-cols-3">
        {RULE_GROUPS.map((group) => {
          const Icon = group.icon;
          const items = RULE_CENTER_SIDEBAR_ITEMS.filter(
            (item) =>
              'menuGroupLabel' in item &&
              item.menuGroupLabel === group.label,
          );

          return (
            <section
              key={group.label}
              aria-labelledby={`rule-group-${group.effect}`}
              className="min-w-0 rounded-xl border bg-card p-4 shadow-sm sm:p-5"
            >
              <div className="flex min-w-0 items-start gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground">
                  <Icon aria-hidden="true" className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <h2
                    id={`rule-group-${group.effect}`}
                    className="text-base font-semibold"
                  >
                    {group.label}
                  </h2>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {group.description}
                  </p>
                </div>
              </div>

              <div className="mt-4 divide-y rounded-lg border">
                {items.map((item) => (
                  <Link
                    key={item.id}
                    href={item.href}
                    className="group flex min-h-11 min-w-0 items-center gap-3 px-3 py-2.5 text-sm transition-colors first:rounded-t-lg last:rounded-b-lg hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{item.label}</span>
                    </span>
                    <ArrowRight
                      aria-hidden="true"
                      className="size-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                    />
                  </Link>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
