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
import { Badge } from '@/components/ui/badge';
import {
  RULE_CENTER_SIDEBAR_ITEMS,
  type RuleCenterEffect,
} from '@/lib/navigation/rule-center';
import { RULE_CENTER_EFFECT_REGISTRY } from '@/lib/ui/status-registry';

export const metadata = {
  title: '规则配置中心 · 红包印刷 ERP',
};

const RULE_GROUPS = [
  {
    label: '客户计价规则',
    description:
      '建单收费的唯一价格来源。改价形成新版本，不回算历史工单。',
    effect: 'versioned',
    icon: Calculator,
  },
  {
    label: '建单主数据',
    description:
      '维护纸张、可建单产品组合、产品结构与工艺字典，用于建单校验和隐式匹配。',
    effect: 'immediate',
    icon: Database,
  },
  {
    label: '员工薪酬规则',
    description:
      '维护客服提成、计时工与固定工资版本。工序计件工价不在这里配置。',
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
        subtitle="按业务边界管理客户计价、建单主数据与员工薪酬。"
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
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                        {item.impact}
                      </span>
                    </span>
                    <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
                      {RULE_CENTER_EFFECT_REGISTRY[item.effect].label}
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

      <section
        aria-labelledby="piecework-price-boundary"
        className="rounded-xl border border-dashed bg-muted/20 p-4 sm:p-5"
      >
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="piecework-price-boundary" className="font-semibold">
            工序计件工价
          </h2>
          <Badge variant="outline">边界说明 · 未开放配置</Badge>
        </div>
        <p className="mt-2 max-w-4xl text-sm leading-6 text-muted-foreground">
          计件工价将按工序类型 PARTIAL、FULL、PACKING 维护并版本发布，
          用于扫码报工结算；它不是客户价格，也不做人员与工单匹配。
          配置界面未上线前，这里仅说明边界，不展示无效的可写入口。
        </p>
      </section>
    </div>
  );
}
