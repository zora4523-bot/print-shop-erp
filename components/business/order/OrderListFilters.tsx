import Link from 'next/link';
import type { ReactNode } from 'react';
import { ChevronDown, Search, SlidersHorizontal, X } from 'lucide-react';
import { OrderStatus } from '@/generated/prisma/enums';
import { MACHINE_TYPE_LABELS } from '@/lib/auth/role-labels';
import { buildTableHref, type TableHrefParams } from '@/lib/admin/table';
import { encodeFoilColorFilterValues } from '@/lib/order/foil-color-filter-codec';
import type {
  OrderFilterOption,
  OrderListFilterOptions,
  OrderListQuery,
} from '@/lib/order/list-query';
import { cn } from '@/lib/utils';
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
import { orderStatusLabel } from './OrderStatusBadge';
import { OrderSavedViews } from './OrderSavedViews';
import { OrderAdvancedFilters } from './OrderAdvancedFilters';
import { todayShanghai } from '@/lib/dashboard/shanghai-clock';
import {
  OUTSOURCE_STATUS_REGISTRY,
  PRODUCTION_TASK_STATUS_REGISTRY,
  SHIPMENT_STATUS_REGISTRY,
  statusFilterLabel,
} from '@/lib/ui/status-registry';
import {
  CheckboxGroup,
  DateField,
  fieldLabelClass,
  OptionSelect,
  ORDER_KIND_LABELS,
  TriStateSelect,
} from './OrderListFilterFields';

export const ADVANCED_FILTER_KEYS = [
  'orderNo',
  'customName',
  'customerRef',
  'kind',
  'receiverName',
  'receiverPhone',
  'receiverAddress',
  'isSfCollect',
  'addressMode',
  'trackingNo',
  'expressCode',
  'shipmentStatus',
  'amountMin',
  'amountMax',
  'promisedFrom',
  'promisedTo',
  'itemName',
  'productName',
  'specification',
  'paperType',
  'quantityMin',
  'quantityMax',
  'foilColor',
  'craftId',
  'taskStatus',
  'machineType',
  'requiresOutsource',
  'supplierName',
  'outsourceStatus',
] as const;

type FilterChip = {
  id: string;
  label: string;
  href: string;
};

type OrderFilterFormProps = {
  idPrefix: string;
  filterStateKey: string;
  effectiveQuery: OrderListQuery;
  options: OrderListFilterOptions;
  issues: readonly string[];
  chips: readonly FilterChip[];
  clearAllHref: string;
  showCommercialAmounts: boolean;
  hasAdvancedFilters: boolean;
  advancedRequested: boolean;
  mobile?: boolean;
};

export function OrderListFilters({
  query,
  options,
  issues,
  total,
  exportControls,
  showCommercialAmounts = true,
  advancedRequested = false,
  canReviewChanges = false,
}: {
  query: OrderListQuery;
  options: OrderListFilterOptions;
  issues: readonly string[];
  total: number;
  exportControls?: ReactNode;
  showCommercialAmounts?: boolean;
  advancedRequested?: boolean;
  canReviewChanges?: boolean;
}) {
  const effectiveQuery =
    !showCommercialAmounts &&
    (query.filters.amountMin !== undefined ||
      query.filters.amountMax !== undefined ||
      query.sort === 'totalAmount')
      ? {
          ...query,
          filters: {
            ...query.filters,
            amountMin: undefined,
            amountMax: undefined,
          },
          sort: query.sort === 'totalAmount' ? ('createdAt' as const) : query.sort,
          dir: query.sort === 'totalAmount' ? ('desc' as const) : query.dir,
        }
      : query;
  const params = orderListParams(effectiveQuery, showCommercialAmounts);
  const filterStateKey = buildTableHref('/orders', {}, params);
  const chips = activeFilterChips(effectiveQuery, options, params);
  const hasAdvancedFilters = ADVANCED_FILTER_KEYS.some((key) => {
    const value = params[key];
    return value !== undefined && value !== null && value !== '';
  });
  const clearAllHref = buildTableHref(
    '/orders',
    {},
    {
      pageSize: effectiveQuery.pageSize,
      sort: effectiveQuery.sort,
      dir: effectiveQuery.dir,
    },
  );
  const today = todayShanghai();
  const savedViewHref = buildTableHref('/orders', {}, {
    ...params,
    view: 'saved',
  });
  const fixedViews = [
    {
      id: 'urgent',
      label: '我的急单',
      href: buildTableHref('/orders', {}, {
        view: 'urgent',
        isUrgent: 'yes',
      }),
    },
    {
      id: 'due-today',
      label: '今天要发',
      href: buildTableHref('/orders', {}, {
        view: 'due-today',
        promisedFrom: today,
        promisedTo: today,
      }),
    },
    {
      id: 'scheduling',
      label: '待排产',
      href: buildTableHref('/orders', {}, {
        view: 'scheduling',
        status: OrderStatus.SUBMITTED,
      }),
    },
  ] as const;

  return (
    <section
      aria-labelledby="order-list-filter-heading"
      className="min-w-0 space-y-3 rounded-xl border bg-card p-3 shadow-sm sm:p-4"
    >
      <div className="flex min-w-0 items-center gap-2 overflow-x-auto pb-1">
        <span className="shrink-0 text-xs text-muted-foreground">视图</span>
        <nav aria-label="常用工单视图" className="flex shrink-0 items-center gap-2">
          {fixedViews.map((view) => {
            const active = effectiveQuery.view === view.id;
            return (
              <Link
                key={view.id}
                href={view.href}
                prefetch={false}
                aria-label={`切换视图：${view.label}`}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  buttonVariants({
                    variant: active ? 'secondary' : 'outline',
                    size: 'sm',
                  }),
                  'min-h-11 rounded-full sm:min-h-8',
                )}
              >
                {view.label}
              </Link>
            );
          })}
          {canReviewChanges ? (
            <Link
              href="/owner/order-changes"
              prefetch={false}
              aria-label="打开待审核修改"
              className={cn(
                buttonVariants({ variant: 'outline', size: 'sm' }),
                'min-h-11 rounded-full sm:min-h-8',
              )}
            >
              待审核修改
            </Link>
          ) : null}
        </nav>
        <OrderSavedViews currentHref={savedViewHref} />
      </div>
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 id="order-list-filter-heading" className="font-semibold">
            筛选工单
          </h2>
          <p className="text-sm text-muted-foreground" aria-live="polite">
            共找到 <span className="font-sans tabular-nums">{total}</span> 条工单
          </p>
        </div>
        <div className="flex min-w-0 flex-wrap gap-2 sm:shrink-0 sm:justify-end">
          {exportControls}
          <Sheet>
            <SheetTrigger
              render={
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11 sm:hidden"
                  aria-label={
                    chips.length > 0
                      ? `打开筛选条件，已启用 ${chips.length} 项`
                      : '打开筛选条件'
                  }
                />
              }
            >
              <SlidersHorizontal aria-hidden="true" />
              筛选
              {chips.length > 0 ? (
                <span
                  aria-hidden="true"
                  className="inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-xs text-primary-foreground"
                >
                  {chips.length}
                </span>
              ) : null}
            </SheetTrigger>
            <SheetContent
              side="bottom"
              className="max-h-[80dvh] min-w-0 rounded-t-2xl sm:hidden"
            >
              <SheetHeader className="shrink-0 border-b pr-14">
                <SheetTitle className="flex items-center gap-2">
                  <SlidersHorizontal aria-hidden="true" className="size-4" />
                  筛选工单
                </SheetTitle>
                <SheetDescription>
                  已启用 {chips.length} 项；应用后返回工单列表。
                </SheetDescription>
              </SheetHeader>
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4">
                {renderOrderFilterForm({
                  idPrefix: 'mobile-',
                  filterStateKey,
                  effectiveQuery,
                  options,
                  issues,
                  chips,
                  clearAllHref,
                  showCommercialAmounts,
                  hasAdvancedFilters,
                  advancedRequested,
                  mobile: true,
                })}
              </div>
            </SheetContent>
          </Sheet>
          {chips.length > 0 ? (
            <Link
              href={clearAllHref}
              prefetch={false}
              aria-label="清除全部筛选"
              className={cn(
                buttonVariants({ variant: 'outline' }),
                'min-h-11 sm:min-h-8',
              )}
            >
              清除全部筛选
            </Link>
          ) : null}
        </div>
      </div>

      {issues.length > 0 ? (
        <div
          role="alert"
          className="admin-wrap-anywhere min-w-0 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          <p className="font-medium">部分筛选条件无效，已忽略：</p>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {issues.map((issue, index) => (
              <li key={`${issue}-${index}`} className="min-w-0">
                {issue}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {chips.length > 0 ? (
        <div
          aria-label="已启用的筛选条件"
          className="flex min-w-0 flex-nowrap gap-2 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-visible sm:pb-0"
        >
          {chips.map((chip) => (
            <Link
              key={chip.id}
              href={chip.href}
              prefetch={false}
              aria-label={`清除筛选：${chip.label}`}
              className={cn(
                buttonVariants({ variant: 'outline', size: 'sm' }),
                'h-auto min-h-11 max-w-[85vw] shrink-0 whitespace-normal py-1 text-left sm:max-w-full sm:min-h-7',
              )}
            >
              <span className="admin-wrap-anywhere min-w-0">{chip.label}</span>
              <X aria-hidden="true" />
            </Link>
          ))}
        </div>
      ) : null}

      <div className="hidden sm:block">
        <Disclosure
          id="order-list-filter-controls"
          className="group min-w-0 rounded-lg border border-dashed border-border p-3"
          open={issues.length > 0 || advancedRequested || undefined}
        >
          <DisclosureSummary className="justify-between gap-3">
            <span className="flex min-w-0 items-center gap-2">
              <SlidersHorizontal
                aria-hidden="true"
                className="size-4 shrink-0 text-muted-foreground"
              />
              <span>筛选条件</span>
            </span>
            <span className="flex shrink-0 items-center gap-2">
              {issues.length > 0 ? (
                <span className="text-xs text-destructive">需要修正</span>
              ) : chips.length > 0 ? (
                <span className="text-xs text-muted-foreground">
                  {chips.length} 项已启用
                </span>
              ) : null}
              <ChevronDown
                aria-hidden="true"
                className="size-4 text-muted-foreground transition-transform group-open:rotate-180"
              />
            </span>
          </DisclosureSummary>
          {renderOrderFilterForm({
            idPrefix: '',
            filterStateKey,
            effectiveQuery,
            options,
            issues,
            chips,
            clearAllHref,
            showCommercialAmounts,
            hasAdvancedFilters,
            advancedRequested,
          })}
        </Disclosure>
      </div>
    </section>
  );
}

function renderOrderFilterForm({
  idPrefix,
  filterStateKey,
  effectiveQuery,
  options,
  issues,
  chips,
  clearAllHref,
  showCommercialAmounts,
  hasAdvancedFilters,
  advancedRequested,
  mobile = false,
}: OrderFilterFormProps) {
  const filters = effectiveQuery.filters;
  const controlId = (suffix: string) => `${idPrefix}order-filter-${suffix}`;

  return (
    <form
      key={`${idPrefix}${filterStateKey}`}
      action="/orders"
      method="get"
      className={cn(
        'min-w-0 space-y-4',
        mobile ? 'py-4' : 'mt-4 border-t pt-4',
      )}
    >
      <input type="hidden" name="pageSize" value={effectiveQuery.pageSize} />
      <input type="hidden" name="sort" value={effectiveQuery.sort} />
      <input type="hidden" name="dir" value={effectiveQuery.dir} />

      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="min-w-0 sm:col-span-2 xl:col-span-4">
          <label htmlFor={controlId('q')} className={fieldLabelClass}>
            综合搜索
          </label>
          <div className="relative min-w-0">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-2.5 top-3.5 size-4 text-muted-foreground sm:top-2"
            />
            <Input
              id={controlId('q')}
              name="q"
              defaultValue={filters.q ?? ''}
              maxLength={80}
              placeholder="工单号、名称、客户、收货信息、款式、提交人或师傅"
              className="pl-8"
            />
          </div>
        </div>

        <CheckboxGroup
          legend="工单状态"
          name="status"
          selected={filters.statuses}
          options={Object.values(OrderStatus).map((status) => ({
            id: status,
            label: orderStatusLabel(status),
          }))}
          className="sm:col-span-2 xl:col-span-4"
          idPrefix={idPrefix}
        />

        <DateField
          id={controlId('created-from')}
          name="createdFrom"
          label="创建日期从"
          value={filters.createdFrom}
        />
        <DateField
          id={controlId('created-to')}
          name="createdTo"
          label="创建日期到"
          value={filters.createdTo}
        />

        {options.submitters.length > 0 ? (
          <OptionSelect
            id={controlId('submitter')}
            name="submitterId"
            label="提交人"
            emptyLabel="全部提交人"
            value={filters.submitterId}
            options={options.submitters}
          />
        ) : null}
        {options.workers.length > 0 ? (
          <OptionSelect
            id={controlId('worker')}
            name="workerId"
            label="师傅"
            emptyLabel="全部师傅"
            value={filters.workerId}
            options={options.workers}
          />
        ) : null}

        <TriStateSelect
          id={controlId('urgent')}
          name="isUrgent"
          label="急单"
          value={filters.isUrgent}
          yesLabel="仅急单"
          noLabel="仅非急单"
        />
      </div>

      <OrderAdvancedFilters
        key={`${idPrefix}${filterStateKey}:${advancedRequested ? 'advanced' : 'default'}:${issues.length > 0 ? 'issues' : 'valid'}`}
        filters={filters}
        craftOptions={options.crafts}
        showCommercialAmounts={showCommercialAmounts}
        hasActiveFilters={hasAdvancedFilters}
        initiallyOpen={hasAdvancedFilters || advancedRequested}
        initiallyLoaded={
          hasAdvancedFilters || issues.length > 0 || advancedRequested
        }
        idPrefix={idPrefix}
      />

      <div
        className={cn(
          'flex flex-col gap-2 sm:flex-row sm:items-center',
          mobile &&
            'sticky bottom-0 -mx-4 border-t bg-popover px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom,0px))]',
        )}
      >
        <Button type="submit" className="min-h-11 sm:min-h-8">
          应用筛选
        </Button>
        {chips.length > 0 ? (
          <Link
            href={clearAllHref}
            prefetch={false}
            aria-label="清除全部筛选"
            className={cn(
              buttonVariants({ variant: 'outline' }),
              'min-h-11 sm:min-h-8',
            )}
          >
            清除全部筛选
          </Link>
        ) : null}
      </div>
    </form>
  );
}

function orderListParams(
  query: OrderListQuery,
  showCommercialAmounts: boolean,
): TableHrefParams {
  const f = query.filters;
  return {
    q: f.q,
    orderNo: f.orderNo,
    customName: f.customName,
    customerRef: f.customerRef,
    receiverName: f.receiverName,
    receiverPhone: f.receiverPhone,
    receiverAddress: f.receiverAddress,
    submitterId: f.submitterId,
    workerId: f.workerId,
    status: commaList(f.statuses),
    kind: commaList(f.kinds),
    isUrgent: booleanValue(f.isUrgent),
    isSfCollect: booleanValue(f.isSfCollect),
    addressMode: f.addressMode,
    amountMin: showCommercialAmounts ? f.amountMin : undefined,
    amountMax: showCommercialAmounts ? f.amountMax : undefined,
    createdFrom: f.createdFrom,
    createdTo: f.createdTo,
    promisedFrom: f.promisedFrom,
    promisedTo: f.promisedTo,
    trackingNo: f.trackingNo,
    expressCode: f.expressCode,
    shipmentStatus: commaList(f.shipmentStatuses),
    itemName: f.itemName,
    productName: f.productName,
    specification: f.specification,
    paperType: f.paperType,
    quantityMin: f.quantityMin,
    quantityMax: f.quantityMax,
    craftId: commaList(f.craftIds),
    foilColor: encodeFoilColorFilterValues(f.foilColors),
    taskStatus: commaList(f.taskStatuses),
    machineType: commaList(f.machineTypes),
    requiresOutsource: booleanValue(f.requiresOutsource),
    outsourceStatus: commaList(f.outsourceStatuses),
    supplierName: f.supplierName,
    pageSize: query.pageSize,
    sort: query.sort,
    dir: query.dir,
  };
}

function activeFilterChips(
  query: OrderListQuery,
  options: OrderListFilterOptions,
  params: TableHrefParams,
): FilterChip[] {
  const f = query.filters;
  const chips: FilterChip[] = [];
  const scalar = (
    key: string,
    value: string | number | boolean | undefined,
    label: string,
  ) => {
    if (value === undefined || value === '') return;
    chips.push({
      id: `${key}-${String(value)}`,
      label,
      href: clearHref(params, key),
    });
  };
  const list = <T extends string>(
    key: string,
    values: readonly T[],
    labelFor: (value: T) => string,
    encodeValues: (values: readonly T[]) => string | undefined = commaList,
  ) => {
    for (const value of values) {
      chips.push({
        id: `${key}-${value}`,
        label: labelFor(value),
        href: clearListValueHref(params, key, values, value, encodeValues),
      });
    }
  };

  scalar('q', f.q, `综合：${f.q}`);
  scalar('orderNo', f.orderNo, `工单号：${f.orderNo}`);
  scalar('customName', f.customName, `工单名称：${f.customName}`);
  scalar('customerRef', f.customerRef, `客户：${f.customerRef}`);
  scalar('receiverName', f.receiverName, `收件人：${f.receiverName}`);
  scalar('receiverPhone', f.receiverPhone, `收件电话：${f.receiverPhone}`);
  scalar('receiverAddress', f.receiverAddress, `收件地址：${f.receiverAddress}`);
  scalar(
    'submitterId',
    f.submitterId,
    `提交人：${optionLabel(options.submitters, f.submitterId)}`,
  );
  scalar(
    'workerId',
    f.workerId,
    `师傅：${optionLabel(options.workers, f.workerId)}`,
  );
  list('status', f.statuses, (value) => `状态：${orderStatusLabel(value)}`);
  list('kind', f.kinds, (value) => `类型：${ORDER_KIND_LABELS[value]}`);
  scalar('isUrgent', f.isUrgent, `急单：${yesNo(f.isUrgent)}`);
  scalar('isSfCollect', f.isSfCollect, `顺丰到付：${yesNo(f.isSfCollect)}`);
  scalar(
    'addressMode',
    f.addressMode,
    `地址：${f.addressMode === 'multiple' ? '多地址' : '单地址'}`,
  );
  if (params.amountMin !== undefined || params.amountMax !== undefined) {
    scalar('amountMin', f.amountMin, `金额 ≥ ${f.amountMin}`);
    scalar('amountMax', f.amountMax, `金额 ≤ ${f.amountMax}`);
  }
  scalar('createdFrom', f.createdFrom, `创建日期从：${f.createdFrom}`);
  scalar('createdTo', f.createdTo, `创建日期到：${f.createdTo}`);
  scalar('promisedFrom', f.promisedFrom, `交期从：${f.promisedFrom}`);
  scalar('promisedTo', f.promisedTo, `交期到：${f.promisedTo}`);
  scalar('trackingNo', f.trackingNo, `快递单号：${f.trackingNo}`);
  scalar('expressCode', f.expressCode, `快递代码：${f.expressCode}`);
  list(
    'shipmentStatus',
    f.shipmentStatuses,
    (value) =>
      `发货：${statusFilterLabel(SHIPMENT_STATUS_REGISTRY[value])}`,
  );
  scalar('itemName', f.itemName, `款式：${f.itemName}`);
  scalar('productName', f.productName, `产品：${f.productName}`);
  scalar('specification', f.specification, `规格：${f.specification}`);
  scalar('paperType', f.paperType, `纸张：${f.paperType}`);
  scalar('quantityMin', f.quantityMin, `数量 ≥ ${f.quantityMin}`);
  scalar('quantityMax', f.quantityMax, `数量 ≤ ${f.quantityMax}`);
  list('craftId', f.craftIds, (value) => `工艺：${optionLabel(options.crafts, value)}`);
  list(
    'foilColor',
    f.foilColors,
    (value) => `烫金色：${value}`,
    encodeFoilColorFilterValues,
  );
  list(
    'taskStatus',
    f.taskStatuses,
    (value) =>
      `任务：${statusFilterLabel(PRODUCTION_TASK_STATUS_REGISTRY[value])}`,
  );
  list(
    'machineType',
    f.machineTypes,
    (value) => `机器：${MACHINE_TYPE_LABELS[value]}`,
  );
  scalar(
    'requiresOutsource',
    f.requiresOutsource,
    `外协：${yesNo(f.requiresOutsource)}`,
  );
  list(
    'outsourceStatus',
    f.outsourceStatuses,
    (value) =>
      `外协状态：${statusFilterLabel(OUTSOURCE_STATUS_REGISTRY[value])}`,
  );
  scalar('supplierName', f.supplierName, `外协供应商：${f.supplierName}`);
  return chips;
}

function clearHref(params: TableHrefParams, key: string): string {
  return buildTableHref('/orders', params, { [key]: null, page: null });
}

function clearListValueHref<T extends string>(
  params: TableHrefParams,
  key: string,
  values: readonly T[],
  value: T,
  encodeValues: (values: readonly T[]) => string | undefined,
): string {
  const remaining = values.filter((candidate) => candidate !== value);
  return buildTableHref('/orders', params, {
    [key]: encodeValues(remaining),
    page: null,
  });
}

function commaList(values: readonly (string | number)[]): string | undefined {
  return values.length > 0 ? values.join(',') : undefined;
}

function booleanValue(value: boolean | undefined): string | undefined {
  return value === undefined ? undefined : value ? 'yes' : 'no';
}

function yesNo(value: boolean | undefined): string {
  return value ? '是' : '否';
}

function optionLabel(
  options: readonly OrderFilterOption[],
  id: string | undefined,
): string {
  if (!id) return '';
  return options.find((option) => option.id === id)?.label ?? id;
}
