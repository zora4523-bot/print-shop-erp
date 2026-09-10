import Link from 'next/link';
import { Suspense } from 'react';
import {
  ExternalSalesPriceBookVersionPanel,
  externalPriceBookValidationMessage,
} from '@/components/business/price/ExternalSalesPriceBookVersionPanel';
import { RuleCenterPageHeader } from '@/components/business/rules/RuleCenterPageHeader';
import { buttonVariants } from '@/components/ui/button';
import {
  ContentSkeleton,
  ErrorBoundary,
  StatusBadge,
} from '@/components/ui-business';
import { CustomerPriceBookPurpose } from '@/generated/prisma/enums';
import { firstSearchParam } from '@/lib/admin/table';
import { requirePermission } from '@/lib/auth/permissions';
import {
  customerPricingHref,
  RULE_CENTER_HREFS,
} from '@/lib/navigation/rule-center';
import {
  getCustomerPriceBookDraft,
  getCustomerPriceBookDraftPublishPreview,
  listCustomerPriceBookVersionsAndDrafts,
} from '@/lib/price/customer-price-book-admin';
import { cn } from '@/lib/utils';
import { PriceDataBoundary } from './PriceDataBoundary';

export const metadata = {
  title: '价格版本与发布 · 红包印刷 ERP',
};

type PageProps = {
  searchParams: Promise<{
    draft?: string | string[];
    section?: string | string[];
  }>;
};

type VersionsPromise = ReturnType<
  typeof listCustomerPriceBookVersionsAndDrafts
>;
type DraftPromise = ReturnType<typeof getCustomerPriceBookDraft>;
type PublishPreviewPromise = ReturnType<
  typeof getCustomerPriceBookDraftPublishPreview
>;
type PriceBookVersion = Awaited<VersionsPromise>[number];

type GapDraftRequest = {
  version: PriceBookVersion;
  draftPromise: DraftPromise;
  publishPreviewPromise: PublishPreviewPromise;
};

type GapDraftResult = {
  version: PriceBookVersion;
  draft: Awaited<DraftPromise>;
  preview: Awaited<PublishPreviewPromise>;
};

const GAP_PURPOSES = [
  CustomerPriceBookPurpose.PROCESSING,
  CustomerPriceBookPurpose.LOGISTICS,
] as const;

const GAP_PURPOSE_META = {
  [CustomerPriceBookPurpose.PROCESSING]: {
    label: '加工费',
    code: 'PROCESSING',
    editHref: customerPricingHref('processing'),
  },
  [CustomerPriceBookPurpose.LOGISTICS]: {
    label: '物流费',
    code: 'LOGISTICS',
    editHref: customerPricingHref('logistics'),
  },
} as const;

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
  const isGapWorkspace = firstSearchParam(sp.section).trim() === 'gaps';
  const versionsPromise = listCustomerPriceBookVersionsAndDrafts();

  return (
    <div className="min-w-0 space-y-6">
      <RuleCenterPageHeader
        title={isGapWorkspace ? '缺口清单与版本历史' : '价格版本与发布'}
        effect="versioned"
        subtitle={
          isGapWorkspace
            ? '把会阻断自动报价或发布的真实问题先处理；加工费与物流费保持独立版本流。'
            : '审阅草稿差异和报价影响，发布后仅影响之后的新单。'
        }
        actions={
          <Link
            href={customerPricingHref('processing')}
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
            isGapWorkspace={isGapWorkspace}
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
  isGapWorkspace,
  versionsPromise,
}: {
  rawDraftId: string;
  draftId: string | null;
  isGapWorkspace: boolean;
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

  if (isGapWorkspace) {
    const draftRequests = versions
      .filter((version) => version.status === 'DRAFT')
      .map((version) => ({
        version,
        draftPromise: getCustomerPriceBookDraft(version.id),
        publishPreviewPromise: getCustomerPriceBookDraftPublishPreview(
          version.id,
        ),
      }));

    return (
      <PriceDataBoundary
        title="待处理清单暂时无法加载"
        description="发布已暂停；下方版本历史仍可查看。"
        preservedContent={history}
      >
        <Suspense
          fallback={
            <div className="min-w-0 space-y-4">
              <ContentSkeleton
                variant="form"
                rows={4}
                label="正在核对草稿差异与校验缺口"
              />
              {history}
            </div>
          }
        >
          <RulePriceGapsContent
            versions={versions}
            rawDraftId={rawDraftId}
            requestedDraft={requestedDraft}
            draftRequests={draftRequests}
          />
        </Suspense>
      </PriceDataBoundary>
    );
  }

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

function gapDraftHref(draftId: string): string {
  const params = new URLSearchParams({ section: 'gaps', draft: draftId });
  return `${RULE_CENTER_HREFS.priceVersions}?${params.toString()}#external-sales-price-book-version-manager`;
}

function PurposeGapCard({
  purpose,
  versions,
  draftResult,
}: {
  purpose: CustomerPriceBookPurpose;
  versions: Awaited<VersionsPromise>;
  draftResult: GapDraftResult | undefined;
}) {
  const meta = GAP_PURPOSE_META[purpose];
  const purposeVersions = versions.filter(
    (version) => version.purpose === purpose,
  );
  const current = purposeVersions.find(
    (version) => version.status === 'CURRENT',
  );
  const listedDraft = purposeVersions.find(
    (version) => version.status === 'DRAFT',
  );
  const scheduled = purposeVersions.find(
    (version) => version.status === 'SCHEDULED',
  );
  const preview = draftResult?.preview ?? null;
  const issueCount = preview?.validation.issues.length ?? 0;
  const status = listedDraft
    ? preview?.validation.status === 'FAIL'
      ? { tone: 'danger' as const, label: `${issueCount} 个阻断问题` }
      : preview
        ? { tone: 'warning' as const, label: '草稿待审阅' }
        : { tone: 'neutral' as const, label: '预览不可用' }
    : scheduled
      ? { tone: 'info' as const, label: '计划版待生效' }
      : current
        ? { tone: 'success' as const, label: '暂无草稿' }
        : { tone: 'danger' as const, label: '缺少当前版' };

  return (
    <article className="min-w-0 rounded-xl border bg-background p-4">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-sans text-xs font-semibold tracking-[0.16em] text-muted-foreground">
            {meta.code}
          </p>
          <h3 className="mt-1 font-semibold">{meta.label}独立版本流</h3>
        </div>
        <StatusBadge tone={status.tone} dot>
          {status.label}
        </StatusBadge>
      </div>

      <dl className="mt-4 grid grid-cols-3 gap-2 rounded-lg bg-muted/40 p-3 text-sm">
        <div className="min-w-0">
          <dt className="text-xs text-muted-foreground">当前</dt>
          <dd className="mt-1 font-sans font-semibold tabular-nums">
            {current ? `第 ${current.version} 版` : '—'}
          </dd>
        </div>
        <div className="min-w-0 border-l pl-3">
          <dt className="text-xs text-muted-foreground">草稿</dt>
          <dd className="mt-1 font-sans font-semibold tabular-nums">
            {listedDraft ? `第 ${listedDraft.version} 版` : '—'}
          </dd>
        </div>
        <div className="min-w-0 border-l pl-3">
          <dt className="text-xs text-muted-foreground">计划</dt>
          <dd className="mt-1 font-sans font-semibold tabular-nums">
            {scheduled ? `第 ${scheduled.version} 版` : '—'}
          </dd>
        </div>
      </dl>

      {preview ? (
        <div className="mt-4 space-y-3">
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <div className="rounded-lg border p-3">
              <dt className="text-xs text-muted-foreground">真实草稿差异</dt>
              <dd className="mt-1 font-sans font-semibold tabular-nums">
                {preview.changedItemCount} 个收费项 ·{' '}
                {preview.changedRuleCount} 条规则
              </dd>
            </div>
            <div className="rounded-lg border p-3">
              <dt className="text-xs text-muted-foreground">涨价 / 下调</dt>
              <dd className="mt-1 font-sans font-semibold tabular-nums">
                {preview.increasedRuleCount} / {preview.decreasedRuleCount} 条
              </dd>
            </div>
          </dl>

          {preview.validation.status === 'FAIL' ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
              <p className="text-sm font-semibold text-destructive">
                校验未通过，当前不能发布
              </p>
              <ul className="mt-2 space-y-1.5 text-sm">
                {preview.validation.issues.map((issue, index) => (
                  <li
                    key={`${issue.ruleId ?? 'price-book'}-${index}`}
                    className="admin-wrap-anywhere"
                  >
                    · {externalPriceBookValidationMessage(issue.message)}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="rounded-lg border border-success/30 bg-success/10 p-3 text-sm leading-6 text-success-foreground">
              真实规则校验已通过；进入发布面板后仍需确认生效时间和发布说明。
            </p>
          )}
        </div>
      ) : listedDraft ? (
        <p className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          草稿已列出，但完整预览数据不可用，当前不应发布。
        </p>
      ) : (
        <p className="mt-4 text-sm leading-6 text-muted-foreground">
          {scheduled
            ? `计划第 ${scheduled.version} 版已经排期，待生效后才能创建下一份调价草稿。`
            : current
              ? '当前没有待发布草稿。'
              : '当前没有可复制的生效版本，无法创建调价草稿。'}
        </p>
      )}

      <div className="mt-4 flex min-w-0 flex-wrap gap-2 border-t pt-4">
        {listedDraft && preview && draftResult?.draft ? (
          <Link
            href={gapDraftHref(listedDraft.id)}
            prefetch={false}
            className={cn(buttonVariants(), 'min-h-11')}
          >
            审阅差异并准备发布
          </Link>
        ) : null}
        <Link
          href={meta.editHref}
          prefetch={false}
          className={cn(buttonVariants({ variant: 'outline' }), 'min-h-11')}
        >
          打开{meta.label}规则
        </Link>
        <Link
          href={`#price-book-history-${purpose}`}
          className={cn(buttonVariants({ variant: 'ghost' }), 'min-h-11')}
        >
          查看{meta.label}历史
        </Link>
      </div>
    </article>
  );
}

function RulePriceGapWorkspace({
  versions,
  draftResults,
}: {
  versions: Awaited<VersionsPromise>;
  draftResults: GapDraftResult[];
}) {
  const listedDrafts = versions.filter((version) => version.status === 'DRAFT');
  const previews = draftResults.flatMap((result) =>
    result.preview ? [result.preview] : [],
  );
  const changedItemCount = previews.reduce(
    (total, preview) => total + preview.changedItemCount,
    0,
  );
  const changedRuleCount = previews.reduce(
    (total, preview) => total + preview.changedRuleCount,
    0,
  );
  const issueCount = previews.reduce(
    (total, preview) => total + preview.validation.issues.length,
    0,
  );

  return (
    <section
      aria-labelledby="rule-price-gap-workspace-heading"
      className="min-w-0 overflow-hidden rounded-xl border bg-card shadow-sm"
    >
      <header className="flex min-w-0 flex-wrap items-start justify-between gap-4 border-b bg-muted/30 px-4 py-4 sm:px-5">
        <div className="min-w-0">
          <p className="font-sans text-xs font-semibold tracking-[0.16em] text-muted-foreground">
            PENDING WORKSPACE
          </p>
          <h2
            id="rule-price-gap-workspace-heading"
            className="mt-1 text-lg font-semibold"
          >
            待处理工作队列
          </h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
            这里只汇总真实草稿差异、发布校验和版本影响。加工费与物流费必须分别审阅、分别发布，版本号互不绑定。
          </p>
        </div>
        <StatusBadge
          tone={
            issueCount > 0
              ? 'danger'
              : listedDrafts.length > 0
                ? 'warning'
                : 'success'
          }
          dot
        >
          {issueCount > 0
            ? `${issueCount} 个阻断问题`
            : listedDrafts.length > 0
              ? `${listedDrafts.length} 份草稿待审阅`
              : '当前无草稿待审'}
        </StatusBadge>
      </header>

      <div className="grid min-w-0 gap-3 border-b px-4 py-3 text-sm sm:grid-cols-3 sm:px-5">
        <div className="flex items-baseline justify-between gap-3 sm:block">
          <p className="text-xs text-muted-foreground">待审草稿</p>
          <p className="mt-1 font-sans text-lg font-semibold tabular-nums">
            {listedDrafts.length} 份
          </p>
        </div>
        <div className="flex items-baseline justify-between gap-3 sm:block sm:border-l sm:pl-4">
          <p className="text-xs text-muted-foreground">真实变更</p>
          <p className="mt-1 font-sans text-lg font-semibold tabular-nums">
            {changedItemCount} 项 · {changedRuleCount} 条
          </p>
        </div>
        <div className="flex items-baseline justify-between gap-3 sm:block sm:border-l sm:pl-4">
          <p className="text-xs text-muted-foreground">校验缺口</p>
          <p
            className={cn(
              'mt-1 font-sans text-lg font-semibold tabular-nums',
              issueCount > 0 ? 'text-destructive' : 'text-success-foreground',
            )}
          >
            {issueCount} 个
          </p>
        </div>
      </div>

      <div className="grid min-w-0 gap-4 p-4 lg:grid-cols-2 sm:p-5">
        {GAP_PURPOSES.map((purpose) => (
          <PurposeGapCard
            key={purpose}
            purpose={purpose}
            versions={versions}
            draftResult={draftResults.find(
              (result) => result.version.purpose === purpose,
            )}
          />
        ))}
      </div>
    </section>
  );
}

async function RulePriceGapsContent({
  versions,
  rawDraftId,
  requestedDraft,
  draftRequests,
}: {
  versions: Awaited<VersionsPromise>;
  rawDraftId: string;
  requestedDraft: PriceBookVersion | undefined;
  draftRequests: GapDraftRequest[];
}) {
  const draftResults = await Promise.all(
    draftRequests.map(async (request) => {
      const [draft, preview] = await Promise.all([
        request.draftPromise,
        request.publishPreviewPromise,
      ]);
      return { version: request.version, draft, preview };
    }),
  );
  const workspace = (
    <RulePriceGapWorkspace versions={versions} draftResults={draftResults} />
  );
  const selectedResult = requestedDraft
    ? draftResults.find((result) => result.version.id === requestedDraft.id)
    : undefined;

  return (
    <div className="min-w-0 space-y-6">
      {workspace}
      <ExternalSalesPriceBookVersionPanel
        versions={versions}
        draft={selectedResult?.draft ?? null}
        preview={selectedResult?.preview ?? null}
        invalidDraftSelection={
          Boolean(rawDraftId) &&
          (!requestedDraft || !selectedResult?.draft || !selectedResult.preview)
        }
        defaultPublishAt=""
      />
    </div>
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
