import type { ReactNode } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Filter,
  Search,
  X,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Disclosure, DisclosureSummary } from '@/components/ui/disclosure';
import { Input } from '@/components/ui/input';
import { Table } from '@/components/ui/table';
import { EmptyState } from '@/components/ui-business';
import { externalPriceBusinessText } from '@/lib/price/external-price-display';
import { cn } from '@/lib/utils';
import {
  PriceWorkspaceLink,
  PriceWorkspaceNavigationGuardProvider,
} from './PriceWorkspaceNavigationGuard';
import {
  RulePriceWorkspaceStatusBand,
  type ExternalSalesChargeDraftSummary,
  type ExternalSalesChargeWorkspaceStatus,
} from './RulePriceWorkspaceStatusBand';

export type ExternalSalesChargePurpose = 'processing' | 'logistics';

export type ExternalSalesChargeWorkspaceItem = {
  id: string;
  name: string;
  categoryKey?: string;
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

export type ExternalSalesChargeWorkspaceProps = {
  purpose: ExternalSalesChargePurpose;
  workspaceStatus?: ExternalSalesChargeWorkspaceStatus;
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
  paneTitle?: string;
  paneDescription?: string;
  basisLabel?: string;
  pagination: {
    page: number;
    pageCount: number;
    total: number;
    previousHref?: string | null;
    nextHref?: string | null;
  };
};

export type RulePriceWorkspaceFrameProps = Pick<
  ExternalSalesChargeWorkspaceProps,
  | 'purpose'
  | 'workspaceStatus'
  | 'draft'
  | 'createDraftHref'
  | 'createDraftEditor'
  | 'createDraftOpen'
  | 'createDraftBlockedReason'
  | 'paneTitle'
  | 'paneDescription'
  | 'basisLabel'
> & {
  children: ReactNode;
};

const selectClass =
  'min-h-11 w-full min-w-0 rounded-lg border border-input bg-background px-2.5 py-1 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm';

function optionLabel(option: ExternalSalesChargeFilterOption): string {
  const businessLabel = externalPriceBusinessText(option.label);
  return option.count === undefined
    ? businessLabel
    : `${businessLabel}（${option.count}）`;
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

type WorkspaceFilterKey = keyof ExternalSalesChargeWorkspaceFilters;

type FilterProps = Pick<
  ExternalSalesChargeWorkspaceProps,
  | 'purpose'
  | 'searchAction'
  | 'hiddenSearchFields'
  | 'filters'
  | 'filterOptions'
  | 'clearFiltersHref'
  | 'changedFilterAvailable'
>;

function filterHref(props: FilterProps, omitted: WorkspaceFilterKey): string {
  const [actionWithoutHash = ''] = props.searchAction.split('#');
  const [pathname = '', existingQuery = ''] = actionWithoutHash.split('?');
  const params = new URLSearchParams(existingQuery);
  Object.entries(props.hiddenSearchFields ?? {}).forEach(([name, value]) => {
    params.set(name, value);
  });
  const values: ReadonlyArray<
    readonly [WorkspaceFilterKey, string, string]
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
  for (const [key, queryName, value] of values) {
    if (key === omitted || !value) params.delete(queryName);
    else params.set(queryName, value);
  }
  const query = params.toString();
  return `${pathname}${query ? `?${query}` : ''}`;
}

function activeFilterLabels(props: FilterProps) {
  const option = (
    options: ExternalSalesChargeFilterOption[],
    value: string,
  ) => options.find((entry) => entry.value === value)?.label ?? '未识别选项';
  return [
    props.filters.query
      ? { key: 'query' as const, label: `搜索：${props.filters.query}` }
      : null,
    props.filters.category
      ? {
          key: 'category' as const,
          label: `类目：${option(
            props.filterOptions.categories,
            props.filters.category,
          )}`,
        }
      : null,
    props.filters.subject
      ? {
          key: 'subject' as const,
          label: `${props.purpose === 'processing' ? '产品' : '地区'}：${option(
            props.filterOptions.subjects,
            props.filters.subject,
          )}`,
        }
      : null,
    props.filters.kind
      ? {
          key: 'kind' as const,
          label: `类型：${
            {
              BASE: '基础价',
              ADD_ON: '附加费',
              REFERENCE: '人工参考',
            }[props.filters.kind]
          }`,
        }
      : null,
    props.filters.calculation
      ? {
          key: 'calculation' as const,
          label: `计价：${option(
            props.filterOptions.calculations,
            props.filters.calculation,
          )}`,
        }
      : null,
    props.filters.quantity
      ? {
          key: 'quantity' as const,
          label: `数量：${props.filters.quantity}`,
        }
      : null,
    props.filters.automation
      ? {
          key: 'automation' as const,
          label: `处理：${
            props.filters.automation === 'AUTO' ? '自动计价' : '需人工确认'
          }`,
        }
      : null,
    props.filters.status
      ? {
          key: 'status' as const,
          label: `状态：${
            props.filters.status === 'ACTIVE' ? '已启用' : '已停用'
          }`,
        }
      : null,
    props.filters.changedOnly
      ? { key: 'changedOnly' as const, label: '只看本次修改' }
      : null,
  ].filter(
    (entry): entry is { key: WorkspaceFilterKey; label: string } =>
      entry !== null,
  );
}

function WorkspaceFilters(props: FilterProps) {
  const advancedCount = activeAdvancedFilterCount(props.filters);
  const activeFilters = activeFilterLabels(props);
  const filterStateKey = JSON.stringify({
    purpose: props.purpose,
    hidden: props.hiddenSearchFields,
    filters: props.filters,
  });

  return (
    <form
      key={filterStateKey}
      action={props.searchAction}
      method="get"
      role="search"
      aria-label="查找收费项目"
      className="min-w-0 rounded-xl border bg-card p-3 shadow-sm"
    >
      {Object.entries(props.hiddenSearchFields ?? {}).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
        <label htmlFor="rule-price-search" className="sr-only">
          搜索收费项目
        </label>
        <div className="relative min-w-0 flex-1">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            id="rule-price-search"
            name="q"
            className="min-h-11 pl-9"
            defaultValue={props.filters.query}
            placeholder={`搜索项目、类目或${
              props.purpose === 'processing' ? '产品' : '地区'
            }`}
            maxLength={120}
          />
        </div>
        <Button type="submit" className="min-h-11 shrink-0">
          定位
        </Button>
      </div>

      <Disclosure className="mt-2 min-w-0" open={advancedCount > 0}>
        <DisclosureSummary className="gap-2 px-2">
          <Filter aria-hidden="true" className="size-4" />
          筛选定位
          {advancedCount > 0 ? (
            <Badge variant="secondary">{advancedCount} 项</Badge>
          ) : null}
        </DisclosureSummary>
        <div className="grid min-w-0 gap-3 border-t pt-3 sm:grid-cols-2 xl:grid-cols-3">
          <FilterSelect
            label="收费类目"
            name="category"
            value={props.filters.category}
            emptyLabel="全部类目"
            options={props.filterOptions.categories}
          />
          <FilterSelect
            label={props.purpose === 'processing' ? '适用产品' : '适用地区'}
            name="subject"
            value={props.filters.subject}
            emptyLabel={`全部${props.purpose === 'processing' ? '产品' : '地区'}`}
            options={props.filterOptions.subjects}
          />
          <FilterSelect
            label="收费类型"
            name="kind"
            value={props.filters.kind}
            emptyLabel="全部收费类型"
            options={[
              { value: 'BASE', label: '基础价' },
              { value: 'ADD_ON', label: '附加费' },
              { value: 'REFERENCE', label: '人工参考' },
            ]}
          />
          <FilterSelect
            label="计价方式"
            name="calculation"
            value={props.filters.calculation}
            emptyLabel="全部计价方式"
            options={props.filterOptions.calculations}
          />
          <label className="min-w-0 space-y-1.5 text-sm font-medium">
            <span>适用数量</span>
            <Input
              name="quantity"
              type="number"
              inputMode="numeric"
              min={1}
              max={9_999_999}
              step={1}
              className="min-h-11"
              defaultValue={props.filters.quantity}
              placeholder="例如：1000"
            />
          </label>
          <FilterSelect
            label="处理方式"
            name="automation"
            value={props.filters.automation}
            emptyLabel="全部处理方式"
            options={[
              { value: 'AUTO', label: '自动计价' },
              { value: 'MANUAL', label: '需人工确认' },
            ]}
          />
          <FilterSelect
            label="启用状态"
            name="status"
            value={props.filters.status}
            emptyLabel="全部状态"
            options={[
              { value: 'ACTIVE', label: '已启用' },
              { value: 'INACTIVE', label: '已停用' },
            ]}
          />
          {props.changedFilterAvailable ? (
            <label className="flex min-h-11 min-w-0 items-center gap-3 self-end rounded-lg border bg-background px-3 text-sm font-medium">
              <input
                type="checkbox"
                name="changed"
                value="1"
                defaultChecked={props.filters.changedOnly}
                className="size-4 shrink-0 accent-primary"
              />
              只看本次修改
            </label>
          ) : null}
          <Button type="submit" variant="secondary" className="min-h-11">
            应用筛选
          </Button>
        </div>
      </Disclosure>

      {activeFilters.length > 0 ? (
        <div
          aria-label="已启用的收费项目筛选"
          className="mt-2 flex min-w-0 flex-nowrap items-center gap-2 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-visible"
        >
          {activeFilters.map(({ key, label }) => (
            <PriceWorkspaceLink
              key={key}
              href={filterHref(props, key)}
              prefetch={false}
              aria-label={`清除筛选：${label}`}
              className="inline-flex min-h-9 shrink-0 items-center gap-1 rounded-full border bg-background px-2.5 text-xs"
            >
              {label}
              <X aria-hidden="true" className="size-3" />
            </PriceWorkspaceLink>
          ))}
          <PriceWorkspaceLink
            href={props.clearFiltersHref}
            prefetch={false}
            className="inline-flex min-h-9 shrink-0 items-center px-2 text-xs text-muted-foreground underline"
          >
            清除全部
          </PriceWorkspaceLink>
        </div>
      ) : null}
    </form>
  );
}

function FilterSelect({
  label,
  name,
  value,
  emptyLabel,
  options,
}: {
  label: string;
  name: string;
  value: string;
  emptyLabel: string;
  options: ExternalSalesChargeFilterOption[];
}) {
  return (
    <label className="min-w-0 space-y-1.5 text-sm font-medium">
      <span>{label}</span>
      <select name={name} className={selectClass} defaultValue={value}>
        <option value="">{emptyLabel}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {optionLabel(option)}
          </option>
        ))}
      </select>
    </label>
  );
}

function WorkbenchHeader({
  purpose,
  title,
  description,
  basisLabel,
}: {
  purpose: ExternalSalesChargePurpose;
  title?: string;
  description?: string;
  basisLabel?: string;
}) {
  return (
    <header className="min-w-0 pb-1">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <h1 className="admin-wrap-anywhere text-xl font-extrabold tracking-tight">
          {title ??
            (purpose === 'processing'
              ? '客户加工费规则'
              : '包装、纸箱与快递规则')}
        </h1>
        {basisLabel ? (
          <span className="inline-flex min-h-6 items-center rounded-md border border-foreground px-2 text-[10.5px] font-extrabold tracking-wide">
            {basisLabel}
          </span>
        ) : null}
      </div>
      <p className="admin-wrap-anywhere mt-1.5 max-w-3xl text-sm leading-6 text-muted-foreground">
        {description ??
          (purpose === 'processing'
            ? '直接查看每个收费项的当前价、数量档与草稿价。'
            : '物流规则保持独立版本，与加工费分开审阅和发布。')}
      </p>
    </header>
  );
}

function tierSummary(item: ExternalSalesChargeWorkspaceItem) {
  const tiers = item.priceTiers;
  const count = tiers?.length ?? 1;
  const changedCount = tiers
    ? tiers.filter((tier) => tier.changed).length
    : item.changed
      ? 1
      : 0;
  return {
    count,
    changedCount,
    label: count > 1 ? `${count} 档 · ${item.quantityLabel}` : item.quantityLabel,
  };
}

function TierPreview({
  item,
  hasDraft,
}: {
  item: ExternalSalesChargeWorkspaceItem;
  hasDraft: boolean;
}) {
  if (!item.priceTiers?.length) return null;
  return (
    <div className="overflow-hidden rounded-lg border bg-background">
      <Table
        label={`${externalPriceBusinessText(item.name)}价格阶梯`}
        className="w-full min-w-[34rem] border-collapse text-sm"
      >
        <thead>
          <tr className="border-b bg-muted/30 text-left text-[11px] font-bold tracking-wide text-muted-foreground">
            <th className="px-3 py-2">数量档</th>
            <th className="px-3 py-2 text-right">当前价</th>
            {hasDraft ? (
              <th className="px-3 py-2 text-right">草稿价</th>
            ) : null}
            <th className="px-3 py-2 text-right">变化</th>
          </tr>
        </thead>
        <tbody>
          {item.priceTiers.map((tier) => (
            <tr
              key={tier.quantityLabel}
              className={cn(
                'border-b last:border-0',
                tier.changed && 'bg-warning/10',
              )}
            >
              <td className="px-3 py-2 font-sans tabular-nums">
                {tier.quantityLabel}
              </td>
              <td className="px-3 py-2 text-right font-sans font-medium tabular-nums">
                {tier.currentAmountLabel}
              </td>
              {hasDraft ? (
                <td className="px-3 py-2 text-right font-sans font-medium tabular-nums">
                  {tier.draftAmountLabel ?? '— 转人工'}
                </td>
              ) : null}
              <td className="px-3 py-2 text-right text-xs">
                {tier.changed ? '已调整' : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}

function SelectedInlineDetail({
  item,
  editor,
  hasDraft,
}: {
  item: ExternalSalesChargeWorkspaceItem;
  editor?: ReactNode;
  hasDraft: boolean;
}) {
  const listHref = externalSalesChargeListHref(item.detailHref);
  return (
    <section
      id="selected-charge-detail"
      tabIndex={-1}
      aria-labelledby="selected-charge-heading"
      className="admin-scroll-target min-w-0 space-y-4 rounded-xl border bg-muted/15 p-4 focus-visible:outline-none"
    >
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10.5px] font-extrabold tracking-[0.15em] text-muted-foreground uppercase">
            {editor ? '直接编辑' : '规则详情'}
          </div>
          <h2
            id="selected-charge-heading"
            className="admin-wrap-anywhere mt-1 text-lg font-bold"
          >
            {externalPriceBusinessText(item.name)}
          </h2>
        </div>
        <PriceWorkspaceLink
          href={listHref}
          prefetch={false}
          className={cn(
            buttonVariants({ variant: 'ghost', size: 'sm' }),
            'min-h-11',
          )}
        >
          <ChevronLeft aria-hidden="true" />
          收起详情
        </PriceWorkspaceLink>
      </div>

      <dl className="grid min-w-0 gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-xs text-muted-foreground">适用范围</dt>
          <dd className="admin-wrap-anywhere mt-1">
            {externalPriceBusinessText(item.subjectLabel)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">数量范围</dt>
          <dd className="mt-1">{item.quantityLabel}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">计价方式</dt>
          <dd className="mt-1">{item.calculationLabel}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">当前价</dt>
          <dd className="mt-1 font-sans font-semibold tabular-nums">
            {item.currentAmountLabel}
          </dd>
        </div>
      </dl>

      {hasDraft ? (
        <dl
          aria-label={`${externalPriceBusinessText(item.name)}价格对比`}
          className="grid min-w-0 gap-3 rounded-lg border bg-background p-3 text-sm sm:grid-cols-3"
        >
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">当前</dt>
            <dd className="admin-wrap-anywhere mt-1 font-sans font-semibold tabular-nums">
              {item.currentAmountLabel}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">草稿</dt>
            <dd className="admin-wrap-anywhere mt-1 font-sans font-semibold tabular-nums">
              {item.draftAmountLabel ??
                (item.automation === 'MANUAL' ? '人工确认' : '— 转人工')}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">变化</dt>
            <dd
              className={cn(
                'admin-wrap-anywhere mt-1 font-sans font-semibold tabular-nums',
                item.changed && 'text-warning-foreground',
              )}
            >
              {item.changed ? (item.priceChangeLabel ?? '已调整') : '无变更'}
            </dd>
          </div>
        </dl>
      ) : null}

      {item.changeSummaryLabels?.length ? (
        <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
          <p className="font-semibold">其他业务变更</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-muted-foreground">
            {item.changeSummaryLabels.map((label) => (
              <li key={label}>{label}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {!editor ? <TierPreview item={item} hasDraft={hasDraft} /> : null}
      {editor ? (
        <div aria-label="编辑收费项目" className="min-w-0">
          {editor}
        </div>
      ) : hasDraft ? (
        <p className="rounded-lg border bg-background p-3 text-sm text-muted-foreground">
          该项目不在当前调价草稿内，只能查看生效价。
        </p>
      ) : null}
    </section>
  );
}

function PriceMatrix({
  items,
  selectedItem,
  selectedEditor,
  hasDraft,
  total,
  clearFiltersHref,
  hasFilters,
}: {
  items: ExternalSalesChargeWorkspaceItem[];
  selectedItem?: ExternalSalesChargeWorkspaceItem;
  selectedEditor?: ReactNode;
  hasDraft: boolean;
  total: number;
  clearFiltersHref: string;
  hasFilters: boolean;
}) {
  const visibleItems =
    selectedItem && !items.some((item) => item.id === selectedItem.id)
      ? [selectedItem, ...items]
      : items;

  if (visibleItems.length === 0) {
    return hasFilters ? (
      <EmptyState
        kind="no-result"
        noun="收费项目"
        onClear={
          <PriceWorkspaceLink
            href={clearFiltersHref}
            prefetch={false}
            className={buttonVariants({ variant: 'outline' })}
          >
            清除条件
          </PriceWorkspaceLink>
        }
      />
    ) : (
      <EmptyState kind="no-data" noun="收费项目" />
    );
  }

  return (
    <section aria-labelledby="rule-price-matrix-heading" className="min-w-0">
      <div className="mb-2 flex min-w-0 flex-wrap items-baseline justify-between gap-2">
        <h2 id="rule-price-matrix-heading" className="text-sm font-bold">
          价格规则矩阵
        </h2>
        <p className="font-sans text-xs tabular-nums text-muted-foreground">
          {Math.max(total, visibleItems.length).toLocaleString('zh-CN')} 个业务项
        </p>
      </div>
      <div
        className="min-w-0 overflow-x-auto rounded-xl border bg-card shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        role="region"
        aria-label="客户计价规则矩阵"
        tabIndex={0}
      >
        <table className="w-full min-w-[58rem] border-collapse text-sm">
          <thead>
            <tr className="border-b-2 border-foreground bg-muted/20 text-left text-[11px] font-extrabold tracking-wide text-muted-foreground">
              <th className="px-3 py-2.5">收费项目</th>
              <th className="px-3 py-2.5">适用范围</th>
              <th className="px-3 py-2.5">数量与档位</th>
              <th className="px-3 py-2.5 text-right">当前价</th>
              {hasDraft ? (
                <th className="px-3 py-2.5 text-right">草稿价</th>
              ) : null}
              <th className="px-3 py-2.5">状态</th>
              <th className="w-24 px-3 py-2.5 text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {visibleItems.map((item) => {
              const selected = item.id === selectedItem?.id;
              const summary = tierSummary(item);
              const action = hasDraft ? '编辑' : '查看';
              return (
                <RuleRows
                  key={item.id}
                  item={item}
                  selected={selected}
                  hasDraft={hasDraft}
                  summary={summary}
                  action={action}
                />
              );
            })}
          </tbody>
        </table>
      </div>
      {selectedItem ? (
        <div className="mt-3 min-w-0">
          <SelectedInlineDetail
            item={selectedItem}
            editor={selectedEditor}
            hasDraft={hasDraft}
          />
        </div>
      ) : null}
    </section>
  );
}

function RuleRows({
  item,
  selected,
  hasDraft,
  summary,
  action,
}: {
  item: ExternalSalesChargeWorkspaceItem;
  selected: boolean;
  hasDraft: boolean;
  summary: ReturnType<typeof tierSummary>;
  action: string;
}) {
  return (
    <tr
      className={cn(
        'border-b align-top transition-colors last:border-0',
        item.changed && 'bg-warning/10',
        selected && 'bg-primary/5',
      )}
    >
        <td className="px-3 py-3">
          <div className="flex min-w-0 items-start gap-2">
            {item.changed ? (
              <span
                role="img"
                aria-label="本次已修改"
                className="mt-1.5 size-2 shrink-0 rounded-full bg-warning"
              />
            ) : null}
            <div className="min-w-0">
              <p className="admin-wrap-anywhere font-semibold">
                {externalPriceBusinessText(item.name)}
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {externalPriceBusinessText(item.categoryLabel)} ·{' '}
                {item.calculationLabel}
              </p>
            </div>
          </div>
        </td>
        <td className="admin-wrap-anywhere max-w-64 px-3 py-3 text-xs leading-5 text-muted-foreground">
          {externalPriceBusinessText(item.subjectLabel)}
        </td>
        <td className="px-3 py-3">
          <p className="font-sans text-xs tabular-nums">{summary.label}</p>
          {hasDraft && summary.changedCount > 0 ? (
            <p className="mt-1 text-[11px] font-semibold text-warning-foreground">
              {summary.changedCount}/{summary.count} 档已调整
            </p>
          ) : null}
        </td>
        <td className="px-3 py-3 text-right font-sans font-semibold tabular-nums">
          {item.currentAmountLabel}
        </td>
        {hasDraft ? (
          <td
            className={cn(
              'px-3 py-3 text-right font-sans font-semibold tabular-nums',
              item.changed && 'text-warning-foreground',
            )}
          >
            {item.draftAmountLabel ??
              (item.automation === 'MANUAL' ? '人工确认' : '— 转人工')}
          </td>
        ) : null}
        <td className="px-3 py-3">
          <div className="flex flex-col items-start gap-1">
            <Badge variant="outline">
              {item.statusLabel ??
                (item.status === 'ACTIVE' ? '已启用' : '已停用')}
            </Badge>
            {item.automation === 'MANUAL' ? (
              <span className="text-[11px] text-muted-foreground">需人工确认</span>
            ) : null}
          </div>
        </td>
        <td className="px-3 py-3 text-right">
          <PriceWorkspaceLink
            href={item.detailHref}
            prefetch={false}
            aria-current={selected ? 'page' : undefined}
            aria-label={`${selected ? `正在${action}` : action}收费项目：${externalPriceBusinessText(item.name)}`}
            className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-primary underline underline-offset-4"
          >
            {selected ? `正在${action}` : action}
            <ChevronRight aria-hidden="true" className="size-4" />
          </PriceWorkspaceLink>
        </td>
    </tr>
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
        第 {pagination.page} / {pagination.pageCount} 页，共{' '}
        {pagination.total} 项
      </p>
      <div className="flex gap-2">
        {pagination.previousHref ? (
          <PriceWorkspaceLink
            href={pagination.previousHref}
            prefetch={false}
            className={cn(
              buttonVariants({ variant: 'outline' }),
              'min-h-11',
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
              'min-h-11 opacity-50',
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
              'min-h-11',
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
              'min-h-11 opacity-50',
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
  if (detailHref.trim().startsWith('#')) return '#rule-price-matrix-heading';
  try {
    const url = new URL(detailHref, 'https://price-workspace.local');
    url.searchParams.delete('item');
    url.hash = 'rule-price-matrix-heading';
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return '#rule-price-matrix-heading';
  }
}

export function RulePriceWorkbench({
  purpose,
  workspaceStatus = 'CURRENT',
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
  paneTitle,
  paneDescription,
  basisLabel,
  pagination,
}: ExternalSalesChargeWorkspaceProps) {
  const selectedItem =
    selectedItemProp ?? items.find((item) => item.id === selectedItemId);
  const hasFilters = Boolean(filters.query) || activeAdvancedFilterCount(filters) > 0;

  return (
    <RulePriceWorkspaceFrame
      purpose={purpose}
      workspaceStatus={workspaceStatus}
      draft={draft}
      createDraftHref={createDraftHref}
      createDraftEditor={createDraftEditor}
      createDraftOpen={createDraftOpen}
      createDraftBlockedReason={createDraftBlockedReason}
      paneTitle={paneTitle}
      paneDescription={paneDescription}
      basisLabel={basisLabel}
    >
        <WorkspaceFilters
          purpose={purpose}
          searchAction={searchAction}
          hiddenSearchFields={hiddenSearchFields}
          filters={filters}
          filterOptions={filterOptions}
          clearFiltersHref={clearFiltersHref}
          changedFilterAvailable={changedFilterAvailable}
        />
        <PriceMatrix
          items={items}
          selectedItem={selectedItem}
          selectedEditor={selectedEditor}
          hasDraft={Boolean(draft)}
          total={pagination.total}
          clearFiltersHref={clearFiltersHref}
          hasFilters={hasFilters}
        />
        <Pagination pagination={pagination} />
    </RulePriceWorkspaceFrame>
  );
}

/**
 * Shared version/draft shell for both the generic fallback matrix and the
 * dedicated business editors. Keeping this shell common prevents the six
 * rule pages from drifting away from the same review and publish workflow.
 */
export function RulePriceWorkspaceFrame({
  purpose,
  workspaceStatus = 'CURRENT',
  draft,
  createDraftHref,
  createDraftEditor,
  createDraftOpen,
  createDraftBlockedReason,
  paneTitle,
  paneDescription,
  basisLabel,
  children,
}: RulePriceWorkspaceFrameProps) {
  return (
    <PriceWorkspaceNavigationGuardProvider>
      <div
        data-slot="rule-price-workbench"
        className="min-w-0 space-y-4"
      >
        <WorkbenchHeader
          purpose={purpose}
          title={paneTitle}
          description={paneDescription}
          basisLabel={basisLabel}
        />
        <RulePriceWorkspaceStatusBand
          draft={draft}
          workspaceStatus={workspaceStatus}
          createDraftHref={createDraftHref}
          createDraftEditor={createDraftEditor}
          createDraftOpen={createDraftOpen}
          createDraftBlockedReason={createDraftBlockedReason}
        />
        {children}
      </div>
    </PriceWorkspaceNavigationGuardProvider>
  );
}
