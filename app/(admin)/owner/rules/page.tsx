import { Calculator, History, Users, type LucideIcon } from 'lucide-react';
import { ActionShortcut, PageHeader } from '@/components/ui-business';
import { requirePermission } from '@/lib/auth/permissions';
import {
  RULE_CENTER_HREFS,
  customerPricingHref,
} from '@/lib/navigation/rule-center';

export const metadata = {
  title: '规则配置中心 · 红包印刷 ERP',
};

type QuickAction = {
  label: string;
  description: string;
  href: string;
  icon: LucideIcon;
};

const QUICK_ACTIONS: readonly QuickAction[] = [
  {
    label: '客户计价',
    description: '维护加工费与物流费。',
    href: customerPricingHref('processing'),
    icon: Calculator,
  },
  {
    label: '价格版本',
    description: '审核并发布调价版本。',
    href: RULE_CENTER_HREFS.priceVersions,
    icon: History,
  },
  {
    label: '师傅计件',
    description: '维护计件与装版标准。',
    href: RULE_CENTER_HREFS.workerPiecework,
    icon: Users,
  },
];

export default async function RuleCenterPage() {
  await requirePermission('dict:price:manage');

  return (
    <div className="space-y-6">
      <PageHeader title="规则配置中心" />

      <section className="space-y-3" aria-labelledby="quick-actions-heading">
        <h2 id="quick-actions-heading" className="text-base font-semibold">
          常用操作
        </h2>
        <div className="grid gap-3 md:grid-cols-3">
          {QUICK_ACTIONS.map((action) => (
            <ActionShortcut
              key={action.href}
              href={action.href}
              icon={action.icon}
              label={action.label}
              description={action.description}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
