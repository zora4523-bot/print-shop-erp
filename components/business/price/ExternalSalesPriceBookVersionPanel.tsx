import Link from 'next/link';
import { ChevronDown } from 'lucide-react';
import {
  CancelScheduledCustomerPriceBookForm,
  CreateCustomerPriceBookDraftForm,
  DiscardCustomerPriceBookDraftForm,
  PublishCustomerPriceBookDraftForm,
  RescheduleCustomerPriceBookForm,
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
  CustomerPriceRuleDraftAdminDto,
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
  customerPricingRuleHref,
  priceVersionsHref,
  type CustomerPricingPurpose,
} from '@/lib/navigation/rule-center';
import {
  customerPriceSectionForRule,
  type CustomerPriceSection,
} from '@/lib/price/customer-price-section-membership';

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

const SHANGHAI_LOCAL_INPUT_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function formatShanghaiDateTimeLocalInput(value: string): string {
  const parts = Object.fromEntries(
    SHANGHAI_LOCAL_INPUT_FORMATTER.formatToParts(new Date(value)).map((part) => [
      part.type,
      part.value,
    ]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
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

function owningSection(
  purpose: CustomerPriceBookPurpose,
  rule: CustomerPriceRuleDraftAdminDto,
): CustomerPriceSection | null {
  return customerPriceSectionForRule(purpose, rule);
}

function ruleEditHref(
  draft: CustomerPriceBookDraftAdminDto,
  ruleId: string,
): string | null {
  const rule = draft.rules.find((candidate) => candidate.id === ruleId);
  if (!rule) return null;
  const section = owningSection(draft.purpose, rule);
  return section ? customerPricingRuleHref(section, ruleId) : null;
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

function DraftChangeName({
  change,
  draft,
}: {
  change: CustomerPriceBookDraftImpactChangeDto;
  draft: CustomerPriceBookDraftAdminDto;
}) {
  const href = change.draftRuleId
    ? ruleEditHref(draft, change.draftRuleId)
    : null;
  return href ? (
    <Link
      href={href}
      prefetch={false}
      className="admin-wrap-anywhere font-medium underline-offset-4 hover:underline"
    >
      {impactChangeDisplayName(change)}
    </Link>
  ) : (
    <p className="admin-wrap-anywhere font-medium">
      {impactChangeDisplayName(change)}
    </p>
  );
}

function historyTimestamp(version: CustomerPriceBookVersionAdminDto): number {
  const value =
    version.status === 'DRAFT' ? version.updatedAt : version.effectiveFrom;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function VersionHistoryEntry({
  version,
}: {
  version: CustomerPriceBookVersionAdminDto;
}) {
  return (
    <li className="min-w-0 rounded-lg border bg-background p-3">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">第 {version.version} 版</p>
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
          <dt className="text-xs text-muted-foreground">规则数</dt>
          <dd className="mt-1 font-sans tabular-nums">{version.ruleCount} 条</dd>
        </div>
        {version.changeReason ? (
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">调价原因</dt>
            <dd className="admin-wrap-anywhere mt-1">{version.changeReason}</dd>
          </div>
        ) : null}
        {version.publishNote && version.publishNote !== version.changeReason ? (
          <div className="min-w-0 sm:col-span-2">
            <dt className="text-xs text-muted-foreground">补充发布说明</dt>
            <dd className="admin-wrap-anywhere mt-1">{version.publishNote}</dd>
          </div>
        ) : null}
        {version.scheduleChangeReason ? (
          <div className="min-w-0 sm:col-span-2">
            <dt className="text-xs text-muted-foreground">
              {version.status === 'CANCELLED' ? '取消原因' : '最近改期原因'}
            </dt>
            <dd className="admin-wrap-anywhere mt-1">
              {version.scheduleChangeReason}
              {version.scheduleChangedAt
                ? ` · ${formatShanghaiDateTime(version.scheduleChangedAt)}`
                : ''}
            </dd>
          </div>
        ) : null}
      </dl>

      {version.status === 'DRAFT' ? (
        <div className="mt-3 flex min-w-0 flex-wrap gap-2">
          <Link
            href={itemsHref(version.purpose)}
            prefetch={false}
            className={cn(buttonVariants({ variant: 'outline' }), 'min-h-11')}
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
      {version.status === 'SCHEDULED' ? (
        <div className="mt-3 space-y-3 rounded-lg border border-info/30 bg-info/5 p-3">
          <RescheduleCustomerPriceBookForm
            priceBookId={version.id}
            expectedUpdatedAt={version.updatedAt}
            version={version.version}
            defaultEffectiveFrom={formatShanghaiDateTimeLocalInput(
              version.effectiveFrom,
            )}
          />
          <CancelScheduledCustomerPriceBookForm
            priceBookId={version.id}
            expectedUpdatedAt={version.updatedAt}
            version={version.version}
          />
        </div>
      ) : null}
    </li>
  );
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
  const lineageMap = new Map<string, CustomerPriceBookVersionAdminDto[]>();
  for (const version of versions) {
    const lineage = lineageMap.get(version.code) ?? [];
    lineage.push(version);
    lineageMap.set(version.code, lineage);
  }
  const lineages = [...lineageMap.entries()]
    .map(([code, lineageVersions]) => ({
      code,
      name: externalPriceBusinessText(lineageVersions[0]?.name ?? code),
      versions: [...lineageVersions].sort(
        (left, right) =>
          historyTimestamp(right) - historyTimestamp(left) ||
          right.version - left.version,
      ),
    }))
    .sort(
      (left, right) =>
        historyTimestamp(right.versions[0]!) -
          historyTimestamp(left.versions[0]!) ||
        left.code.localeCompare(right.code),
    );

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
          {lineages.length} 个价目序列 · {versions.length} 个版本
        </span>
      </div>

      {lineages.length > 0 ? (
        <div className="mt-4 space-y-4">
          {lineages.map((lineage) => (
            <section key={lineage.code} className="min-w-0">
              <div className="mb-2 min-w-0 border-l-2 border-foreground/25 pl-2">
                <h3 className="admin-wrap-anywhere text-sm font-semibold">
                  {lineage.name}
                </h3>
                <p className="admin-wrap-anywhere mt-0.5 text-[10px] text-muted-foreground">
                  最近变更：
                  {formatShanghaiDateTime(
                    lineage.versions[0]?.status === 'DRAFT'
                      ? lineage.versions[0].updatedAt
                      : lineage.versions[0]?.effectiveFrom ?? null,
                  )}
                </p>
              </div>
              <ol className="space-y-3">
                {lineage.versions.map((version) => (
                  <VersionHistoryEntry key={version.id} version={version} />
                ))}
              </ol>
            </section>
          ))}
        </div>
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
  draft,
}: {
  preview: CustomerPriceBookDraftPublishPreviewDto;
  draft: CustomerPriceBookDraftAdminDto;
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
                    <DraftChangeName change={change} draft={draft} />
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
                      <DraftChangeName change={change} draft={draft} />
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

function DraftPublishPanel({
  draft,
  preview,
  defaultPublishAt,
}: {
  draft: CustomerPriceBookDraftAdminDto;
  preview: CustomerPriceBookDraftPublishPreviewDto;
  defaultPublishAt: string;
}) {
  const returnToEditHref =
    preview.changes
      .map((change) =>
        change.draftRuleId ? ruleEditHref(draft, change.draftRuleId) : null,
      )
      .find((href): href is string => href !== null) ?? itemsHref(draft.purpose);

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
            基于第 {preview.basedOnVersion} 版 · 全表 {preview.totalRuleCount} 条规则
          </p>
        </div>
        <Link
          href={returnToEditHref}
          prefetch={false}
          className={cn(buttonVariants({ variant: 'outline' }), 'min-h-11')}
        >
          返回编辑收费项目
        </Link>
      </div>

      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_26rem] xl:items-start">
        <DraftChanges preview={preview} draft={draft} />
        <aside className="min-w-0 space-y-4 xl:sticky xl:top-[4.75rem]">
          <PublishCustomerPriceBookDraftForm
            priceBookId={draft.id}
            expectedDraftUpdatedAt={draft.updatedAt}
            defaultEffectiveFrom={defaultPublishAt}
            changeReason={draft.changeReason}
            impact={{
              totalRuleCount: preview.totalRuleCount,
              changedItemCount: preview.changedItemCount,
              changedRuleCount: preview.changedRuleCount,
              increasedRuleCount: preview.increasedRuleCount,
              decreasedRuleCount: preview.decreasedRuleCount,
              highRiskRuleCount: preview.highRiskRuleCount,
              highRiskDeltaPercentThreshold:
                preview.highRiskDeltaPercentThreshold,
              deltaPercentMin: preview.deltaPercentMin,
              deltaPercentMax: preview.deltaPercentMax,
              validationStatus: preview.validation.status,
              validationIssues: preview.validation.issues.map((issue) => {
                const href = issue.ruleId
                  ? ruleEditHref(draft, issue.ruleId)
                  : null;
                return {
                  message: externalPriceBookValidationMessage(issue.message),
                  ...(href ? { href } : {}),
                };
              }),
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
  const history = (
    <div className="grid min-w-0 gap-4 lg:grid-cols-2">
      {Object.values(CustomerPriceBookPurpose).map((purpose) => (
        <VersionHistory
          key={purpose}
          purpose={purpose}
          versions={versions.filter((version) => version.purpose === purpose)}
        />
      ))}
    </div>
  );

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

      {draft && preview ? (
        <Disclosure className="min-w-0 rounded-lg border bg-card p-3">
          <DisclosureSummary className="justify-between gap-3">
            <span>查看完整版本历史（{versions.length} 个版本）</span>
            <ChevronDown
              aria-hidden="true"
              className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
            />
          </DisclosureSummary>
          <div className="mt-3 border-t pt-3">{history}</div>
        </Disclosure>
      ) : (
        history
      )}

    </div>
  );
}
