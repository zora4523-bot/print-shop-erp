import Link from 'next/link';
import { ChevronDown } from 'lucide-react';
import {
  CreateCustomerPriceBookDraftForm,
  DiscardCustomerPriceBookDraftForm,
  PublishCustomerPriceBookDraftForm,
} from '@/components/business/price/ExternalSalesPriceBookDraftForms';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Disclosure, DisclosureSummary } from '@/components/ui/disclosure';
import { StatusBadge } from '@/components/ui-business';
import {
  CustomerPriceBookPurpose,
  CustomerPriceCalculationType,
} from '@/generated/prisma/enums';
import type {
  CustomerPriceBookDraftAdminDto,
  CustomerPriceBookDraftImpactChangeDto,
  CustomerPriceBookDraftPublishPreviewDto,
  CustomerPriceBookVersionAdminDto,
} from '@/lib/price/customer-price-book-admin';
import { formatDateTimeShanghai } from '@/lib/format/dates';
import {
  externalPriceBusinessText,
  externalPriceRuleDisplayName,
} from '@/lib/price/external-price-display';
import { CUSTOMER_PRICE_BOOK_VERSION_STATUS_REGISTRY } from '@/lib/ui/status-registry';
import { cn } from '@/lib/utils';
import {
  customerPricingHref,
  priceVersionsHref,
  type CustomerPricingPurpose,
} from '@/lib/navigation/rule-center';

type ExternalSalesPriceBookVersionPanelProps = {
  versions: CustomerPriceBookVersionAdminDto[];
  draft: CustomerPriceBookDraftAdminDto | null;
  preview: CustomerPriceBookDraftPublishPreviewDto | null;
  invalidDraftSelection: boolean;
  defaultPublishAt: string;
};

const PURPOSE_LABELS: Record<CustomerPriceBookPurpose, string> = {
  [CustomerPriceBookPurpose.PROCESSING]: '加工费',
  [CustomerPriceBookPurpose.LOGISTICS]: '物流费',
};

const PURPOSE_PARAMS: Record<CustomerPriceBookPurpose, CustomerPricingPurpose> = {
  [CustomerPriceBookPurpose.PROCESSING]: 'processing',
  [CustomerPriceBookPurpose.LOGISTICS]: 'logistics',
};

function formatShanghaiDateTime(value: string | null): string {
  return formatDateTimeShanghai(value ? new Date(value) : null, '长期');
}

function PriceBookVersionStatusBadge({
  status,
}: {
  status: CustomerPriceBookVersionAdminDto['status'];
}) {
  const definition = CUSTOMER_PRICE_BOOK_VERSION_STATUS_REGISTRY[status];
  return (
    <StatusBadge tone={definition.tone} dot={definition.dot}>
      {definition.label}
    </StatusBadge>
  );
}

function itemsHref(purpose: CustomerPriceBookPurpose): string {
  return customerPricingHref(PURPOSE_PARAMS[purpose]);
}

function versionsHref(draftId: string): string {
  return priceVersionsHref(draftId);
}

/**
 * Published history can contain validation text produced by an older server.
 * Keep the release screen business-facing even while that history is being
 * repaired; technical identifiers remain in server logs and issue metadata,
 * not in the administrator UI.
 */
export function externalPriceBookValidationMessage(message: string): string {
  return externalPriceBusinessText(message)
    .replace(/ADD_ON\s*\/\s*PER_BAG/g, '自动按实际袋数计价')
    .replace(/ADD_ON\s*\/\s*FIXED_AMOUNT/g, '自动固定金额计价')
    .replace(/\bPACKAGING_GROUP_MODE\b/g, '包装方式')
    .replace(/\bSINGLE_STYLE\b/g, '单款装')
    .replace(/\bMIXED_STYLE\b/g, '混装')
    .replace(/\bZTO_PROVINCE_RATE\b/g, '中通地区费率')
    .replace(/\bPACKING_MATERIAL_QUANTITY_TIER\b/g, '打包耗材数量范围')
    .replace(/\bPER_BAG\b/g, '按实际袋数计价')
    .replace(/\bFIXED_AMOUNT\b/g, '固定金额计价')
    .replace(/\bADD_ON\b/g, '附加收费')
    .replace(/\bexclusiveGroup\b/g, '适用范围')
    .replace(/\bcarrierCode\b/g, '承运商')
    .replace(/\bprovinces\b/g, '省份')
    .replace(/\bunitsPerSheet\b/g, '每张成品数')
    .replace(/\bissue\.path\b/g, '问题位置')
    .replace(/Unrecognized key:[^。；]*/gi, '存在系统无法识别的适用条件')
    .replace(/Invalid (?:option|input)[^。；]*/gi, '选项设置无效')
    .replace(/\b[A-Z][A-Z0-9_]{2,}\b/g, '配置项');
}

function impactChangeDisplayName(
  change: CustomerPriceBookDraftImpactChangeDto,
): string {
  return change.productName
    ? externalPriceBusinessText(change.productName)
    : externalPriceRuleDisplayName(change.name);
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
                    {externalPriceBusinessText(version.name)} · 第{' '}
                    {version.version} 版
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
                <PriceBookVersionStatusBadge status={version.status} />
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
                {version.publishNote ? (
                  <div className="min-w-0 sm:col-span-2">
                    <dt className="text-xs text-muted-foreground">发布说明</dt>
                    <dd className="admin-wrap-anywhere mt-1">
                      {version.publishNote}
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

const CALCULATION_LABELS: Record<CustomerPriceCalculationType, string> = {
  [CustomerPriceCalculationType.PER_PIECE]: '个',
  [CustomerPriceCalculationType.FIXED_AMOUNT]: '批',
  [CustomerPriceCalculationType.PER_SHEET]: '张',
  [CustomerPriceCalculationType.PER_10K]: '万个',
  [CustomerPriceCalculationType.PER_ITEM]: '款',
  [CustomerPriceCalculationType.PER_BAG]: '袋',
};

function signed(value: string, suffix = ''): string {
  return `${value.startsWith('-') || value === '0' ? '' : '+'}${value}${suffix}`;
}

function priceSummary(
  price: CustomerPriceBookDraftImpactChangeDto['current'],
  calculationType: CustomerPriceCalculationType | null,
): string {
  if (!price) return '—';
  const status = price.isActive ? '' : ' · 已停用';
  if (
    price.includedUnits &&
    price.incrementUnits &&
    price.incrementAmount &&
    price.amount
  ) {
    return `首重 ¥${price.amount} / ${price.includedUnits}kg · 续重 ¥${price.incrementAmount} / ${price.incrementUnits}kg${status}`;
  }
  if (!price.amount) return `人工确认${status}`;
  const unit = calculationType ? CALCULATION_LABELS[calculationType] : '项';
  return `¥${price.amount} / ${unit}${status}`;
}

function deltaLabel(change: CustomerPriceBookDraftImpactChangeDto): string {
  if (change.direction === 'ADDED') return '新增';
  if (change.direction === 'REMOVED') return '移除';
  if (change.direction === 'MIXED') return '多个金额涨跌不同';
  if (change.deltaPercent !== null) {
    const amount = change.deltaAmount ? ` · ${signed(change.deltaAmount, ' 元')}` : '';
    return `${signed(change.deltaPercent, '%')}${amount}`;
  }
  return change.changedFields.join('、');
}

function deltaTone(change: CustomerPriceBookDraftImpactChangeDto): string {
  if (change.direction === 'UP' || change.direction === 'MIXED') {
    return 'text-warning-foreground';
  }
  if (change.direction === 'DOWN') return 'text-info-foreground';
  return 'text-muted-foreground';
}

function DraftChanges({
  preview,
  purpose,
}: {
  preview: CustomerPriceBookDraftPublishPreviewDto;
  purpose: CustomerPriceBookPurpose;
}) {
  return (
    <section
      aria-labelledby="draft-change-list-heading"
      className="min-w-0 overflow-hidden rounded-xl border bg-card shadow-sm"
    >
      <header className="flex min-w-0 flex-wrap items-center gap-2 border-b bg-muted/30 px-4 py-3">
        <h3 id="draft-change-list-heading" className="font-semibold">
          第 {preview.version} 版草稿 · 本次修改
        </h3>
        <Badge variant="secondary">
          {preview.changedItemCount} 项 · {preview.changedRuleCount} 档
        </Badge>
        <span className="ml-auto text-xs text-muted-foreground">
          按涨幅从大到小
        </span>
      </header>

      {preview.changes.length === 0 ? (
        <div className="p-6 text-sm text-muted-foreground">
          草稿和当前生效版没有可发布的差异。请先返回收费项目工作台调整。
        </div>
      ) : (
        <>
          <ul className="divide-y md:hidden">
            {preview.changes.map((change, index) => (
              <li key={`${change.draftRuleId ?? change.name}-${index}`} className="space-y-2 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    {change.draftRuleId ? (
                      <Link
                        href={`${itemsHref(purpose)}&item=${encodeURIComponent(change.draftRuleId)}#selected-charge-detail`}
                        prefetch={false}
                        className="admin-wrap-anywhere font-medium underline-offset-4 hover:underline"
                      >
                        {impactChangeDisplayName(change)}
                      </Link>
                    ) : (
                      <p className="admin-wrap-anywhere font-medium">
                        {impactChangeDisplayName(change)}
                      </p>
                    )}
                    <p className="mt-1 text-xs text-muted-foreground">
                      {change.quantityLabel}
                    </p>
                  </div>
                  <span className={cn('shrink-0 font-sans text-sm font-medium tabular-nums', deltaTone(change))}>
                    {deltaLabel(change)}
                  </span>
                </div>
                <dl className="grid grid-cols-2 gap-2 text-xs">
                  <div><dt className="text-muted-foreground">当前价</dt><dd className="mt-1 font-sans tabular-nums">{priceSummary(change.current, change.calculationType)}</dd></div>
                  <div><dt className="text-muted-foreground">新价</dt><dd className="mt-1 font-sans font-medium tabular-nums">{priceSummary(change.draft, change.calculationType)}</dd></div>
                </dl>
                <p className="text-xs text-muted-foreground">变更：{change.changedFields.join('、')}</p>
              </li>
            ))}
          </ul>

          <div
            role="region"
            aria-label="草稿价格变更明细，可横向滚动"
            tabIndex={0}
            className="hidden overflow-x-auto focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/50 md:block"
          >
            <table className="w-full min-w-[52rem] text-sm" aria-label="草稿价格变更明细">
              <thead className="border-b bg-muted/20 text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">收费项目 / 数量档</th>
                  <th className="px-4 py-2 text-right font-medium">当前价</th>
                  <th className="px-4 py-2 text-right font-medium">新价</th>
                  <th className="px-4 py-2 text-right font-medium">变化</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {preview.changes.map((change, index) => (
                  <tr key={`${change.draftRuleId ?? change.name}-${index}`}>
                    <td className="min-w-0 px-4 py-3">
                      {change.draftRuleId ? (
                        <Link
                          href={`${itemsHref(purpose)}&item=${encodeURIComponent(change.draftRuleId)}#selected-charge-detail`}
                          prefetch={false}
                          className="admin-wrap-anywhere font-medium underline-offset-4 hover:underline"
                        >
                          {impactChangeDisplayName(change)}
                        </Link>
                      ) : (
                        <p className="admin-wrap-anywhere font-medium">{impactChangeDisplayName(change)}</p>
                      )}
                      <p className="mt-1 text-xs text-muted-foreground">
                        {change.quantityLabel} · {change.changedFields.join('、')}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-right font-sans text-xs tabular-nums text-muted-foreground">
                      {priceSummary(change.current, change.calculationType)}
                    </td>
                    <td className="px-4 py-3 text-right font-sans text-xs font-medium tabular-nums">
                      {priceSummary(change.draft, change.calculationType)}
                    </td>
                    <td className={cn('px-4 py-3 text-right font-sans text-xs font-medium tabular-nums', deltaTone(change))}>
                      {deltaLabel(change)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

function ImpactSummary({ preview }: { preview: CustomerPriceBookDraftPublishPreviewDto }) {
  const range =
    preview.deltaPercentMin !== null && preview.deltaPercentMax !== null
      ? preview.deltaPercentMin === preview.deltaPercentMax
        ? signed(preview.deltaPercentMin, '%')
        : `${signed(preview.deltaPercentMin, '%')} 〜 ${signed(preview.deltaPercentMax, '%')}`
      : '含启停或非金额修改';
  return (
    <section aria-labelledby="publish-impact-heading" className="rounded-xl border border-destructive/30 bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="destructive">发布前请确认</Badge>
        <h3 id="publish-impact-heading" className="font-semibold">发布影响</h3>
      </div>
      <dl className="mt-3 grid gap-2 text-sm">
        <div className="flex justify-between gap-3"><dt className="text-muted-foreground">受影响收费项目</dt><dd className="font-sans tabular-nums">{preview.changedItemCount} / {preview.totalRuleCount}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-muted-foreground">受影响数量档/规则</dt><dd className="font-sans tabular-nums">{preview.changedRuleCount}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-muted-foreground">涨跌区间</dt><dd className="font-sans tabular-nums text-warning-foreground">{range}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-muted-foreground">涨价 / 下调</dt><dd className="font-sans tabular-nums">{preview.increasedRuleCount} / {preview.decreasedRuleCount} 档</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-muted-foreground">生效时间</dt><dd className="text-destructive">需选择</dd></div>
      </dl>
      <p className="mt-3 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm leading-6 text-warning-foreground">
        已开工单价格不变；新价格仅用于生效后的新建或重新报价工单。
      </p>
    </section>
  );
}

function ValidationSummary({
  preview,
  purpose,
}: {
  preview: CustomerPriceBookDraftPublishPreviewDto;
  purpose: CustomerPriceBookPurpose;
}) {
  return (
    <section aria-labelledby="publish-validation-heading" className="rounded-xl border bg-card p-4 shadow-sm">
      <h3 id="publish-validation-heading" className="font-semibold">发布检查</h3>
      {preview.validation.status === 'PASS' ? (
        <div className="mt-3 flex items-start gap-2 text-sm">
          <Badge variant="outline" className="border-success/40 bg-success/10 text-success-foreground">通过</Badge>
          <p className="leading-6">
            全部 {preview.totalRuleCount} 项检查通过。
          </p>
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          <div className="flex items-start gap-2 text-sm">
            <Badge variant="destructive">待修正</Badge>
            <p>{preview.validation.issues.length} 个问题待修正，当前不能发布。</p>
          </div>
          <ul className="space-y-2 text-sm">
            {preview.validation.issues.map((issue, index) => (
              <li
                key={`${issue.ruleId ?? 'price-book'}-${index}`}
                className="rounded-lg border border-destructive/30 bg-destructive/5 p-2"
              >
                <p className="admin-wrap-anywhere">
                  {externalPriceBookValidationMessage(issue.message)}
                </p>
                {issue.ruleId ? (
                  <Link
                    href={`${itemsHref(purpose)}&item=${encodeURIComponent(issue.ruleId)}#selected-charge-detail`}
                    prefetch={false}
                    className="mt-1 inline-flex text-xs font-medium text-destructive underline-offset-4 hover:underline"
                  >
                    打开问题收费项
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="mt-3 flex items-start gap-2 text-sm">
        <Badge variant="outline" className="border-warning/40 bg-warning/10 text-warning-foreground">待办</Badge>
        <p>发布前还需选择生效时间、填写发布说明并确认影响范围。</p>
      </div>
    </section>
  );
}

function DraftPublishPanel({
  draft,
  preview,
  defaultPublishAt,
}: {
  draft: CustomerPriceBookDraftAdminDto;
  preview: CustomerPriceBookDraftPublishPreviewDto;
  defaultPublishAt: string;
}) {
  return (
    <section
      aria-labelledby="selected-price-book-draft-heading"
      className="min-w-0 space-y-4"
    >
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3 rounded-xl border bg-muted/20 p-4">
        <div className="min-w-0">
          <h2 id="selected-price-book-draft-heading" className="font-semibold">
            发布{PURPOSE_LABELS[draft.purpose]}草稿 · 第 {draft.version} 版
          </h2>
          <p className="admin-wrap-anywhere mt-1 text-sm text-muted-foreground">
            调价原因：{draft.changeReason}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            基于第 {preview.basedOnVersion} 版 · 共 {preview.totalRuleCount} 项
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

      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_26rem] xl:items-start">
        <DraftChanges preview={preview} purpose={draft.purpose} />
        <aside className="min-w-0 space-y-4 xl:sticky xl:top-[4.75rem]">
          <ImpactSummary preview={preview} />
          <ValidationSummary preview={preview} purpose={draft.purpose} />
          <PublishCustomerPriceBookDraftForm
            priceBookId={draft.id}
            expectedDraftUpdatedAt={draft.updatedAt}
            defaultEffectiveFrom={defaultPublishAt}
            ruleCount={draft.rules.length}
            impact={{
              totalRuleCount: preview.totalRuleCount,
              changedItemCount: preview.changedItemCount,
              changedRuleCount: preview.changedRuleCount,
              increasedRuleCount: preview.increasedRuleCount,
              decreasedRuleCount: preview.decreasedRuleCount,
              deltaPercentMin: preview.deltaPercentMin,
              deltaPercentMax: preview.deltaPercentMax,
              validationStatus: preview.validation.status,
            }}
          />
        </aside>
      </div>

      <Disclosure className="min-w-0 rounded-lg border bg-card p-3">
        <DisclosureSummary className="justify-between gap-3">
          <span>更多草稿操作</span>
          <ChevronDown
            aria-hidden="true"
            className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
          />
        </DisclosureSummary>
        <div className="border-t pt-3">
          <DiscardCustomerPriceBookDraftForm
            priceBookId={draft.id}
            expectedDraftUpdatedAt={draft.updatedAt}
          />
        </div>
      </Disclosure>
    </section>
  );
}

export function ExternalSalesPriceBookVersionPanel({
  versions,
  draft,
  preview,
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
          草稿不存在或不可编辑。
        </div>
      ) : null}

      {draft && preview ? (
        <DraftPublishPanel
          draft={draft}
          preview={preview}
          defaultPublishAt={defaultPublishAt}
        />
      ) : draft ? (
        <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm">
          发布数据读取失败，当前不能发布。
        </div>
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

    </div>
  );
}
