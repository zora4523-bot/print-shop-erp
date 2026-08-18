import Link from 'next/link';
import { ChevronDown } from 'lucide-react';
import {
  CreateCustomerPriceBookDraftForm,
  DiscardCustomerPriceBookDraftForm,
  PublishCustomerPriceBookDraftForm,
} from '@/components/business/price/ExternalSalesPriceBookDraftForms';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { CustomerPriceBookPurpose } from '@/generated/prisma/enums';
import type {
  CustomerPriceBookDraftAdminDto,
  CustomerPriceBookVersionAdminDto,
} from '@/lib/price/customer-price-book-admin';
import { cn } from '@/lib/utils';

type ExternalSalesPriceBookVersionPanelProps = {
  versions: CustomerPriceBookVersionAdminDto[];
  draft: CustomerPriceBookDraftAdminDto | null;
  invalidDraftSelection: boolean;
  defaultPublishAt: string;
};

const PURPOSE_LABELS: Record<CustomerPriceBookPurpose, string> = {
  [CustomerPriceBookPurpose.PROCESSING]: '加工费',
  [CustomerPriceBookPurpose.LOGISTICS]: '快递与打包耗材',
};

const PURPOSE_PARAMS: Record<CustomerPriceBookPurpose, string> = {
  [CustomerPriceBookPurpose.PROCESSING]: 'processing',
  [CustomerPriceBookPurpose.LOGISTICS]: 'logistics',
};

const STATUS_LABELS: Record<CustomerPriceBookVersionAdminDto['status'], string> = {
  DRAFT: '草稿',
  CURRENT: '当前生效',
  SCHEDULED: '计划生效',
  HISTORICAL: '历史',
};

function formatShanghaiDateTime(value: string | null): string {
  if (!value) return '长期';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
}

function statusVariant(
  status: CustomerPriceBookVersionAdminDto['status'],
): 'default' | 'secondary' | 'outline' {
  if (status === 'CURRENT') return 'default';
  if (status === 'SCHEDULED' || status === 'DRAFT') return 'secondary';
  return 'outline';
}

function itemsHref(purpose: CustomerPriceBookPurpose): string {
  return `/owner/prices/external-sales/items?purpose=${PURPOSE_PARAMS[purpose]}`;
}

function versionsHref(draftId: string): string {
  return `/owner/prices/external-sales/versions?draft=${encodeURIComponent(
    draftId,
  )}`;
}

function VersionHistory({
  purpose,
  versions,
}: {
  purpose: CustomerPriceBookPurpose;
  versions: CustomerPriceBookVersionAdminDto[];
}) {
  const draft = versions.find((version) => version.status === 'DRAFT');
  const hasCurrent = versions.some((version) => version.status === 'CURRENT');
  const hasScheduled = versions.some((version) => version.status === 'SCHEDULED');

  return (
    <section
      aria-labelledby={`price-book-history-${purpose}`}
      className="min-w-0 rounded-xl border bg-card p-4 shadow-sm"
    >
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <h2 id={`price-book-history-${purpose}`} className="font-semibold">
          {PURPOSE_LABELS[purpose]}
        </h2>
        <span className="font-sans text-xs tabular-nums text-muted-foreground">
          {versions.length} 个版本
        </span>
      </div>

      {versions.length > 0 ? (
        <ol className="mt-4 space-y-3">
          {versions.map((version) => (
            <li
              key={version.id}
              className="min-w-0 rounded-lg border bg-background p-3"
            >
              <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="admin-wrap-anywhere font-medium">
                    {version.name} · 第 {version.version} 版
                  </p>
                  <p className="mt-1 font-sans text-xs tabular-nums text-muted-foreground">
                    {version.status === 'DRAFT'
                      ? `基于第 ${version.basedOnVersion ?? '—'} 版 · 最后更新 ${formatShanghaiDateTime(
                          version.updatedAt,
                        )}`
                      : `${formatShanghaiDateTime(
                          version.effectiveFrom,
                        )} → ${formatShanghaiDateTime(version.effectiveTo)}`}
                  </p>
                </div>
                <Badge variant={statusVariant(version.status)}>
                  {STATUS_LABELS[version.status]}
                </Badge>
              </div>

              <dl className="mt-3 grid min-w-0 gap-2 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-muted-foreground">收费项目数</dt>
                  <dd className="mt-1 font-sans tabular-nums">
                    {version.ruleCount} 项
                  </dd>
                </div>
                {version.changeReason ? (
                  <div className="min-w-0">
                    <dt className="text-xs text-muted-foreground">调价原因</dt>
                    <dd className="admin-wrap-anywhere mt-1">
                      {version.changeReason}
                    </dd>
                  </div>
                ) : null}
              </dl>

              {version.status === 'DRAFT' ? (
                <div className="mt-3 flex min-w-0 flex-wrap gap-2">
                  <Link
                    href={itemsHref(version.purpose)}
                    prefetch={false}
                    className={cn(
                      buttonVariants({ variant: 'outline' }),
                      'min-h-11',
                    )}
                  >
                    编辑收费项目
                  </Link>
                  <Link
                    href={versionsHref(version.id)}
                    prefetch={false}
                    className={cn(buttonVariants(), 'min-h-11')}
                  >
                    准备发布
                  </Link>
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">尚无可用价目版本。</p>
      )}

      {draft ? null : hasScheduled ? (
        <p className="mt-4 text-sm text-muted-foreground">
          已有计划生效版本，待该版本生效后再创建下一份调价草稿。
        </p>
      ) : hasCurrent ? (
        <CreateCustomerPriceBookDraftForm
          purpose={purpose}
          returnHref={itemsHref(purpose)}
        />
      ) : (
        <p className="mt-4 text-sm text-destructive">
          当前没有可复制的生效版本，无法创建调价草稿。
        </p>
      )}
    </section>
  );
}

function DraftPublishPanel({
  draft,
  defaultPublishAt,
}: {
  draft: CustomerPriceBookDraftAdminDto;
  defaultPublishAt: string;
}) {
  return (
    <section
      aria-labelledby="selected-price-book-draft-heading"
      className="min-w-0 space-y-4 rounded-xl border bg-muted/20 p-4"
    >
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="selected-price-book-draft-heading" className="font-semibold">
            发布{PURPOSE_LABELS[draft.purpose]}草稿 · 第 {draft.version} 版
          </h2>
          <p className="admin-wrap-anywhere mt-1 text-sm text-muted-foreground">
            调价原因：{draft.changeReason}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            共 {draft.rules.length} 个收费项目；发布前会再次校验全部规则。
          </p>
        </div>
        <Link
          href={itemsHref(draft.purpose)}
          prefetch={false}
          className={cn(buttonVariants({ variant: 'outline' }), 'min-h-11')}
        >
          返回编辑收费项目
        </Link>
      </div>

      <PublishCustomerPriceBookDraftForm
        priceBookId={draft.id}
        expectedDraftUpdatedAt={draft.updatedAt}
        defaultEffectiveFrom={defaultPublishAt}
      />

      <details className="group min-w-0 rounded-lg border bg-card p-3">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-md font-medium focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
          <span>更多草稿操作</span>
          <ChevronDown
            aria-hidden="true"
            className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
          />
        </summary>
        <div className="border-t pt-3">
          <DiscardCustomerPriceBookDraftForm
            priceBookId={draft.id}
            expectedDraftUpdatedAt={draft.updatedAt}
          />
        </div>
      </details>
    </section>
  );
}

export function ExternalSalesPriceBookVersionPanel({
  versions,
  draft,
  invalidDraftSelection,
  defaultPublishAt,
}: ExternalSalesPriceBookVersionPanelProps) {
  return (
    <div
      id="external-sales-price-book-version-manager"
      className="min-w-0 space-y-6"
    >
      {invalidDraftSelection ? (
        <div role="alert" className="rounded-xl border bg-card p-4 text-sm">
          所选草稿不存在或已不可编辑，已安全返回发布中心。
        </div>
      ) : null}

      {draft ? (
        <DraftPublishPanel
          draft={draft}
          defaultPublishAt={defaultPublishAt}
        />
      ) : null}

      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        {Object.values(CustomerPriceBookPurpose).map((purpose) => (
          <VersionHistory
            key={purpose}
            purpose={purpose}
            versions={versions.filter((version) => version.purpose === purpose)}
          />
        ))}
      </div>

      <details className="group min-w-0 rounded-xl border bg-muted/30 p-4">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-md font-semibold focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
          <span>版本发布说明</span>
          <ChevronDown
            aria-hidden="true"
            className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
          />
        </summary>
        <ol className="mt-3 list-decimal space-y-2 border-t pt-3 pl-5 text-sm text-muted-foreground">
          <li>修改价格时建立新草稿，不覆盖已发布版本。</li>
          <li>发布前校验适用数量、金额和自动计价范围。</li>
          <li>新版本只影响生效后创建或重新报价的工单。</li>
          <li>历史工单继续使用创建时冻结的规则与金额快照。</li>
        </ol>
      </details>
    </div>
  );
}
