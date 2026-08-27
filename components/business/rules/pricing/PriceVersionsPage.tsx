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
import { RULE_CENTER_HREFS } from '@/lib/navigation/rule-center';
import { PriceDataBoundary } from './PriceDataBoundary';

export const metadata = {
  title: '价格版本与发布 · 红包印刷 ERP',
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

export default async function PriceVersionsPage({
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
        title="价格版本与发布"
        actions={
          <Link
            href={RULE_CENTER_HREFS.customerPricing}
            prefetch={false}
            className={buttonVariants({ variant: 'outline' })}
          >
            返回客户计价
          </Link>
        }
      />
      <ErrorBoundary
        scope="section"
        title="发布数据暂时无法加载"
        description="请重试。"
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
      description="发布已暂停，请重试。"
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
