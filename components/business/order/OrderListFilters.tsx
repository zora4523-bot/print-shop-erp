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
import { Input } from '@/components/ui/input';
import { orderStatusLabel } from './OrderStatusBadge';
import { OrderAdvancedFilters } from './OrderAdvancedFilters';
import {
  CheckboxGroup,
  DateField,
  fieldLabelClass,
  OptionSelect,
  ORDER_KIND_LABELS,
  OUTSOURCE_STATUS_LABELS,
  SHIPMENT_STATUS_LABELS,
  TASK_STATUS_LABELS,
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

export function OrderListFilters({
  query,
  options,
  issues,
  total,
  exportControls,
  showCommercialAmounts = true,
  advancedRequested = false,
}: {
  query: OrderListQuery;
  options: OrderListFilterOptions;
  issues: readonly string[];
  total: number;
  exportControls?: ReactNode;
  showCommercialAmounts?: boolean;
  advancedRequested?: boolean;
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
  const filters = effectiveQuery.filters;
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

  return (
    <section
      aria-labelledby="order-list-filter-heading"
      className="min-w-0 space-y-3 rounded-xl border bg-card p-3 shadow-sm sm:p-4"
    >
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 id="order-list-filter-heading" className="font-semibold">
            筛选工单
          </h2>
          <p className="text-sm text-muted-foreground" aria-live="polite">
            共找到 <span className="font-sans tabular-nums">{total}</span> 条工单
          </p>
        </div>
        {exportControls || chips.length > 0 ? (
          <div className="flex min-w-0 flex-wrap gap-2 sm:shrink-0 sm:justify-end">
            {exportControls}
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
        ) : null}
      </div>

      {issues.length > 0 ? (
        <div
          role="alert"
          className="admin-wrap-anywhere min-w-0 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          <p className="font-medium">部分筛选条件无效，已按安全值处理：</p>
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
        <div aria-label="已启用的筛选条件" className="flex min-w-0 flex-wrap gap-2">
          {chips.map((chip) => (
            <Link
              key={chip.id}
              href={chip.href}
              prefetch={false}
              aria-label={`清除筛选：${chip.label}`}
              className={cn(
                buttonVariants({ variant: 'outline', size: 'sm' }),
                'h-auto min-h-11 max-w-full whitespace-normal py-1 text-left sm:min-h-7',
              )}
            >
              <span className="admin-wrap-anywhere min-w-0">{chip.label}</span>
              <X aria-hidden="true" />
            </Link>
          ))}
        </div>
      ) : null}

      <details
        id="order-list-filter-controls"
        className="group min-w-0 rounded-lg border border-dashed border-border p-3"
        open={issues.length > 0 || advancedRequested || undefined}
      >
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-md text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
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
        </summary>

        <form
          key={filterStateKey}
          action="/orders"
          method="get"
          className="mt-4 min-w-0 space-y-4 border-t pt-4"
        >
          <input type="hidden" name="pageSize" value={effectiveQuery.pageSize} />
          <input type="hidden" name="sort" value={effectiveQuery.sort} />
          <input type="hidden" name="dir" value={effectiveQuery.dir} />

          <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="min-w-0 sm:col-span-2 xl:col-span-4">
            <label htmlFor="order-filter-q" className={fieldLabelClass}>
              综合搜索
            </label>
            <div className="relative min-w-0">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute left-2.5 top-2 size-4 text-muted-foreground"
              />
              <Input
                id="order-filter-q"
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
          />

          <DateField
            id="order-filter-created-from"
            name="createdFrom"
            label="创建日期从"
            value={filters.createdFrom}
          />
          <DateField
            id="order-filter-created-to"
            name="createdTo"
            label="创建日期到"
            value={filters.createdTo}
          />

          {options.submitters.length > 0 ? (
            <OptionSelect
              id="order-filter-submitter"
              name="submitterId"
              label="提交人"
              emptyLabel="全部提交人"
              value={filters.submitterId}
              options={options.submitters}
            />
          ) : null}
          {options.workers.length > 0 ? (
            <OptionSelect
              id="order-filter-worker"
              name="workerId"
              label="师傅"
              emptyLabel="全部师傅"
              value={filters.workerId}
              options={options.workers}
            />
          ) : null}

          <TriStateSelect
            id="order-filter-urgent"
            name="isUrgent"
            label="急单"
            value={filters.isUrgent}
            yesLabel="仅急单"
            noLabel="仅非急单"
          />
          </div>

          <OrderAdvancedFilters
            key={`${filterStateKey}:${advancedRequested ? 'advanced' : 'default'}:${issues.length > 0 ? 'issues' : 'valid'}`}
            filters={filters}
            craftOptions={options.crafts}
            showCommercialAmounts={showCommercialAmounts}
            hasActiveFilters={hasAdvancedFilters}
            initiallyOpen={hasAdvancedFilters || advancedRequested}
            initiallyLoaded={
              hasAdvancedFilters || issues.length > 0 || advancedRequested
            }
          />

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
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
      </details>
    </section>
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
    (value) => `发货：${SHIPMENT_STATUS_LABELS[value]}`,
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
    (value) => `任务：${TASK_STATUS_LABELS[value]}`,
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
    (value) => `外协状态：${OUTSOURCE_STATUS_LABELS[value]}`,
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
