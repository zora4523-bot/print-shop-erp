import Link from 'next/link';
import { ExternalSalesPriceBookVersionPanel } from '@/components/business/price/ExternalSalesPriceBookVersionPanel';
import { buttonVariants } from '@/components/ui/button';
import { PageHeader } from '@/components/ui-business';
import { firstSearchParam } from '@/lib/admin/table';
import { requirePermission } from '@/lib/auth/permissions';
import {
  getCustomerPriceBookDraft,
  listCustomerPriceBookVersionsAndDrafts,
} from '@/lib/price/customer-price-book-admin';

export const metadata = {
  title: '外部销售收费发布中心 · 红包印刷 ERP',
};

type PageProps = {
  searchParams: Promise<{ draft?: string | string[] }>;
};

function safeOpaqueId(value: string): string | null {
  const normalized = value.trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(normalized) ? normalized : null;
}

export default async function ExternalSalesPriceBookVersionsPage({
  searchParams,
}: PageProps) {
  await requirePermission('dict:price:manage');
  const sp = await searchParams;
  const rawDraftId = firstSearchParam(sp.draft).trim();
  const draftId = safeOpaqueId(rawDraftId);
  const versions = await listCustomerPriceBookVersionsAndDrafts();
  const requestedDraft = draftId
    ? versions.find(
        (version) => version.id === draftId && version.status === 'DRAFT',
      )
    : undefined;
  const draft = requestedDraft
    ? await getCustomerPriceBookDraft(requestedDraft.id)
    : null;

  return (
    <div className="min-w-0 space-y-6">
      <PageHeader
        title="发布中心"
        subtitle="集中查看调价草稿、计划生效和历史版本；日常收费项目查看与编辑在独立工作台完成。"
        actions={
          <Link
            href="/owner/prices/external-sales/items"
            prefetch={false}
            className={buttonVariants({ variant: 'outline' })}
          >
            返回收费项目
          </Link>
        }
      />
      <ExternalSalesPriceBookVersionPanel
        versions={versions}
        draft={draft}
        invalidDraftSelection={Boolean(rawDraftId) && !draft}
        defaultPublishAt=""
      />
    </div>
  );
}
