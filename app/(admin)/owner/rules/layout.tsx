import { RuleCenterWorkspaceBar } from '@/components/business/rules/RuleCenterWorkspaceBar';
import { getRuleCenterPriceVersionSummary } from '@/components/business/rules/RuleCenterPriceWorkspaceData';
import { RuleCenterNavigation } from '@/components/business/rules/RuleCenterNavigation';
import { requireSession } from '@/lib/auth/session';
import { getAdminMenuItems } from '@/lib/navigation/admin-menu';
import { RULE_CENTER_HREFS } from '@/lib/navigation/rule-center';

export default async function RuleCenterLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const { user } = await requireSession();
  const items = getAdminMenuItems(user)
    .flatMap((group) => group.items)
    .find((item) => item.href === RULE_CENTER_HREFS.root)?.children ?? [];
  return (
    <div className="mx-auto min-w-0 max-w-[1180px]">
      <RuleCenterNavigation items={items} />
      <RuleCenterWorkspaceBar
        loadPriceVersionSummary={getRuleCenterPriceVersionSummary}
      />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
