import type { ReactNode } from 'react';
import Link from 'next/link';
import {
  ChevronLeft,
  ChevronRight,
  Filter,
  GitCompareArrows,
  Search,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export type ExternalSalesChargePurpose = 'processing' | 'logistics';

export type ExternalSalesChargeWorkspaceStatus =
  | 'CURRENT'
  | 'SCHEDULED'
  | 'UNAVAILABLE';

export type ExternalSalesChargeWorkspaceItem = {
  id: string;
  name: string;
  categoryLabel: string;
  subjectLabel: string;
  quantityLabel: string;
  calculationLabel: string;
  currentAmountLabel: string;
  draftAmountLabel?: string | null;
  priceChangeLabel?: string | null;
  changeSummaryLabels?: string[];
  automation: 'AUTO' | 'MANUAL';
  status: 'ACTIVE' | 'INACTIVE';
  statusLabel?: string;
  changed: boolean;
  detailHref: string;
  /** Compact business projection for one product's exact quantity anchors. */
  priceTiers?: Array<{
    quantityLabel: string;
    currentAmountLabel: string;
    draftAmountLabel?: string | null;
    changed: boolean;
  }>;
};

export type ExternalSalesChargeFilterOption = {
  value: string;
  label: string;
  count?: number;
};

export type ExternalSalesChargeWorkspaceFilters = {
  query: string;
  category: string;
  subject: string;
  kind: '' | 'BASE' | 'ADD_ON' | 'REFERENCE';
  calculation: string;
  quantity: string;
  automation: '' | 'AUTO' | 'MANUAL';
  status: '' | 'ACTIVE' | 'INACTIVE';
  changedOnly: boolean;
};

export type ExternalSalesChargeDraftSummary = {
  version: number;
  changeReason: string;
  changedCount: number;
  lastSavedLabel: string;
  compareHref: string;
  publishHref: string;
};

export type ExternalSalesChargeWorkspaceProps = {
  purpose: ExternalSalesChargePurpose;
  workspaceStatus?: ExternalSalesChargeWorkspaceStatus;
  purposeHrefs: Record<ExternalSalesChargePurpose, string>;
  searchAction: string;
  hiddenSearchFields?: Record<string, string>;
  filters: ExternalSalesChargeWorkspaceFilters;
  filterOptions: {
    categories: ExternalSalesChargeFilterOption[];
    subjects: ExternalSalesChargeFilterOption[];
    calculations: ExternalSalesChargeFilterOption[];
  };
  clearFiltersHref: string;
  items: ExternalSalesChargeWorkspaceItem[];
  selectedItem?: ExternalSalesChargeWorkspaceItem;
  selectedItemId?: string;
  selectedEditor?: ReactNode;
  draft?: ExternalSalesChargeDraftSummary | null;
  createDraftHref?: string;
  createDraftEditor?: ReactNode;
  createDraftOpen?: boolean;
  createDraftBlockedReason?: string | null;
  changedFilterAvailable?: boolean;
  pagination: {
    page: number;
    pageCount: number;
    total: number;
    previousHref?: string | null;
    nextHref?: string | null;
  };
};

const PURPOSE_LABELS: Record<ExternalSalesChargePurpose, string> = {
  processing: '加工费',
  logistics: '快递与打包耗材',
};

const selectClass =
  'min-h-11 w-full min-w-0 rounded-lg border border-input bg-background px-2.5 py-1 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm';

function optionLabel(option: ExternalSalesChargeFilterOption): string {
  return option.count === undefined
    ? option.label
    : `${option.label}（${option.count}）`;
}

function activeAdvancedFilterCount(
  filters: ExternalSalesChargeWorkspaceFilters,
): number {
  return [
    filters.category,
    filters.subject,
    filters.kind,
    filters.calculation,
    filters.quantity,
    filters.automation,
    filters.status,
    filters.changedOnly,
  ].filter(Boolean).length;
}

type ExternalSalesChargeWorkspaceGroup = {
  key: string;
  subjectLabel: string;
  categoryLabel: string;
  items: ExternalSalesChargeWorkspaceItem[];
};

function groupWorkspaceItems(
  items: ExternalSalesChargeWorkspaceItem[],
): ExternalSalesChargeWorkspaceGroup[] {
  const groups = new Map<string, ExternalSalesChargeWorkspaceGroup>();

  for (const item of items) {
    const key = JSON.stringify([item.subjectLabel, item.categoryLabel]);
    const existing = groups.get(key);

    if (existing) {
      existing.items.push(item);
      continue;
    }

    groups.set(key, {
      key,
      subjectLabel: item.subjectLabel,
      categoryLabel: item.categoryLabel,
      items: [item],
    });
  }

  return [...groups.values()];
}

function priceChangeLabel(
  item: ExternalSalesChargeWorkspaceItem,
  hasDraft: boolean,
): string {
  if (!hasDraft) return '—';
  if (!item.changed) return '无变更';
  return item.priceChangeLabel ?? '已调整';
}

function DraftStatusBar({
  draft,
  workspaceStatus,
  createDraftHref,
  createDraftEditor,
  createDraftOpen,
  createDraftBlockedReason,
}: {
  draft?: ExternalSalesChargeDraftSummary | null;
  workspaceStatus: ExternalSalesChargeWorkspaceStatus;
  createDraftHref?: string;
  createDraftEditor?: ReactNode;
  createDraftOpen?: boolean;
  createDraftBlockedReason?: string | null;
}) {
  if (!draft) {
    const statusCopy = {
      CURRENT: {
        badge: '当前生效',
        title: '当前价格正在用于工单计价',
        description:
          '如需调整，请先发起调价；发布前不会影响正在使用的价格。',
      },
      SCHEDULED: {
        badge: '等待生效',
        title: '已有一轮价格等待生效',
        description: '计划版本生效前不能继续发起调价。',
      },
      UNAVAILABLE: {
        badge: '暂无生效价',
        title: '当前没有可用的收费价格',
        description: '请前往发布中心检查价目版本。',
      },
    }[workspaceStatus];

    return (
      <section
        aria-label="价格状态"
        className="min-w-0 rounded-xl border bg-card p-4 shadow-sm"
      >
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{statusCopy.badge}</Badge>
              <p className="font-medium">{statusCopy.title}</p>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {createDraftBlockedReason ?? statusCopy.description}
            </p>
          </div>
          {createDraftEditor ? null : createDraftHref ? (
            <Link
              href={createDraftHref}
              prefetch={false}
              className={cn(
                buttonVariants({ variant: 'outline' }),
                'min-h-11 shrink-0',
              )}
            >
              发起调价
            </Link>
          ) : null}
        </div>
        {createDraftEditor ? (
          <details
            id="start-price-adjustment"
            className="group mt-3 min-w-0 rounded-lg border bg-muted/20 p-3"
            open={createDraftOpen || undefined}
          >
            <summary
              className={cn(
                buttonVariants({ variant: 'outline' }),
                'min-h-11 cursor-pointer list-none [&::-webkit-details-marker]:hidden',
              )}
            >
              发起调价
            </summary>
            <div className="min-w-0 border-t pt-3">{createDraftEditor}</div>
          </details>
        ) : null}
      </section>
    );
  }

  return (
    <section
      aria-label="调价草稿状态"
      className="min-w-0 rounded-xl border border-warning/40 bg-warning/10 p-4"
    >
      <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Badge variant="secondary">调价草稿</Badge>
            <p className="font-sans text-sm font-medium tabular-nums">
              本轮调价 · 第 {draft.version} 版
            </p>
            <p className="font-sans text-sm tabular-nums text-warning-foreground">
              {draft.changedCount} 项已修改
            </p>
          </div>
          <p className="admin-wrap-anywhere mt-2 text-sm">
            调价原因：{draft.changeReason}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            最近保存：{draft.lastSavedLabel}。发布前不会影响当前工单计价。
          </p>
        </div>
        <div className="flex min-w-0 flex-wrap gap-2">
          <Link
            href={draft.compareHref}
            prefetch={false}
            className={cn(
              buttonVariants({ variant: 'outline' }),
              'min-h-11',
            )}
          >
            <GitCompareArrows aria-hidden="true" />
            查看本次修改
          </Link>
          <Link
            href={draft.publishHref}
            prefetch={false}
            className={cn(buttonVariants(), 'min-h-11')}
          >
            去校验并发布
          </Link>
        </div>
      </div>
    </section>
  );
}

function WorkspaceFilters({
  purpose,
  searchAction,
  hiddenSearchFields,
  filters,
  filterOptions,
  clearFiltersHref,
  changedFilterAvailable,
}: Pick<
  ExternalSalesChargeWorkspaceProps,
  | 'purpose'
  | 'searchAction'
  | 'hiddenSearchFields'
  | 'filters'
  | 'filterOptions'
  | 'clearFiltersHref'
  | 'changedFilterAvailable'
>) {
  const advancedFilterCount = activeAdvancedFilterCount(filters);

  return (
    <form
      action={searchAction}
      method="get"
      role="search"
      aria-label={`查找${PURPOSE_LABELS[purpose]}收费项目`}
      className="min-w-0 space-y-3 rounded-xl border bg-card p-4 shadow-sm"
    >
      {Object.entries(hiddenSearchFields ?? {}).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1 space-y-2">
          <label htmlFor="external-charge-search" className="text-sm font-medium">
            搜索收费项目
          </label>
          <div className="relative min-w-0">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              id="external-charge-search"
              name="q"
              className="min-h-11 pl-9"
              defaultValue={filters.query}
              placeholder={`项目名称、类目或${
                purpose === 'processing' ? '产品' : '地区'
              }`}
              maxLength={120}
            />
          </div>
        </div>
        <div className="flex min-w-0 flex-wrap gap-2">
          <Button type="submit" className="min-h-11">
            查找
          </Button>
          {filters.query || advancedFilterCount > 0 ? (
            <Link
              href={clearFiltersHref}
              prefetch={false}
              className={cn(
                buttonVariants({ variant: 'outline' }),
                'min-h-11',
              )}
            >
              清除条件
            </Link>
          ) : null}
        </div>
      </div>

      <details
        className="group min-w-0 rounded-lg border bg-muted/20"
        open={advancedFilterCount > 0}
      >
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-lg px-3 text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
          <Filter aria-hidden="true" className="size-4" />
          筛选条件
          {advancedFilterCount > 0 ? (
            <Badge variant="secondary">{advancedFilterCount} 项已选</Badge>
          ) : (
            <span className="text-xs font-normal text-muted-foreground">
              （使用时展开）
            </span>
          )}
        </summary>
        <div className="grid min-w-0 gap-4 border-t p-3 sm:grid-cols-2 xl:grid-cols-3">
          <label className="min-w-0 space-y-2 text-sm font-medium">
            <span>收费类目</span>
            <select
              name="category"
              className={selectClass}
              defaultValue={filters.category}
            >
              <option value="">全部类目</option>
              {filterOptions.categories.map((option) => (
                <option key={option.value} value={option.value}>
                  {optionLabel(option)}
                </option>
              ))}
            </select>
          </label>
          <label className="min-w-0 space-y-2 text-sm font-medium">
            <span>{purpose === 'processing' ? '适用产品' : '适用地区'}</span>
            <select
              name="subject"
              className={selectClass}
              defaultValue={filters.subject}
            >
              <option value="">全部{purpose === 'processing' ? '产品' : '地区'}</option>
              {filterOptions.subjects.map((option) => (
                <option key={option.value} value={option.value}>
                  {optionLabel(option)}
                </option>
              ))}
            </select>
          </label>
          <label className="min-w-0 space-y-2 text-sm font-medium">
            <span>收费类型</span>
            <select
              name="kind"
              className={selectClass}
              defaultValue={filters.kind}
            >
              <option value="">全部收费类型</option>
              <option value="BASE">基础价</option>
              <option value="ADD_ON">附加费</option>
              <option value="REFERENCE">人工参考</option>
            </select>
          </label>
          <label className="min-w-0 space-y-2 text-sm font-medium">
            <span>计价方式</span>
            <select
              name="calculation"
              className={selectClass}
              defaultValue={filters.calculation}
            >
              <option value="">全部计价方式</option>
              {filterOptions.calculations.map((option) => (
                <option key={option.value} value={option.value}>
                  {optionLabel(option)}
                </option>
              ))}
            </select>
          </label>
          <label className="min-w-0 space-y-2 text-sm font-medium">
            <span>适用数量</span>
            <Input
              name="quantity"
              type="number"
              inputMode="numeric"
              min={1}
              max={9_999_999}
              step={1}
              className="min-h-11"
              defaultValue={filters.quantity}
              placeholder="例如：1000"
            />
          </label>
          <label className="min-w-0 space-y-2 text-sm font-medium">
            <span>处理方式</span>
            <select
              name="automation"
              className={selectClass}
              defaultValue={filters.automation}
            >
              <option value="">全部处理方式</option>
              <option value="AUTO">自动计价</option>
              <option value="MANUAL">需人工确认</option>
            </select>
          </label>
          <label className="min-w-0 space-y-2 text-sm font-medium">
            <span>启用状态</span>
            <select
              name="status"
              className={selectClass}
              defaultValue={filters.status}
            >
              <option value="">全部状态</option>
              <option value="ACTIVE">已启用</option>
              <option value="INACTIVE">已停用</option>
            </select>
          </label>
          {changedFilterAvailable ? (
            <label className="flex min-h-11 min-w-0 items-center gap-3 self-end rounded-lg border bg-background px-3 text-sm font-medium">
              <input
                type="checkbox"
                name="changed"
                value="1"
                defaultChecked={filters.changedOnly}
                className="size-4 shrink-0 accent-primary"
              />
              只看本次修改
            </label>
          ) : null}
          <div className="sm:col-span-2 xl:col-span-3">
            <Button type="submit" variant="secondary" className="min-h-11">
              应用筛选
            </Button>
          </div>
        </div>
      </details>
    </form>
  );
}

function ItemPriceComparison({
  item,
  hasDraft,
}: {
  item: ExternalSalesChargeWorkspaceItem;
  hasDraft: boolean;
}) {
  return (
    <dl className="grid min-w-0 grid-cols-2 gap-3 text-sm sm:grid-cols-3">
      <div className="min-w-0">
        <dt className="text-xs text-muted-foreground">当前价</dt>
        <dd className="admin-wrap-anywhere mt-1 font-sans font-medium tabular-nums">
          {item.currentAmountLabel}
        </dd>
      </div>
      <div className="min-w-0">
        <dt className="text-xs text-muted-foreground">草稿价</dt>
        <dd
          className={cn(
            'admin-wrap-anywhere mt-1 font-sans font-medium tabular-nums',
            item.changed && 'text-warning-foreground',
          )}
        >
          {!hasDraft
            ? '暂无草稿'
            : item.changed
            ? (item.draftAmountLabel ?? '已修改')
            : '未修改'}
        </dd>
      </div>
      <div className="col-span-2 min-w-0 sm:col-span-1">
        <dt className="text-xs text-muted-foreground">价格变化</dt>
        <dd
          className={cn(
            'admin-wrap-anywhere mt-1 font-sans font-medium tabular-nums',
            item.changed && hasDraft && 'text-warning-foreground',
          )}
        >
          {priceChangeLabel(item, hasDraft)}
        </dd>
      </div>
    </dl>
  );
}

function BusinessChangeSummary({
  item,
}: {
  item: ExternalSalesChargeWorkspaceItem;
}) {
  if (!item.changeSummaryLabels?.length) return null;
  return (
    <div className="mt-3 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
      <p className="font-medium text-warning-foreground">其他业务变更</p>
      <ul
        aria-label="其他业务变更"
        className="mt-1 list-disc space-y-1 pl-5 text-muted-foreground"
      >
        {item.changeSummaryLabels.map((label) => (
          <li key={label} className="admin-wrap-anywhere">
            {label}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ProductPriceTiers({
  item,
  hasDraft,
}: {
  item: ExternalSalesChargeWorkspaceItem;
  hasDraft: boolean;
}) {
  if (!item.priceTiers?.length) return null;

  return (
    <dl
      aria-label={`${item.name}数量价格阶梯`}
      className="mt-3 grid min-w-0 grid-cols-2 gap-2 border-t pt-3 sm:grid-cols-4 2xl:grid-cols-7"
    >
      {item.priceTiers.map((tier, index) => (
        <div
          key={`${tier.quantityLabel}-${index}`}
          className={cn(
            'min-w-0 rounded-lg border bg-background px-2.5 py-2',
            tier.changed && hasDraft && 'border-warning/50 bg-warning/5',
          )}
        >
          <dt className="font-sans text-xs tabular-nums text-muted-foreground">
            {tier.quantityLabel}
          </dt>
          <dd className="admin-wrap-anywhere mt-1 font-sans text-sm font-semibold tabular-nums">
            {tier.currentAmountLabel}
          </dd>
          {hasDraft && tier.changed ? (
            <dd className="admin-wrap-anywhere mt-0.5 font-sans text-xs font-medium tabular-nums text-warning-foreground">
              <span className="sr-only">草稿价：</span>
              → {tier.draftAmountLabel ?? '待设置'}
            </dd>
          ) : null}
        </div>
      ))}
    </dl>
  );
}

function ChargeItemRow({
  item,
  selected,
  hasDraft,
}: {
  item: ExternalSalesChargeWorkspaceItem;
  selected: boolean;
  hasDraft: boolean;
}) {
  const actionLabel = hasDraft ? '编辑收费项目' : '查看详情';
  const selectedActionLabel = hasDraft ? '正在编辑' : '正在查看';

  return (
    <li className="min-w-0">
      <Link
        href={item.detailHref}
        prefetch={false}
        aria-current={selected ? 'page' : undefined}
        aria-label={`${selected ? selectedActionLabel : actionLabel}：${item.name}`}
        className={cn(
          'block min-h-11 min-w-0 px-3 py-3 transition-colors outline-none hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/50 sm:px-4',
          selected && 'bg-primary/5',
        )}
      >
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="admin-wrap-anywhere font-medium">{item.name}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {item.automation === 'AUTO' ? '自动计价' : '需人工确认'}
            </p>
          </div>
          <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5">
            {item.changed ? (
              <Badge variant="secondary">已修改</Badge>
            ) : null}
            <Badge
              variant="outline"
              className={item.status === 'INACTIVE' ? 'border-destructive/60' : undefined}
            >
              {item.statusLabel ?? (item.changeSummaryLabels?.some((label) =>
                label.startsWith('状态：'),
              )
                ? item.status === 'ACTIVE'
                  ? '草稿已启用'
                  : '草稿已停用'
                : item.status === 'ACTIVE'
                  ? '已启用'
                  : '已停用')}
            </Badge>
            <span className="inline-flex items-center gap-1 text-sm font-medium text-primary">
              {selected ? selectedActionLabel : actionLabel}
              <ChevronRight aria-hidden="true" className="size-4" />
            </span>
          </div>
        </div>

        {item.priceTiers?.length ? (
          <ProductPriceTiers item={item} hasDraft={hasDraft} />
        ) : (
          <dl className="mt-3 grid min-w-0 grid-cols-2 gap-x-3 gap-y-2 border-t pt-3 text-sm sm:grid-cols-5">
            <div className="min-w-0">
              <dt className="text-xs text-muted-foreground">数量范围</dt>
              <dd className="admin-wrap-anywhere mt-1">
                {item.quantityLabel}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-muted-foreground">计价方式</dt>
              <dd className="admin-wrap-anywhere mt-1">
                {item.calculationLabel}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-muted-foreground">当前价</dt>
              <dd className="admin-wrap-anywhere mt-1 font-sans font-medium tabular-nums">
                {item.currentAmountLabel}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-muted-foreground">草稿价</dt>
              <dd
                className={cn(
                  'admin-wrap-anywhere mt-1 font-sans font-medium tabular-nums',
                  item.changed && hasDraft && 'text-warning-foreground',
                )}
              >
                {!hasDraft
                  ? '—'
                  : item.changed
                    ? (item.draftAmountLabel ?? '已修改')
                    : '未修改'}
              </dd>
            </div>
            <div className="col-span-2 min-w-0 sm:col-span-1">
              <dt className="text-xs text-muted-foreground">价格变化</dt>
              <dd
                className={cn(
                  'admin-wrap-anywhere mt-1 font-sans font-medium tabular-nums',
                  item.changed && hasDraft && 'text-warning-foreground',
                )}
              >
                {priceChangeLabel(item, hasDraft)}
              </dd>
            </div>
          </dl>
        )}
        <BusinessChangeSummary item={item} />
      </Link>
    </li>
  );
}

function ChargeItemGroup({
  group,
  groupIndex,
  selectedItemId,
  hasDraft,
}: {
  group: ExternalSalesChargeWorkspaceGroup;
  groupIndex: number;
  selectedItemId?: string;
  hasDraft: boolean;
}) {
  const headingId = `external-charge-group-${groupIndex}`;

  return (
    <section
      aria-labelledby={headingId}
      className="min-w-0 rounded-xl border bg-card shadow-sm"
    >
      <header className="flex min-w-0 flex-wrap items-start justify-between gap-2 rounded-t-xl border-b bg-muted/30 px-3 py-3 sm:px-4">
        <div className="min-w-0">
          <h3 id={headingId} className="admin-wrap-anywhere font-medium">
            {group.subjectLabel}
          </h3>
          <p className="admin-wrap-anywhere mt-0.5 text-xs text-muted-foreground">
            {group.categoryLabel}
          </p>
        </div>
        <Badge variant="outline" className="font-sans tabular-nums">
          {group.items.length} 项
        </Badge>
      </header>
      <ol className="min-w-0 divide-y">
        {group.items.map((item) => (
          <ChargeItemRow
            key={item.id}
            item={item}
            selected={item.id === selectedItemId}
            hasDraft={hasDraft}
          />
        ))}
      </ol>
    </section>
  );
}

function Pagination({
  pagination,
}: Pick<ExternalSalesChargeWorkspaceProps, 'pagination'>) {
  if (pagination.pageCount <= 1) return null;

  return (
    <nav
      aria-label="收费项目分页"
      className="flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-3 sm:flex-row sm:items-center sm:justify-between"
    >
      <p className="font-sans text-sm tabular-nums text-muted-foreground">
        第 {pagination.page} / {pagination.pageCount} 页，共 {pagination.total} 项
      </p>
      <div className="flex min-w-0 gap-2">
        {pagination.previousHref ? (
          <Link
            href={pagination.previousHref}
            prefetch={false}
            className={cn(
              buttonVariants({ variant: 'outline' }),
              'min-h-11 flex-1 sm:flex-none',
            )}
          >
            <ChevronLeft aria-hidden="true" />
            上一页
          </Link>
        ) : (
          <span
            aria-disabled="true"
            className={cn(
              buttonVariants({ variant: 'outline' }),
              'min-h-11 flex-1 opacity-50 sm:flex-none',
            )}
          >
            <ChevronLeft aria-hidden="true" />
            上一页
          </span>
        )}
        {pagination.nextHref ? (
          <Link
            href={pagination.nextHref}
            prefetch={false}
            className={cn(
              buttonVariants({ variant: 'outline' }),
              'min-h-11 flex-1 sm:flex-none',
            )}
          >
            下一页
            <ChevronRight aria-hidden="true" />
          </Link>
        ) : (
          <span
            aria-disabled="true"
            className={cn(
              buttonVariants({ variant: 'outline' }),
              'min-h-11 flex-1 opacity-50 sm:flex-none',
            )}
          >
            下一页
            <ChevronRight aria-hidden="true" />
          </span>
        )}
      </div>
    </nav>
  );
}

function SelectedChargeDetail({
  selectedItem,
  selectedEditor,
  hasDraft,
  createDraftHref,
}: {
  selectedItem?: ExternalSalesChargeWorkspaceItem;
  selectedEditor?: ReactNode;
  hasDraft: boolean;
  createDraftHref?: string;
}) {
  if (!selectedItem) {
    return (
      <aside
        aria-label="收费项目详情"
        className="hidden min-w-0 rounded-xl border bg-card p-4 text-sm text-muted-foreground shadow-sm xl:sticky xl:top-4 xl:block xl:self-start"
      >
        选择一个收费项目后，这里会显示当前价格和可编辑内容。
      </aside>
    );
  }

  return (
    <aside
      id="selected-charge-detail"
      // tabIndex={-1}：hash 主从导航跳转后要能把焦点送过来，否则键盘/读屏用户不知道跳到哪了。
      tabIndex={-1}
      aria-labelledby="selected-charge-heading"
      className="min-w-0 scroll-mt-4 space-y-4 focus-visible:outline-none xl:max-h-[calc(100dvh-2rem)] xl:self-start xl:overflow-y-auto xl:overscroll-contain xl:pr-1"
    >
      <div className="xl:hidden">
        <a
          href="#external-charge-list"
          className={cn(
            buttonVariants({ variant: 'outline' }),
            'min-h-11',
          )}
        >
          <ChevronLeft aria-hidden="true" />
          返回收费项目列表
        </a>
      </div>
      <section className="min-w-0 rounded-xl border bg-card p-4 shadow-sm">
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">收费项目详情</p>
            <h2
              id="selected-charge-heading"
              className="admin-wrap-anywhere mt-1 text-lg font-semibold"
            >
              {selectedItem.name}
            </h2>
          </div>
          <Badge
            variant="outline"
            className={
              selectedItem.status === 'INACTIVE'
                ? 'border-destructive/60'
                : undefined
            }
          >
            {selectedItem.statusLabel ??
              (selectedItem.status === 'ACTIVE' ? '已启用' : '已停用')}
          </Badge>
        </div>
        <dl className="mt-4 grid min-w-0 gap-4 text-sm sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">收费类目</dt>
            <dd className="admin-wrap-anywhere mt-1">
              {selectedItem.categoryLabel}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">适用范围</dt>
            <dd className="admin-wrap-anywhere mt-1">
              {selectedItem.subjectLabel}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">数量范围</dt>
            <dd className="admin-wrap-anywhere mt-1">
              {selectedItem.quantityLabel}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">计价方式</dt>
            <dd className="admin-wrap-anywhere mt-1">
              {selectedItem.calculationLabel}
            </dd>
          </div>
        </dl>
        <div
          className={cn(
            'mt-4',
            !selectedItem.priceTiers?.length && 'border-t pt-4',
          )}
        >
          {selectedItem.priceTiers?.length ? (
            <ProductPriceTiers item={selectedItem} hasDraft={hasDraft} />
          ) : (
            <ItemPriceComparison item={selectedItem} hasDraft={hasDraft} />
          )}
          <BusinessChangeSummary item={selectedItem} />
        </div>
      </section>

      {selectedEditor ? (
        <section aria-label="编辑收费项目" className="min-w-0">
          {selectedEditor}
        </section>
      ) : (
        <section className="min-w-0 rounded-xl border bg-muted/20 p-4 text-sm">
          <h3 className="font-medium">
            {hasDraft ? '该项目暂不可编辑' : '当前价格仅供查看'}
          </h3>
          <p className="mt-1 text-muted-foreground">
            {hasDraft
              ? '请确认收费项目是否属于当前草稿。'
              : '调整价格前需要先发起调价，已发布价格和历史工单不会被覆盖。'}
          </p>
          {!hasDraft && createDraftHref ? (
            <Link
              href={createDraftHref}
              prefetch={false}
              className={cn(buttonVariants(), 'mt-3 min-h-11')}
            >
              发起调价
            </Link>
          ) : null}
        </section>
      )}
    </aside>
  );
}

export function ExternalSalesChargeWorkspace({
  purpose,
  workspaceStatus = 'CURRENT',
  purposeHrefs,
  searchAction,
  hiddenSearchFields,
  filters,
  filterOptions,
  clearFiltersHref,
  items,
  selectedItem: selectedItemProp,
  selectedItemId,
  selectedEditor,
  draft,
  createDraftHref,
  createDraftEditor,
  createDraftOpen,
  createDraftBlockedReason,
  changedFilterAvailable = Boolean(draft),
  pagination,
}: ExternalSalesChargeWorkspaceProps) {
  const selectedItem =
    selectedItemProp ?? items.find((item) => item.id === selectedItemId);
  const itemGroups = groupWorkspaceItems(items);

  return (
    <div className="min-w-0 space-y-5">
      <nav
        aria-label="外部销售收费类型"
        className="grid min-w-0 grid-cols-1 gap-2 rounded-xl border bg-card p-2 shadow-sm sm:grid-cols-2"
      >
        {(Object.keys(PURPOSE_LABELS) as ExternalSalesChargePurpose[]).map(
          (entry) => {
            const active = entry === purpose;
            return (
              <Link
                key={entry}
                href={purposeHrefs[entry]}
                prefetch={false}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  buttonVariants({ variant: active ? 'default' : 'ghost' }),
                  'min-h-11 min-w-0 whitespace-normal',
                )}
              >
                {PURPOSE_LABELS[entry]}
              </Link>
            );
          },
        )}
      </nav>

      <DraftStatusBar
        draft={draft}
        workspaceStatus={workspaceStatus}
        createDraftHref={createDraftHref}
        createDraftEditor={createDraftEditor}
        createDraftOpen={createDraftOpen}
        createDraftBlockedReason={createDraftBlockedReason}
      />

      <WorkspaceFilters
        purpose={purpose}
        searchAction={searchAction}
        hiddenSearchFields={hiddenSearchFields}
        filters={filters}
        filterOptions={filterOptions}
        clearFiltersHref={clearFiltersHref}
        changedFilterAvailable={changedFilterAvailable}
      />

      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(20rem,0.8fr)]">
        <section
          id="external-charge-list"
          // tabIndex={-1}：同上，「返回列表」的 hash 跳转要能落焦点。
          tabIndex={-1}
          aria-labelledby="charge-list-heading"
          className="min-w-0 scroll-mt-4 space-y-3 focus-visible:outline-none"
        >
          <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-2">
            <h2 id="charge-list-heading" className="font-semibold">
              {PURPOSE_LABELS[purpose]}收费项目
            </h2>
            <p className="font-sans text-sm tabular-nums text-muted-foreground">
              筛选结果 {pagination.total} 项
            </p>
          </div>

          {items.length > 0 ? (
            <div className="min-w-0 space-y-3">
              {itemGroups.map((group, groupIndex) => (
                <ChargeItemGroup
                  key={group.key}
                  group={group}
                  groupIndex={groupIndex}
                  selectedItemId={selectedItem?.id}
                  hasDraft={Boolean(draft)}
                />
              ))}
            </div>
          ) : (
            <div className="rounded-xl border bg-card p-6 text-center shadow-sm">
              <p className="font-medium">没有找到符合条件的收费项目</p>
              <p className="mt-1 text-sm text-muted-foreground">
                请调整关键词或清除部分筛选条件。
              </p>
              <Link
                href={clearFiltersHref}
                prefetch={false}
                className={cn(
                  buttonVariants({ variant: 'outline' }),
                  'mt-4 min-h-11',
                )}
              >
                清除条件
              </Link>
            </div>
          )}

          <Pagination pagination={pagination} />
        </section>

        <SelectedChargeDetail
          selectedItem={selectedItem}
          selectedEditor={selectedEditor}
          hasDraft={Boolean(draft)}
          createDraftHref={createDraftHref}
        />
      </div>
    </div>
  );
}
