import Link from 'next/link';
import { Suspense } from 'react';
import { ExternalSalesPriceBookVersionPanel } from '@/components/business/price/ExternalSalesPriceBookVersionPanel';
import { buttonVariants } from '@/components/ui/button';
import {
  ContentSkeleton,
  ErrorBoundary,
  PageHeader,
} from '@/components/ui-business';
import { firstSearchParam } from '@/lib/admin/table';
import { requirePermission } from '@/lib/auth/permissions';
import {
  getCustomerPriceBookDraft,
  getCustomerPriceBookDraftPublishPreview,
  listCustomerPriceBookVersionsAndDrafts,
} from '@/lib/price/customer-price-book-admin';
import { PriceDataBoundary } from '../../_components/PriceDataBoundary';

export const metadata = {
  title: '外部销售收费发布中心 · 红包印刷 ERP',
};

type PageProps = {
  searchParams: Promise<{ draft?: string | string[] }>;
};

type VersionsPromise = ReturnType<
  typeof listCustomerPriceBookVersionsAndDrafts
>;
type DraftPromise = ReturnType<typeof getCustomerPriceBookDraft>;
type PublishPreviewPromise = ReturnType<
  typeof getCustomerPriceBookDraftPublishPreview
>;

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
  const versionsPromise = listCustomerPriceBookVersionsAndDrafts();

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
      <ErrorBoundary
        scope="section"
        title="发布数据暂时无法加载"
        description="页面导航仍可使用；请重试发布版本区域。"
      >
        <Suspense fallback={<ContentSkeleton variant="table" rows={6} />}>
          <ExternalSalesPriceBookVersionsContent
            rawDraftId={rawDraftId}
            draftId={draftId}
            versionsPromise={versionsPromise}
          />
        </Suspense>
      </ErrorBoundary>
    </div>
  );
}

async function ExternalSalesPriceBookVersionsContent({
  rawDraftId,
  draftId,
  versionsPromise,
}: {
  rawDraftId: string;
  draftId: string | null;
  versionsPromise: VersionsPromise;
}) {
  const versions = await versionsPromise;
  const requestedDraft = draftId
    ? versions.find(
        (version) => version.id === draftId && version.status === 'DRAFT',
      )
    : undefined;
  const history = (
    <ExternalSalesPriceBookVersionPanel
      versions={versions}
      draft={null}
      preview={null}
      invalidDraftSelection={Boolean(rawDraftId) && !requestedDraft}
      defaultPublishAt=""
    />
  );

  if (!requestedDraft) return history;

  // 只在上方版本列表确认为可编辑草稿后启动，各读取一次。
  const draftPromise = getCustomerPriceBookDraft(requestedDraft.id);
  const publishPreviewPromise = getCustomerPriceBookDraftPublishPreview(
    requestedDraft.id,
  );

  return (
    <PriceDataBoundary
      title="发布预览暂时无法加载"
      description="已阻止发布；版本列表和收费项目入口仍可使用。"
      preservedContent={history}
    >
      <Suspense
        fallback={
          <div className="min-w-0 space-y-4">
            <ContentSkeleton
              variant="form"
              rows={4}
              label="正在加载发布预览"
            />
            {history}
          </div>
        }
      >
        <ExternalSalesPriceBookDraftPreview
          versions={versions}
          draftPromise={draftPromise}
          publishPreviewPromise={publishPreviewPromise}
        />
      </Suspense>
    </PriceDataBoundary>
  );
}

async function ExternalSalesPriceBookDraftPreview({
  versions,
  draftPromise,
  publishPreviewPromise,
}: {
  versions: Awaited<VersionsPromise>;
  draftPromise: DraftPromise;
  publishPreviewPromise: PublishPreviewPromise;
}) {
  const [draft, preview] = await Promise.all([
    draftPromise,
    publishPreviewPromise,
  ]);

  return (
    <ExternalSalesPriceBookVersionPanel
      versions={versions}
      draft={draft}
      preview={preview}
      invalidDraftSelection={!draft}
      defaultPublishAt=""
    />
  );
}
