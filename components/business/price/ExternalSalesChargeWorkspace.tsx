import type { ReactNode } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Filter,
  GitCompareArrows,
  Search,
  X,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Disclosure, DisclosureSummary } from '@/components/ui/disclosure';
import { Input } from '@/components/ui/input';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { EmptyState } from '@/components/ui-business';
import { cn } from '@/lib/utils';
import {
  PriceWorkspaceLink,
  PriceWorkspaceNavigationGuardProvider,
  PriceWorkspaceUnsavedSummary,
} from './PriceWorkspaceNavigationGuard';

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
        description: '当前为生效价，发起调价后才能改',
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
        className="admin-sticky-below-header sticky z-[5] min-w-0 rounded-xl border bg-card p-4 shadow-sm"
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
            <PriceWorkspaceLink
              href={createDraftHref}
              prefetch={false}
              className={cn(
                buttonVariants({ variant: 'outline' }),
                'min-h-11 shrink-0',
              )}
            >
              发起调价
            </PriceWorkspaceLink>
          ) : null}
        </div>
        {createDraftEditor ? (
          <Disclosure
            id="start-price-adjustment"
            className="group mt-3 min-w-0 rounded-lg border bg-muted/20 p-3"
            open={createDraftOpen || undefined}
          >
            <DisclosureSummary
              className={cn(
                buttonVariants({ variant: 'outline' }),
                'min-h-11',
              )}
            >
              发起调价
            </DisclosureSummary>
            <div className="min-w-0 border-t pt-3">{createDraftEditor}</div>
          </Disclosure>
        ) : null}
      </section>
    );
  }

  return (
    <section
      aria-label="调价草稿状态"
      className="admin-sticky-below-header sticky z-[5] min-w-0 rounded-xl border border-warning/40 bg-warning/10 p-4 shadow-sm"
    >
      <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Badge variant="secondary">调价草稿</Badge>
            <p className="font-sans text-sm font-medium tabular-nums">
              本轮调价 · 第 {draft.version} 版
            </p>
            <p className="font-sans text-sm tabular-nums text-warning-foreground">
              {draft.changedCount} 项已写入草稿
            </p>
            <PriceWorkspaceUnsavedSummary />
          </div>
          <p className="admin-wrap-anywhere mt-2 text-sm">
            调价原因：{draft.changeReason}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            最近保存：{draft.lastSavedLabel}。发布前不会影响当前工单计价。
          </p>
        </div>
        <div className="flex min-w-0 flex-wrap gap-2">
          <PriceWorkspaceLink
            href={draft.compareHref}
            prefetch={false}
            className={cn(
              buttonVariants({ variant: 'outline' }),
              'min-h-11',
            )}
          >
            <GitCompareArrows aria-hidden="true" />
            查看草稿差异
          </PriceWorkspaceLink>
          <PriceWorkspaceLink
            href={draft.publishHref}
            prefetch={false}
            className={cn(buttonVariants(), 'min-h-11')}
          >
            前往校验发布
          </PriceWorkspaceLink>
        </div>
      </div>
    </section>
  );
}

type WorkspaceFiltersProps = Pick<
  ExternalSalesChargeWorkspaceProps,
  | 'purpose'
  | 'searchAction'
  | 'hiddenSearchFields'
  | 'filters'
  | 'filterOptions'
  | 'clearFiltersHref'
  | 'changedFilterAvailable'
>;

type WorkspaceFilterKey = keyof ExternalSalesChargeWorkspaceFilters;

type ActiveWorkspaceFilter = {
  key: WorkspaceFilterKey;
  label: string;
};

function activeWorkspaceFilters({
  purpose,
  filters,
  filterOptions,
}: Pick<
  WorkspaceFiltersProps,
  'purpose' | 'filters' | 'filterOptions'
>): ActiveWorkspaceFilter[] {
  const option = (
    options: ExternalSalesChargeFilterOption[],
    value: string,
  ) => options.find((entry) => entry.value === value)?.label ?? value;
  return [
    filters.query ? { key: 'query', label: `搜索：${filters.query}` } : null,
    filters.category
      ? {
          key: 'category',
          label: `类目：${option(filterOptions.categories, filters.category)}`,
        }
      : null,
    filters.subject
      ? {
          key: 'subject',
          label: `${purpose === 'processing' ? '产品' : '地区'}：${option(
            filterOptions.subjects,
            filters.subject,
          )}`,
        }
      : null,
    filters.kind
      ? {
          key: 'kind',
          label: `类型：${
            { BASE: '基础价', ADD_ON: '附加费', REFERENCE: '人工参考' }[
              filters.kind
            ]
          }`,
        }
      : null,
    filters.calculation
      ? {
          key: 'calculation',
          label: `计价：${option(
            filterOptions.calculations,
            filters.calculation,
          )}`,
        }
      : null,
    filters.quantity
      ? { key: 'quantity', label: `数量：${filters.quantity}` }
      : null,
    filters.automation
      ? {
          key: 'automation',
          label: `处理：${
            filters.automation === 'AUTO' ? '自动计价' : '需人工确认'
          }`,
        }
      : null,
    filters.status
      ? {
          key: 'status',
          label: `状态：${
            filters.status === 'ACTIVE' ? '已启用' : '已停用'
          }`,
        }
      : null,
    filters.changedOnly
      ? { key: 'changedOnly', label: '只看本次修改' }
      : null,
  ].filter((entry): entry is ActiveWorkspaceFilter => entry !== null);
}

function workspaceFilterHref(
  props: WorkspaceFiltersProps,
  omittedFilter: WorkspaceFilterKey,
): string {
  const [actionWithoutHash = ''] = props.searchAction.split('#');
  const [pathname = '', existingQuery = ''] = actionWithoutHash.split('?');
  const params = new URLSearchParams(existingQuery);
  Object.entries(props.hiddenSearchFields ?? {}).forEach(([name, value]) => {
    params.set(name, value);
  });

  const values: ReadonlyArray<
    readonly [WorkspaceFilterKey, queryName: string, value: string]
  > = [
    ['query', 'q', props.filters.query],
    ['category', 'category', props.filters.category],
    ['subject', 'subject', props.filters.subject],
    ['kind', 'kind', props.filters.kind],
    ['calculation', 'calculation', props.filters.calculation],
    ['quantity', 'quantity', props.filters.quantity],
    ['automation', 'automation', props.filters.automation],
    ['status', 'status', props.filters.status],
    ['changedOnly', 'changed', props.filters.changedOnly ? '1' : ''],
  ];
  values.forEach(([key, queryName, value]) => {
    if (key === omittedFilter || !value) params.delete(queryName);
    else params.set(queryName, value);
  });

  const query = params.toString();
  return `${pathname}${query ? `?${query}` : ''}`;
}

function WorkspaceFilters(props: WorkspaceFiltersProps) {
  const advancedFilterCount = activeAdvancedFilterCount(props.filters);
  const activeFilters = activeWorkspaceFilters(props);

  return (
    <div className="min-w-0 space-y-3">
      <WorkspaceSearchAndDesktopFilters {...props} />
      <MobileWorkspaceFilters
        {...props}
        advancedFilterCount={advancedFilterCount}
      />
      {activeFilters.length > 0 ? (
        <div
          aria-label="已启用的收费项目筛选"
          className="flex min-w-0 flex-nowrap items-center gap-2 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-visible sm:pb-0"
        >
          {activeFilters.map(({ key, label }) => (
            <Badge
              key={key}
              variant="outline"
              className="max-w-[85vw] shrink-0 overflow-hidden bg-card p-0 whitespace-normal sm:max-w-full"
            >
              <PriceWorkspaceLink
                href={workspaceFilterHref(props, key)}
                prefetch={false}
                aria-label={`清除筛选：${label}`}
                className="inline-flex min-h-11 min-w-0 items-center gap-1 px-2 py-1.5 hover:bg-muted sm:min-h-7 sm:py-0.5"
              >
                <span className="min-w-0 break-words">{label}</span>
                <X aria-hidden="true" className="size-3 shrink-0" />
              </PriceWorkspaceLink>
            </Badge>
          ))}
          <PriceWorkspaceLink
            href={props.clearFiltersHref}
            prefetch={false}
            aria-label="清除全部收费项目筛选"
            className={cn(
              buttonVariants({ variant: 'ghost', size: 'sm' }),
              'min-h-11 shrink-0 sm:min-h-7',
            )}
          >
            <X aria-hidden="true" />
            清除全部
          </PriceWorkspaceLink>
        </div>
      ) : null}
    </div>
  );
}

function WorkspaceSearchAndDesktopFilters({
  purpose,
  searchAction,
  hiddenSearchFields,
  filters,
  filterOptions,
  clearFiltersHref,
  changedFilterAvailable,
}: WorkspaceFiltersProps) {
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
            <PriceWorkspaceLink
              href={clearFiltersHref}
              prefetch={false}
              className={cn(
                buttonVariants({ variant: 'outline' }),
                'min-h-11',
              )}
            >
              清除条件
            </PriceWorkspaceLink>
          ) : null}
        </div>
      </div>

      <Disclosure
        className="group hidden min-w-0 rounded-lg border bg-muted/20 sm:block"
        open={advancedFilterCount > 0}
      >
        <DisclosureSummary className="gap-2 rounded-lg px-3">
          <Filter aria-hidden="true" className="size-4" />
          更多筛选
          {advancedFilterCount > 0 ? (
            <Badge variant="secondary">{advancedFilterCount} 项已选</Badge>
          ) : (
            <span className="text-xs font-normal text-muted-foreground">
              （使用时展开）
            </span>
          )}
        </DisclosureSummary>
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
      </Disclosure>
    </form>
  );
}

function MobileWorkspaceFilters({
  purpose,
  searchAction,
  hiddenSearchFields,
  filters,
  filterOptions,
  clearFiltersHref,
  changedFilterAvailable,
  advancedFilterCount,
}: WorkspaceFiltersProps & { advancedFilterCount: number }) {
  return (
    <div className="sm:hidden">
      <Sheet>
        <SheetTrigger
          render={
            <Button
              type="button"
              variant="outline"
              className="min-h-11 w-full"
              aria-label={
                advancedFilterCount > 0
                  ? `打开更多筛选，已启用 ${advancedFilterCount} 项`
                  : '打开更多筛选'
              }
            />
          }
        >
          <Filter aria-hidden="true" className="size-4" />
          更多筛选
          {advancedFilterCount > 0 ? (
            <Badge variant="secondary">{advancedFilterCount}</Badge>
          ) : null}
        </SheetTrigger>
        <SheetContent
          side="bottom"
          className="flex max-h-[80dvh] min-w-0 flex-col rounded-t-2xl sm:hidden"
        >
          <SheetHeader className="shrink-0 border-b pr-14">
            <SheetTitle className="flex items-center gap-2">
              <Filter aria-hidden="true" className="size-4" />
              更多筛选
            </SheetTitle>
            <SheetDescription>
              已启用 {advancedFilterCount} 项；应用后返回收费项目列表。
            </SheetDescription>
          </SheetHeader>
          <form
            action={searchAction}
            method="get"
            aria-label={`筛选${PURPOSE_LABELS[purpose]}收费项目`}
            className="flex min-h-0 flex-1 flex-col"
          >
            {Object.entries(hiddenSearchFields ?? {}).map(([name, value]) => (
              <input key={name} type="hidden" name={name} value={value} />
            ))}
            <input type="hidden" name="q" value={filters.query} />
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">
              <div className="grid min-w-0 gap-4">
                <label
                  htmlFor="mobile-external-charge-category"
                  className="min-w-0 space-y-2 text-sm font-medium"
                >
                  <span>收费类目</span>
                  <select
                    id="mobile-external-charge-category"
                    name="category"
                    autoFocus
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
                <label
                  htmlFor="mobile-external-charge-subject"
                  className="min-w-0 space-y-2 text-sm font-medium"
                >
                  <span>{purpose === 'processing' ? '适用产品' : '适用地区'}</span>
                  <select
                    id="mobile-external-charge-subject"
                    name="subject"
                    className={selectClass}
                    defaultValue={filters.subject}
                  >
                    <option value="">
                      全部{purpose === 'processing' ? '产品' : '地区'}
                    </option>
                    {filterOptions.subjects.map((option) => (
                      <option key={option.value} value={option.value}>
                        {optionLabel(option)}
                      </option>
                    ))}
                  </select>
                </label>
                <label
                  htmlFor="mobile-external-charge-kind"
                  className="min-w-0 space-y-2 text-sm font-medium"
                >
                  <span>收费类型</span>
                  <select
                    id="mobile-external-charge-kind"
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
                <label
                  htmlFor="mobile-external-charge-calculation"
                  className="min-w-0 space-y-2 text-sm font-medium"
                >
                  <span>计价方式</span>
                  <select
                    id="mobile-external-charge-calculation"
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
                <label
                  htmlFor="mobile-external-charge-quantity"
                  className="min-w-0 space-y-2 text-sm font-medium"
                >
                  <span>适用数量</span>
                  <Input
                    id="mobile-external-charge-quantity"
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
                <label
                  htmlFor="mobile-external-charge-automation"
                  className="min-w-0 space-y-2 text-sm font-medium"
                >
                  <span>处理方式</span>
                  <select
                    id="mobile-external-charge-automation"
                    name="automation"
                    className={selectClass}
                    defaultValue={filters.automation}
                  >
                    <option value="">全部处理方式</option>
                    <option value="AUTO">自动计价</option>
                    <option value="MANUAL">需人工确认</option>
                  </select>
                </label>
                <label
                  htmlFor="mobile-external-charge-status"
                  className="min-w-0 space-y-2 text-sm font-medium"
                >
                  <span>启用状态</span>
                  <select
                    id="mobile-external-charge-status"
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
                  <label
                    htmlFor="mobile-external-charge-changed"
                    className="flex min-h-11 min-w-0 items-center gap-3 rounded-lg border bg-background px-3 text-sm font-medium"
                  >
                    <input
                      id="mobile-external-charge-changed"
                      type="checkbox"
                      name="changed"
                      value="1"
                      defaultChecked={filters.changedOnly}
                      className="size-4 shrink-0 accent-primary"
                    />
                    只看本次修改
                  </label>
                ) : null}
              </div>
            </div>
            <div className="flex shrink-0 flex-col gap-2 border-t bg-popover px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom,0px))] sm:flex-row">
              <Button type="submit" className="min-h-11">
                应用筛选
              </Button>
              {advancedFilterCount > 0 ? (
                <PriceWorkspaceLink
                  href={clearFiltersHref}
                  prefetch={false}
                  className={cn(
                    buttonVariants({ variant: 'outline' }),
                    'min-h-11',
                  )}
                >
                  清除筛选
                </PriceWorkspaceLink>
              ) : null}
            </div>
          </form>
        </SheetContent>
      </Sheet>
    </div>
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

function SelectedChargePriceSummary({
  item,
  hasDraft,
}: {
  item: ExternalSalesChargeWorkspaceItem;
  hasDraft: boolean;
}) {
  const statusLabel =
    item.statusLabel ?? (item.status === 'ACTIVE' ? '已启用' : '已停用');

  return (
    <dl
      aria-label={`${item.name}价格对比`}
      className="grid min-w-0 grid-cols-2 gap-3 rounded-xl border bg-card p-4 text-sm shadow-sm"
    >
      <div className="min-w-0">
        <dt className="text-xs text-muted-foreground">当前</dt>
        <dd className="admin-wrap-anywhere mt-1 font-sans font-medium tabular-nums">
          {item.currentAmountLabel}
        </dd>
      </div>
      <div className="min-w-0">
        <dt className="text-xs text-muted-foreground">草稿</dt>
        <dd className="admin-wrap-anywhere mt-1 font-sans font-medium tabular-nums">
          {hasDraft ? (item.draftAmountLabel ?? '待补全') : '暂无草稿'}
        </dd>
      </div>
      <div className="min-w-0">
        <dt className="text-xs text-muted-foreground">变化</dt>
        <dd
          className={cn(
            'admin-wrap-anywhere mt-1 font-sans font-medium tabular-nums',
            item.changed && hasDraft && 'text-warning-foreground',
          )}
        >
          {!hasDraft
            ? '—'
            : item.changed
              ? (item.priceChangeLabel ?? '已调整')
              : '无变更'}
        </dd>
      </div>
      <div className="min-w-0">
        <dt className="text-xs text-muted-foreground">启用</dt>
        <dd className="admin-wrap-anywhere mt-1 font-medium">{statusLabel}</dd>
      </div>
    </dl>
  );
}

function compactCurrentAmountLabel(
  item: ExternalSalesChargeWorkspaceItem,
): string {
  return item.currentAmountLabel.replace(
    /^\s*\d+\s*档\s*(?:·|•|｜|\|)\s*/,
    '',
  );
}

function itemTierSummary(
  item: ExternalSalesChargeWorkspaceItem,
  hasDraft: boolean,
) {
  const tiers = item.priceTiers;
  const tierCount = tiers?.length ?? 1;
  const changedCount = tiers
    ? tiers.filter((tier) => tier.changed).length
    : item.changed
      ? 1
      : 0;
  const incompleteCount = !hasDraft
    ? 0
    : tiers
      ? tiers.filter(
          (tier) =>
            !tier.draftAmountLabel ||
            /待(?:设置|补全|人工确认|确认)/.test(tier.draftAmountLabel),
        ).length
      : !item.draftAmountLabel ||
          /待(?:设置|补全|人工确认|确认)/.test(item.draftAmountLabel)
        ? 1
        : 0;

  return {
    tierCount,
    currentAmountLabel: compactCurrentAmountLabel(item),
    progressLabel: hasDraft
      ? `${changedCount}/${tierCount} 档已调整`
      : '未发起调整',
    completionLabel: !hasDraft
      ? '无需补全'
      : incompleteCount > 0
        ? `待补全 ${incompleteCount} 档`
        : '已补全',
    incompleteCount,
  };
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
  const summary = itemTierSummary(item, hasDraft);

  return (
    <li className="min-w-0">
      <PriceWorkspaceLink
        href={item.detailHref}
        prefetch={false}
        aria-current={selected ? 'page' : undefined}
        aria-label={`${selected ? selectedActionLabel : actionLabel}：${item.name}`}
        className={cn(
          '!flex !w-full min-h-11 min-w-0 !flex-col !items-stretch px-3 py-3 transition-colors outline-none hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/50 sm:px-4',
          selected && 'bg-primary/5',
        )}
      >
        <div className="flex min-w-0 items-start justify-between gap-3">
          <p className="admin-wrap-anywhere min-w-0 flex-1 font-medium">
            {item.name}
          </p>
          <ChevronRight
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0 text-muted-foreground"
          />
        </div>
        <dl className="mt-2 grid min-w-0 grid-cols-2 gap-x-3 gap-y-2 text-sm sm:grid-cols-4">
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">档数</dt>
            <dd className="mt-0.5 font-sans tabular-nums">
              {summary.tierCount} 档
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">当前价区间</dt>
            <dd className="admin-wrap-anywhere mt-0.5 font-sans font-medium tabular-nums">
              {summary.currentAmountLabel}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">调整进度</dt>
            <dd className="mt-0.5 font-sans tabular-nums">
              {summary.progressLabel}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">待补全</dt>
            <dd
              className={cn(
                'mt-0.5 font-sans tabular-nums',
                summary.incompleteCount > 0 &&
                  'font-medium text-warning-foreground',
              )}
            >
              {summary.completionLabel}
            </dd>
          </div>
        </dl>
      </PriceWorkspaceLink>
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
          <PriceWorkspaceLink
            href={pagination.previousHref}
            prefetch={false}
            className={cn(
              buttonVariants({ variant: 'outline' }),
              'min-h-11 flex-1 sm:flex-none',
            )}
          >
            <ChevronLeft aria-hidden="true" />
            上一页
          </PriceWorkspaceLink>
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
          <PriceWorkspaceLink
            href={pagination.nextHref}
            prefetch={false}
            className={cn(
              buttonVariants({ variant: 'outline' }),
              'min-h-11 flex-1 sm:flex-none',
            )}
          >
            下一页
            <ChevronRight aria-hidden="true" />
          </PriceWorkspaceLink>
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

export function externalSalesChargeListHref(detailHref: string): string {
  if (detailHref.trim().startsWith('#')) return '#external-charge-list';
  try {
    const url = new URL(detailHref, 'https://price-workspace.local');
    url.searchParams.delete('item');
    url.hash = 'external-charge-list';
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return '#external-charge-list';
  }
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
        className="hidden min-w-0 rounded-xl border bg-card p-4 text-sm text-muted-foreground shadow-sm xl:order-2 xl:block xl:self-start"
      >
        选择一个收费项目
      </aside>
    );
  }

  const listHref = externalSalesChargeListHref(selectedItem.detailHref);

  return (
    <aside
      id="selected-charge-detail"
      // tabIndex={-1}：hash 主从导航跳转后要能把焦点送过来，否则键盘/读屏用户不知道跳到哪了。
      tabIndex={-1}
      aria-labelledby="selected-charge-heading"
      className="admin-scroll-target min-w-0 space-y-4 focus-visible:outline-none xl:order-2 xl:max-h-[calc(100dvh_-_var(--admin-header-offset)_-_1rem)] xl:self-start xl:overflow-y-auto xl:overscroll-contain xl:pr-1"
    >
      <div className="xl:hidden">
        <PriceWorkspaceLink
          href={listHref}
          prefetch={false}
          className={cn(
            buttonVariants({ variant: 'outline' }),
            'min-h-11',
          )}
        >
          <ChevronLeft aria-hidden="true" />
          返回收费项目列表
        </PriceWorkspaceLink>
      </div>
      {selectedEditor ? (
        <>
          <h2 id="selected-charge-heading" className="sr-only">
            {selectedItem.name}
          </h2>
          {!selectedItem.priceTiers?.length ? (
            <SelectedChargePriceSummary
              item={selectedItem}
              hasDraft={hasDraft}
            />
          ) : null}
          <BusinessChangeSummary item={selectedItem} />
        </>
      ) : (
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
          <dl className="mt-4 grid min-w-0 gap-4 text-sm sm:grid-cols-2 xl:grid-cols-1">
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
          <BusinessChangeSummary item={selectedItem} />
        </section>
      )}

      {!selectedEditor ? (
        <SelectedChargePriceSummary item={selectedItem} hasDraft={hasDraft} />
      ) : null}

      {selectedEditor ? (
        <section aria-label="编辑收费项目" className="min-w-0">
          {selectedEditor}
        </section>
      ) : (
        <section className="min-w-0 rounded-xl border bg-muted/20 p-4 text-sm">
          <h3 className="font-medium">
            {hasDraft ? '该项目不在当前调价草稿内' : '当前为生效价'}
          </h3>
          <p className="mt-1 text-muted-foreground">
            {hasDraft
              ? '该项目不在当前调价草稿内，只能查看生效价'
              : '当前为生效价，发起调价后才能改'}
          </p>
          {!hasDraft && createDraftHref ? (
            <PriceWorkspaceLink
              href={createDraftHref}
              prefetch={false}
              className={cn(buttonVariants(), 'mt-3 min-h-11')}
            >
              发起调价
            </PriceWorkspaceLink>
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
    <PriceWorkspaceNavigationGuardProvider>
      <div className="min-w-0 space-y-5">
      <nav
        aria-label="外部销售收费类型"
        className="grid min-w-0 grid-cols-1 gap-2 rounded-xl border bg-card p-2 shadow-sm sm:grid-cols-2"
      >
        {(Object.keys(PURPOSE_LABELS) as ExternalSalesChargePurpose[]).map(
          (entry) => {
            const active = entry === purpose;
            return (
              <PriceWorkspaceLink
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
              </PriceWorkspaceLink>
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

      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(30rem,31.25rem)]">
        <SelectedChargeDetail
          selectedItem={selectedItem}
          selectedEditor={selectedEditor}
          hasDraft={Boolean(draft)}
          createDraftHref={createDraftHref}
        />

        <section
          id="external-charge-list"
          // tabIndex={-1}：同上，「返回列表」的 hash 跳转要能落焦点。
          tabIndex={-1}
          aria-labelledby="charge-list-heading"
          className={cn(
            'admin-scroll-target min-w-0 space-y-3 focus-visible:outline-none xl:order-1',
            selectedItem && 'max-xl:hidden',
          )}
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
          ) : filters.query || activeAdvancedFilterCount(filters) > 0 ? (
            <EmptyState
              kind="no-result"
              noun="收费项目"
              onClear={
                <PriceWorkspaceLink
                  href={clearFiltersHref}
                  prefetch={false}
                  className={cn(
                    buttonVariants({ variant: 'outline' }),
                    'min-h-11',
                  )}
                >
                  清除条件
                </PriceWorkspaceLink>
              }
            />
          ) : (
            <EmptyState kind="no-data" noun="收费项目" />
          )}

          <Pagination pagination={pagination} />
        </section>

      </div>
      </div>
    </PriceWorkspaceNavigationGuardProvider>
  );
}
