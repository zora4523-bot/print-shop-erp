import Link from 'next/link';
import {
  CustomerPriceBookPurpose,
  OrderSettlementType,
} from '@/generated/prisma/enums';
import { ExternalSalesPriceBookCatalog } from '@/components/business/price/ExternalSalesPriceBookCatalog';
import {
  ExternalSalesQuoteSectionNav,
  resolveExternalSalesQuoteSection,
} from '@/components/business/price/ExternalSalesQuoteSectionNav';
import { buttonVariants } from '@/components/ui/button';
import { PageHeader } from '@/components/ui-business';
import { requirePermission } from '@/lib/auth/permissions';
import { getActiveCustomerPriceBookCatalog } from '@/lib/price/customer-price-book';

export const metadata = {
  title: '外部销售报价查询 · 红包印刷 ERP',
};

type PageProps = {
  searchParams: Promise<{
    section?: string | string[];
  }>;
};

const SECTION_SUBTITLES = {
  processing:
    '查询外部销售工单的加工费规则。标为需人工确认的项目不得套用相邻档位。',
  logistics:
    '查询快递费与打包耗材价目。价目未覆盖的地区、承运商或包装方案必须联系管理员确认。',
} as const;

export default async function SalesQuotePage({ searchParams }: PageProps) {
  await requirePermission('order:create');
  const resolvedSection = resolveExternalSalesQuoteSection(
    (await searchParams).section,
    { allowVersions: false },
  );
  const section =
    resolvedSection === 'logistics' ? 'logistics' : 'processing';
  const catalog = await getActiveCustomerPriceBookCatalog(
    OrderSettlementType.EXTERNAL_SALES,
    section === 'logistics'
      ? CustomerPriceBookPurpose.LOGISTICS
      : CustomerPriceBookPurpose.PROCESSING,
  );

  return (
    <div className="min-w-0 space-y-6">
      <PageHeader
        title="外部销售报价查询"
        subtitle={SECTION_SUBTITLES[section]}
        actions={
          <Link href="/orders/new" className={buttonVariants()}>
            创建工单
          </Link>
        }
      />
      <ExternalSalesQuoteSectionNav
        activeSection={section}
        perspective="sales"
      />
      <ExternalSalesPriceBookCatalog catalog={catalog} perspective="sales" />
    </div>
  );
}
