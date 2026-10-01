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
import { StatusBadge, TableScrollArea, LinkPendingHint } from '@/components/ui-business';
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
import {
  formatDateTimeLocalShanghai,
  formatDateTimeShanghai,
} from '@/lib/format/dates';
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
import { formatRate } from '@/lib/format/unit-price';

type ExternalSalesPriceBookVersionPanelProps = {
  versions: CustomerPriceBookVersionAdminDto[];
  draft: CustomerPriceBookDraftAdminDto | null;
  preview: CustomerPriceBookDraftPublishPreviewDto | null;
  invalidDraftSelection: boolean;
  defaultPublishAt: string;
  selectedPurpose?: CustomerPriceBookPurpose;
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

function formatShanghaiDateTimeLocalInput(value: string): string {
  return formatDateTimeLocalShanghai(new Date(value));
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
    <span className="admin-wrap-anywhere font-medium">
      {impactChangeDisplayName(change)}
    </span>
  );
}

function DraftChangeQuantity({ change, draft }: {
  change: CustomerPriceBookDraftImpactChangeDto;
  draft: CustomerPriceBookDraftAdminDto;
}) {
  const href = change.draftRuleId ? ruleEditHref(draft, change.draftRuleId) : null;
  return href ? (
    <Link href={href} prefetch={false} className="underline-offset-4 hover:underline">
      {change.quantityLabel}
    </Link>
  ) : <span>{change.quantityLabel}</span>;
}

function VersionHistoryEntry({
  version,
}: {
  version: CustomerPriceBookVersionAdminDto;
}) {
  return (
    <li className="min-w-0 border-b py-4 last:border-b-0">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">{version.status === 'CURRENT' ? '默认价格' : version.status === 'DRAFT' ? '调价草稿' : '待生效价格'}</p>
          <p className="mt-1 font-sans text-sm tabular-nums text-muted-foreground">
            {version.status === 'DRAFT'
              ? `最后更新 ${formatShanghaiDateTime(
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
  const visibleVersions = versions.filter((version) =>
    version.status === 'CURRENT' || version.status === 'DRAFT' || version.status === 'SCHEDULED',
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
      </div>
      {visibleVersions.length > 0 ? (
        <ol className="mt-4 divide-y">
          {visibleVersions.map((version) => (
            <VersionHistoryEntry key={version.id} version={version} />
          ))}
        </ol>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">尚无可用价格。</p>
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
  [CustomerPriceCalculationType.PER_BOX]: '按盒计价',
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
  if (price.blankSalesEnabled === false) return '未启用';
  const status = price.isActive ? '' : ' · 已停用';
  if (
    price.includedUnits &&
    price.incrementUnits &&
    price.incrementAmount &&
    price.amount
  ) {
    return `首重 ${formatRate(price.amount)} / ${price.includedUnits}kg · 续重 ${formatRate(price.incrementAmount)} / ${price.incrementUnits}kg${status}`;
  }
  if (!price.amount) return `人工确认${status}`;
  const unit = calculationType ? CALCULATION_LABELS[calculationType] : '项';
  return `${formatRate(price.amount)} / ${unit}${status}`;
}

function deltaLabel(change: CustomerPriceBookDraftImpactChangeDto): string {
  if (change.draft?.blankSalesEnabled === false) return '发布后停止用于新单';
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

function DraftChanges({ preview, draft }: {
  preview: CustomerPriceBookDraftPublishPreviewDto;
  draft: CustomerPriceBookDraftAdminDto;
}) {
  const grouped = new Map<string, CustomerPriceBookDraftImpactChangeDto[]>();
  for (const change of preview.changes) {
    const key = impactChangeDisplayName(change);
    const group = grouped.get(key) ?? [];
    group.push(change);
    grouped.set(key, group);
  }
  return (
    <section aria-labelledby="draft-change-list-heading" className="min-w-0 overflow-hidden rounded-xl border bg-card">
      <header className="flex min-w-0 flex-wrap items-center gap-2 border-b px-4 py-3">
        <h3 id="draft-change-list-heading" className="font-semibold">本次修改</h3>
        <Badge variant="secondary">{preview.changedItemCount} 项 · {preview.changedRuleCount} 档</Badge>
      </header>
      <div className="divide-y md:hidden">
        {[...grouped].map(([name, changes]) => (
          <section key={name} className="p-4">
            <h4><DraftChangeName change={changes[0]!} draft={draft} /></h4>
            <ul className="divide-y">
              {changes.map((change, index) => (
                <li key={change.draftRuleId ?? index} className="space-y-2 py-3">
                  <p className="text-sm"><DraftChangeQuantity change={change} draft={draft} /></p>
                  <dl className="grid grid-cols-2 gap-3 text-sm">
                    <div><dt className="text-xs text-muted-foreground">当前价</dt><dd className="mt-1 tabular-nums">{priceSummary(change.current, change.calculationType)}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">新价</dt><dd className="mt-1 font-medium tabular-nums">{priceSummary(change.draft, change.calculationType)}</dd></div>
                  </dl>
                  <p className={cn('text-sm tabular-nums', deltaTone(change))}>{deltaLabel(change)}</p>
                  <p className="text-xs text-muted-foreground">变更：{change.changedFields.join('、')}</p>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <TableScrollArea label="草稿价格变更明细，可横向滚动" className="hidden md:block">
        <table className="w-full min-w-[36rem] text-sm" aria-label="草稿价格变更明细">
          <thead className="border-b text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-3 text-left font-medium">收费项目 / 数量档</th>
              <th className="px-4 py-3 text-right font-medium">当前价</th>
              <th className="px-4 py-3 text-right font-medium">新价</th>
              <th className="px-4 py-3 text-right font-medium">变化</th>
            </tr>
          </thead>
          {[...grouped].map(([name, changes]) => (
            <tbody key={name} className="divide-y border-b last:border-b-0">
              <tr><th colSpan={4} scope="rowgroup" className="bg-muted/30 px-4 py-2 text-left"><DraftChangeName change={changes[0]!} draft={draft} /></th></tr>
              {changes.map((change, index) => (
                <tr key={change.draftRuleId ?? index}>
                  <td className="px-4 py-3">
                    <p><DraftChangeQuantity change={change} draft={draft} /></p>
                    <p className="mt-1 text-xs text-muted-foreground">{change.changedFields.join('、')}</p>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{priceSummary(change.current, change.calculationType)}</td>
                  <td className="px-4 py-3 text-right font-medium tabular-nums">{priceSummary(change.draft, change.calculationType)}</td>
                  <td className={cn('px-4 py-3 text-right tabular-nums', deltaTone(change))}>{deltaLabel(change)}</td>
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </TableScrollArea>
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
            {PURPOSE_LABELS[draft.purpose]}调价草稿
          </h2>
          <p className="admin-wrap-anywhere mt-1 text-sm text-muted-foreground">
            调价原因：{draft.changeReason}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            更新于 {formatShanghaiDateTime(draft.updatedAt)}
          </p>
        </div>
        <Link
          href={returnToEditHref}
          prefetch={false}
          className={cn(buttonVariants({ variant: 'outline' }), 'min-h-11')}
        >
          返回编辑
        </Link>
      </div>

      <div className={cn('grid min-w-0 gap-5', preview.changes.length > 0 && 'min-[1440px]:grid-cols-[minmax(0,1fr)_360px] min-[1440px]:items-start')}>
        {preview.changes.length > 0 ? <DraftChanges preview={preview} draft={draft} /> : null}
        <aside className="min-w-0">
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
  selectedPurpose,
}: ExternalSalesPriceBookVersionPanelProps) {
  const activePurpose = draft?.purpose ?? selectedPurpose;
  const purposes = activePurpose ? [activePurpose] : Object.values(CustomerPriceBookPurpose);
  const history = (
    <div className={cn('grid min-w-0 gap-4', !activePurpose && 'lg:grid-cols-2')}>
      {purposes.map((purpose) => (
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
      {activePurpose ? (
        <nav aria-label="价格用途" className="flex flex-wrap gap-2 border-b pb-3">
          {Object.values(CustomerPriceBookPurpose).map(purpose => {
            const current = versions.find(version => version.purpose === purpose && version.status === 'CURRENT');
            const pendingDraft = versions.find(version => version.purpose === purpose && version.status === 'DRAFT');
            const href = pendingDraft ? versionsHref(pendingDraft.id) : `${priceVersionsHref()}?purpose=${purpose.toLowerCase()}`;
            return (
              <Link key={purpose} href={href} prefetch={false} scroll={false} aria-current={activePurpose === purpose ? 'page' : undefined}
                className={cn(buttonVariants({ variant: activePurpose === purpose ? 'selected' : 'ghost' }), 'relative min-h-11 h-auto flex-wrap gap-2')}>
                <span className="font-semibold">{PURPOSE_LABELS[purpose]}</span>
                <span className="text-xs text-muted-foreground group-aria-[current=page]/button:text-primary">{current ? '默认价格' : '无生效版本'}</span>
                {pendingDraft ? <span className="text-xs text-warning-foreground">待发布</span> : null}
                <LinkPendingHint />
              </Link>
            );
          })}
        </nav>
      ) : null}

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
            <span>当前价格</span>
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
