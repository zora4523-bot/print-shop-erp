import { RuleCenterWorkspaceBar } from '@/components/business/rules/RuleCenterWorkspaceBar';
import { getRuleCenterPriceVersionSummary } from '@/components/business/rules/RuleCenterPriceWorkspaceData';

export default function RuleCenterLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="mx-auto min-w-0 max-w-[1180px]">
      <RuleCenterWorkspaceBar
        loadPriceVersionSummary={getRuleCenterPriceVersionSummary}
      />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
