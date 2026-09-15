import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { CustomerPricingDedicatedSection } from './CustomerPricingDedicatedSection';
import { ContentSkeleton, ErrorBoundary } from '@/components/ui-business';
import { firstSearchParam } from '@/lib/admin/table';
import { requirePermission } from '@/lib/auth/permissions';
import { CustomerPriceBookPurpose } from '@/generated/prisma/enums';
import {
  CUSTOMER_PRICE_SECTIONS,
  getCustomerPriceSectionWorkspace,
  type CustomerPriceSection,
  type CustomerPriceSectionWorkspaceDto,
} from '@/lib/price/customer-price-section-workspace';
import { RULE_CENTER_HREFS } from '@/lib/navigation/rule-center';

export const metadata = {
  title: '客户计价规则',
};

type SearchParams = {
  section?: string | string[];
  start?: string | string[];
  purpose?: string | string[];
  focus?: string | string[];
};

type PageProps = { searchParams: Promise<SearchParams> };

function customerPricingSection(value: string): CustomerPriceSection | null {
  return CUSTOMER_PRICE_SECTIONS.includes(value as CustomerPriceSection)
    ? (value as CustomerPriceSection)
    : null;
}

function createDraftPurpose(
  start: string,
  purpose: string,
): CustomerPriceBookPurpose | null {
  if (start !== '1') return null;
  const normalized = purpose.trim().toLowerCase();
  if (normalized === 'processing') return CustomerPriceBookPurpose.PROCESSING;
  if (normalized === 'logistics') return CustomerPriceBookPurpose.LOGISTICS;
  return null;
}

function safeRuleId(value: string): string | null {
  const normalized = value.trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(normalized) ? normalized : null;
}

export default async function CustomerPricingWorkspacePage({
  searchParams,
}: PageProps) {
  await requirePermission('dict:price:manage');
  const sp = await searchParams;
  const section = customerPricingSection(firstSearchParam(sp.section));

  // 生产规则中心只提供设计稿对应的业务编辑器。无参数或旧版深链
  // 统一收敛到第一个正式入口，不再回落到通用搜索矩阵。
  if (!section) {
    redirect(`${RULE_CENTER_HREFS.customerPricing}?section=blank`);
  }

  const workspacePromise = getCustomerPriceSectionWorkspace(section);
  return (
    <div className="min-w-0">
      <ErrorBoundary
        scope="section"
        title="价格业务板块暂时无法加载"
        description="规则中心版本栏与发布入口仍可使用；请重试当前板块。"
      >
        <Suspense fallback={<DedicatedSectionSkeleton />}>
          <DedicatedCustomerPricingSectionContent
            workspacePromise={workspacePromise}
            createDraftPurpose={createDraftPurpose(
              firstSearchParam(sp.start),
              firstSearchParam(sp.purpose),
            )}
            focusRuleId={safeRuleId(firstSearchParam(sp.focus))}
          />
        </Suspense>
      </ErrorBoundary>
    </div>
  );
}

function DedicatedSectionSkeleton() {
  return (
    <div className="min-w-0" aria-busy="true" aria-live="polite">
      <ContentSkeleton
        variant="table"
        rows={8}
        label="正在加载价格业务板块"
      />
    </div>
  );
}

async function DedicatedCustomerPricingSectionContent({
  workspacePromise,
  createDraftPurpose,
  focusRuleId,
}: {
  workspacePromise: Promise<CustomerPriceSectionWorkspaceDto>;
  createDraftPurpose: CustomerPriceBookPurpose | null;
  focusRuleId: string | null;
}) {
  const workspace = await workspacePromise;
  return (
    <CustomerPricingDedicatedSection
      workspace={workspace}
      createDraftPurpose={createDraftPurpose}
      focusRuleId={focusRuleId}
    />
  );
}
