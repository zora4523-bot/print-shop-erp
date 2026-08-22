import Link from 'next/link';
import type { ReactNode } from 'react';
import { ChevronDown, Search, SlidersHorizontal, X } from 'lucide-react';
import {
  MachineType,
  OrderKind,
  OrderStatus,
  OutsourceStatus,
  ShipmentStatus,
  TaskStatus,
} from '@/generated/prisma/enums';
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

const ORDER_KIND_LABELS: Record<OrderKind, string> = {
  [OrderKind.NORMAL]: '普通工单',
  [OrderKind.REWORK]: '重做单',
};

const SHIPMENT_STATUS_LABELS: Record<ShipmentStatus, string> = {
  [ShipmentStatus.PLANNED]: '待发货',
  [ShipmentStatus.SHIPPED]: '已发货',
};

const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  [TaskStatus.PENDING]: '待生产',
  [TaskStatus.IN_PROGRESS]: '生产中',
  [TaskStatus.COMPLETED]: '已完工',
  [TaskStatus.CANCELLED]: '已取消',
};

const OUTSOURCE_STATUS_LABELS: Record<OutsourceStatus, string> = {
  [OutsourceStatus.SENT]: '已发送',
  [OutsourceStatus.IN_PROGRESS]: '进行中',
  [OutsourceStatus.RECEIVED]: '已收货',
  [OutsourceStatus.CANCELLED]: '已取消',
};

const selectClass =
  'h-8 w-full min-w-0 rounded-lg border border-input bg-background px-2.5 py-1 text-base text-foreground shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30';

const fieldLabelClass = 'mb-1.5 block text-sm font-medium text-foreground';

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
}: {
  query: OrderListQuery;
  options: OrderListFilterOptions;
  issues: readonly string[];
  total: number;
  exportControls?: ReactNode;
  showCommercialAmounts?: boolean;
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
  const hasAdvancedFilters =
    filters.orderNo !== undefined ||
    filters.customName !== undefined ||
    filters.customerRef !== undefined ||
    filters.receiverName !== undefined ||
    filters.receiverPhone !== undefined ||
    filters.receiverAddress !== undefined ||
    filters.kinds.length > 0 ||
    filters.isSfCollect !== undefined ||
    filters.addressMode !== undefined ||
    (showCommercialAmounts && filters.amountMin !== undefined) ||
    (showCommercialAmounts && filters.amountMax !== undefined) ||
    filters.promisedFrom !== undefined ||
    filters.promisedTo !== undefined ||
    filters.trackingNo !== undefined ||
    filters.expressCode !== undefined ||
    filters.shipmentStatuses.length > 0 ||
    filters.itemName !== undefined ||
    filters.productName !== undefined ||
    filters.specification !== undefined ||
    filters.paperType !== undefined ||
    filters.quantityMin !== undefined ||
    filters.quantityMax !== undefined ||
    filters.craftIds.length > 0 ||
    filters.foilColors.length > 0 ||
    filters.taskStatuses.length > 0 ||
    filters.machineTypes.length > 0 ||
    filters.requiresOutsource !== undefined ||
    filters.outsourceStatuses.length > 0 ||
    filters.supplierName !== undefined;
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
        open={issues.length > 0 || undefined}
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

        <details
          className="min-w-0 rounded-lg border border-dashed border-border p-3"
          open={hasAdvancedFilters || undefined}
        >
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-md text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
            <SlidersHorizontal aria-hidden="true" className="size-4 text-muted-foreground" />
            更多筛选
            {hasAdvancedFilters ? (
              <span className="rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground">
                已启用
              </span>
            ) : null}
          </summary>

          <div className="mt-3 grid min-w-0 grid-cols-1 gap-3 border-t pt-3 sm:grid-cols-2 xl:grid-cols-4">
            <TextFilter
              id="order-filter-order-no"
              name="orderNo"
              label="工单号"
              value={filters.orderNo}
            />
            <TextFilter
              id="order-filter-custom-name"
              name="customName"
              label="工单名称"
              value={filters.customName}
            />
            <TextFilter
              id="order-filter-customer"
              name="customerRef"
              label="客户名称/简称"
              value={filters.customerRef}
            />
            <CheckboxGroup
              legend="工单类型"
              name="kind"
              selected={filters.kinds}
              options={enumOptions(OrderKind, ORDER_KIND_LABELS)}
            />

            <TextFilter
              id="order-filter-receiver-name"
              name="receiverName"
              label="收件人"
              value={filters.receiverName}
            />
            <TextFilter
              id="order-filter-receiver-phone"
              name="receiverPhone"
              label="收件电话"
              value={filters.receiverPhone}
              inputMode="tel"
            />
            <TextFilter
              id="order-filter-receiver-address"
              name="receiverAddress"
              label="收件地址"
              value={filters.receiverAddress}
              className="sm:col-span-2"
            />

            <TriStateSelect
              id="order-filter-sf-collect"
              name="isSfCollect"
              label="顺丰到付"
              value={filters.isSfCollect}
              yesLabel="仅顺丰到付"
              noLabel="排除顺丰到付"
            />
            <div className="min-w-0">
              <label htmlFor="order-filter-address-mode" className={fieldLabelClass}>
                地址数量
              </label>
              <select
                id="order-filter-address-mode"
                name="addressMode"
                defaultValue={filters.addressMode ?? 'all'}
                className={selectClass}
              >
                <option value="all">全部</option>
                <option value="single">单地址</option>
                <option value="multiple">多地址</option>
              </select>
            </div>
            <TextFilter
              id="order-filter-tracking-no"
              name="trackingNo"
              label="快递单号"
              value={filters.trackingNo}
            />
            <TextFilter
              id="order-filter-express-code"
              name="expressCode"
              label="快递代码"
              value={filters.expressCode}
            />
            <CheckboxGroup
              legend="发货状态"
              name="shipmentStatus"
              selected={filters.shipmentStatuses}
              options={enumOptions(ShipmentStatus, SHIPMENT_STATUS_LABELS)}
              className="sm:col-span-2"
            />

            {showCommercialAmounts ? (
              <>
                <NumberFilter
                  id="order-filter-amount-min"
                  name="amountMin"
                  label="最低金额（元）"
                  value={filters.amountMin}
                  step="0.01"
                />
                <NumberFilter
                  id="order-filter-amount-max"
                  name="amountMax"
                  label="最高金额（元）"
                  value={filters.amountMax}
                  step="0.01"
                />
              </>
            ) : null}
            <DateField
              id="order-filter-promised-from"
              name="promisedFrom"
              label="承诺交期从"
              value={filters.promisedFrom}
            />
            <DateField
              id="order-filter-promised-to"
              name="promisedTo"
              label="承诺交期到"
              value={filters.promisedTo}
            />

            <TextFilter
              id="order-filter-item-name"
              name="itemName"
              label="款式名称"
              value={filters.itemName}
            />
            <TextFilter
              id="order-filter-product-name"
              name="productName"
              label="产品名称"
              value={filters.productName}
            />
            <TextFilter
              id="order-filter-specification"
              name="specification"
              label="规格"
              value={filters.specification}
            />
            <TextFilter
              id="order-filter-paper-type"
              name="paperType"
              label="纸张"
              value={filters.paperType}
            />
            <NumberFilter
              id="order-filter-quantity-min"
              name="quantityMin"
              label="最小数量"
              value={filters.quantityMin}
              step="1"
            />
            <NumberFilter
              id="order-filter-quantity-max"
              name="quantityMax"
              label="最大数量"
              value={filters.quantityMax}
              step="1"
            />
            <TextFilter
              id="order-filter-foil-colors"
              name="foilColor"
              label="烫金色"
              value={encodeFoilColorFilterValues(filters.foilColors)}
              placeholder="多个颜色用逗号分隔；颜色名内的逗号写成 \,"
              maxLength={1000}
              className="sm:col-span-2"
            />
            <CheckboxGroup
              legend="工艺"
              name="craftId"
              selected={filters.craftIds}
              options={withSelectedOptions(options.crafts, filters.craftIds, '工艺')}
              emptyMessage="暂无可筛选工艺"
              className="sm:col-span-2 xl:col-span-4"
            />
            <CheckboxGroup
              legend="生产任务状态"
              name="taskStatus"
              selected={filters.taskStatuses}
              options={enumOptions(TaskStatus, TASK_STATUS_LABELS)}
              className="sm:col-span-2"
            />
            <CheckboxGroup
              legend="机器类型"
              name="machineType"
              selected={filters.machineTypes}
              options={enumOptions(MachineType, MACHINE_TYPE_LABELS)}
              className="sm:col-span-2"
            />

            <TriStateSelect
              id="order-filter-requires-outsource"
              name="requiresOutsource"
              label="是否外协"
              value={filters.requiresOutsource}
              yesLabel="仅外协工单"
              noLabel="仅非外协工单"
            />
            <TextFilter
              id="order-filter-supplier"
              name="supplierName"
              label="外协供应商"
              value={filters.supplierName}
            />
            <CheckboxGroup
              legend="外协状态"
              name="outsourceStatus"
              selected={filters.outsourceStatuses}
              options={enumOptions(OutsourceStatus, OUTSOURCE_STATUS_LABELS)}
              className="sm:col-span-2"
            />
          </div>
        </details>

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

function TextFilter({
  id,
  name,
  label,
  value,
  placeholder,
  inputMode,
  maxLength = 80,
  className,
}: {
  id: string;
  name: string;
  label: string;
  value?: string;
  placeholder?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
  maxLength?: number;
  className?: string;
}) {
  return (
    <div className={cn('min-w-0', className)}>
      <label htmlFor={id} className={fieldLabelClass}>
        {label}
      </label>
      <Input
        id={id}
        name={name}
        defaultValue={value ?? ''}
        placeholder={placeholder}
        inputMode={inputMode}
        maxLength={maxLength}
      />
    </div>
  );
}

function NumberFilter({
  id,
  name,
  label,
  value,
  step,
}: {
  id: string;
  name: string;
  label: string;
  value?: string | number;
  step: string;
}) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className={fieldLabelClass}>
        {label}
      </label>
      <Input
        id={id}
        type="number"
        name={name}
        defaultValue={value ?? ''}
        min="0"
        step={step}
        inputMode={step === '1' ? 'numeric' : 'decimal'}
      />
    </div>
  );
}

function DateField({
  id,
  name,
  label,
  value,
}: {
  id: string;
  name: string;
  label: string;
  value?: string;
}) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className={fieldLabelClass}>
        {label}
      </label>
      <Input id={id} type="date" name={name} defaultValue={value ?? ''} />
    </div>
  );
}

function TriStateSelect({
  id,
  name,
  label,
  value,
  yesLabel,
  noLabel,
}: {
  id: string;
  name: string;
  label: string;
  value?: boolean;
  yesLabel: string;
  noLabel: string;
}) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className={fieldLabelClass}>
        {label}
      </label>
      <select
        id={id}
        name={name}
        defaultValue={value === undefined ? 'all' : value ? 'yes' : 'no'}
        className={selectClass}
      >
        <option value="all">全部</option>
        <option value="yes">{yesLabel}</option>
        <option value="no">{noLabel}</option>
      </select>
    </div>
  );
}

function OptionSelect({
  id,
  name,
  label,
  emptyLabel,
  value,
  options,
}: {
  id: string;
  name: string;
  label: string;
  emptyLabel: string;
  value?: string;
  options: readonly OrderFilterOption[];
}) {
  const selectOptions = withSelectedOptions(options, value ? [value] : [], label);
  return (
    <div className="min-w-0">
      <label htmlFor={id} className={fieldLabelClass}>
        {label}
      </label>
      <select
        id={id}
        name={name}
        defaultValue={value ?? ''}
        className={selectClass}
      >
        <option value="">{emptyLabel}</option>
        {selectOptions.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function CheckboxGroup<T extends string>({
  legend,
  name,
  selected,
  options,
  emptyMessage,
  className,
}: {
  legend: string;
  name: string;
  selected: readonly T[];
  options: readonly { id: T; label: string }[];
  emptyMessage?: string;
  className?: string;
}) {
  return (
    <fieldset className={cn('min-w-0', className)}>
      <legend className={fieldLabelClass}>{legend}</legend>
      {options.length > 0 ? (
        <div className="flex min-w-0 flex-wrap gap-x-3 gap-y-1 rounded-lg border border-border bg-background px-2 py-1 dark:bg-input/30">
          {options.map((option) => {
            const id = `order-filter-${name}-${option.id}`;
            return (
              <label
                key={option.id}
                htmlFor={id}
                className="flex min-h-11 min-w-0 cursor-pointer items-center gap-2 text-sm text-foreground"
              >
                <input
                  id={id}
                  type="checkbox"
                  name={name}
                  value={option.id}
                  defaultChecked={selected.includes(option.id)}
                  className="size-4 shrink-0 accent-primary"
                />
                <span className="admin-wrap-anywhere">{option.label}</span>
              </label>
            );
          })}
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          <input type="hidden" name={name} value="" />
          {emptyMessage ?? '暂无可选项'}
        </div>
      )}
    </fieldset>
  );
}

function enumOptions<T extends string>(
  values: Record<string, T>,
  labels: Record<T, string>,
): Array<{ id: T; label: string }> {
  return Object.values(values).map((value) => ({ id: value, label: labels[value] }));
}

function withSelectedOptions(
  options: readonly OrderFilterOption[],
  selectedIds: readonly string[],
  fallbackLabel: string,
): OrderFilterOption[] {
  const result = [...options];
  const known = new Set(result.map((option) => option.id));
  for (const id of selectedIds) {
    if (!known.has(id)) {
      result.push({ id, label: `${fallbackLabel}（${id}）` });
      known.add(id);
    }
  }
  return result;
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
