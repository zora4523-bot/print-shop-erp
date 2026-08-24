'use client';

import { useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import {
  MachineType,
  OrderKind,
  OutsourceStatus,
  ShipmentStatus,
  TaskStatus,
} from '@/generated/prisma/enums';
import { MACHINE_TYPE_LABELS } from '@/lib/auth/role-labels';
import { encodeFoilColorFilterValues } from '@/lib/order/foil-color-filter-codec';
import {
  OUTSOURCE_STATUS_REGISTRY,
  PRODUCTION_TASK_STATUS_REGISTRY,
  SHIPMENT_STATUS_REGISTRY,
  statusFilterLabel,
} from '@/lib/ui/status-registry';
import { Button } from '@/components/ui/button';
import { Disclosure, DisclosureSummary } from '@/components/ui/disclosure';
import type {
  OrderFilterOption,
  OrderListFilters as OrderListFilterValues,
} from '@/lib/order/list-query';
import {
  CheckboxGroup,
  DateField,
  enumOptions,
  fieldLabelClass,
  NumberFilter,
  ORDER_KIND_LABELS,
  selectClass,
  TextFilter,
  TriStateSelect,
  withSelectedOptions,
} from './OrderListFilterFields';

export function OrderAdvancedFilters({
  filters,
  craftOptions,
  showCommercialAmounts,
  hasActiveFilters,
  initiallyOpen,
  initiallyLoaded,
  idPrefix = '',
}: {
  filters: OrderListFilterValues;
  craftOptions: readonly OrderFilterOption[];
  showCommercialAmounts: boolean;
  hasActiveFilters: boolean;
  initiallyOpen: boolean;
  initiallyLoaded: boolean;
  idPrefix?: string;
}) {
  const [isOpen, setIsOpen] = useState(initiallyOpen);
  const [hasLoaded, setHasLoaded] = useState(initiallyLoaded);
  const controlId = (suffix: string) => `${idPrefix}order-filter-${suffix}`;

  return (
    <>
      <Disclosure
        className="min-w-0 rounded-lg border border-dashed border-border p-3"
        open={isOpen}
        onToggle={(event) => {
          const nextOpen = event.currentTarget.open;
          setIsOpen(nextOpen);
          if (nextOpen) setHasLoaded(true);
        }}
      >
        <DisclosureSummary className="gap-2">
          <SlidersHorizontal aria-hidden="true" className="size-4 text-muted-foreground" />
          更多筛选
          {hasActiveFilters ? (
            <span className="rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground">
              已启用
            </span>
          ) : null}
        </DisclosureSummary>

        {hasLoaded ? (
          <div className="mt-3 grid min-w-0 grid-cols-1 gap-3 border-t pt-3 sm:grid-cols-2 xl:grid-cols-4">
            <TextFilter
              id={controlId('order-no')}
              name="orderNo"
              label="工单号"
              value={filters.orderNo}
            />
            <TextFilter
              id={controlId('custom-name')}
              name="customName"
              label="工单名称"
              value={filters.customName}
            />
            <TextFilter
              id={controlId('customer')}
              name="customerRef"
              label="客户名称/简称"
              value={filters.customerRef}
            />
            <CheckboxGroup
              legend="工单类型"
              name="kind"
              selected={filters.kinds}
              options={enumOptions(OrderKind, ORDER_KIND_LABELS)}
              idPrefix={idPrefix}
            />

            <TextFilter
              id={controlId('receiver-name')}
              name="receiverName"
              label="收件人"
              value={filters.receiverName}
            />
            <TextFilter
              id={controlId('receiver-phone')}
              name="receiverPhone"
              label="收件电话"
              value={filters.receiverPhone}
              inputMode="tel"
            />
            <TextFilter
              id={controlId('receiver-address')}
              name="receiverAddress"
              label="收件地址"
              value={filters.receiverAddress}
              className="sm:col-span-2"
            />

            <TriStateSelect
              id={controlId('sf-collect')}
              name="isSfCollect"
              label="顺丰到付"
              value={filters.isSfCollect}
              yesLabel="仅顺丰到付"
              noLabel="排除顺丰到付"
            />
            <div className="min-w-0">
              <label htmlFor={controlId('address-mode')} className={fieldLabelClass}>
                地址数量
              </label>
              <select
                id={controlId('address-mode')}
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
              id={controlId('tracking-no')}
              name="trackingNo"
              label="快递单号"
              value={filters.trackingNo}
            />
            <TextFilter
              id={controlId('express-code')}
              name="expressCode"
              label="快递代码"
              value={filters.expressCode}
            />
            <CheckboxGroup
              legend="发货状态"
              name="shipmentStatus"
              selected={filters.shipmentStatuses}
              options={enumOptions(
                ShipmentStatus,
                (status) => statusFilterLabel(SHIPMENT_STATUS_REGISTRY[status]),
              )}
              className="sm:col-span-2"
              idPrefix={idPrefix}
            />

            {showCommercialAmounts ? (
              <>
                <NumberFilter
                  id={controlId('amount-min')}
                  name="amountMin"
                  label="最低金额（元）"
                  value={filters.amountMin}
                  step="0.01"
                />
                <NumberFilter
                  id={controlId('amount-max')}
                  name="amountMax"
                  label="最高金额（元）"
                  value={filters.amountMax}
                  step="0.01"
                />
              </>
            ) : null}
            <DateField
              id={controlId('promised-from')}
              name="promisedFrom"
              label="承诺交期从"
              value={filters.promisedFrom}
            />
            <DateField
              id={controlId('promised-to')}
              name="promisedTo"
              label="承诺交期到"
              value={filters.promisedTo}
            />

            <TextFilter
              id={controlId('item-name')}
              name="itemName"
              label="款式名称"
              value={filters.itemName}
            />
            <TextFilter
              id={controlId('product-name')}
              name="productName"
              label="产品名称"
              value={filters.productName}
            />
            <TextFilter
              id={controlId('specification')}
              name="specification"
              label="规格"
              value={filters.specification}
            />
            <TextFilter
              id={controlId('paper-type')}
              name="paperType"
              label="纸张"
              value={filters.paperType}
            />
            <NumberFilter
              id={controlId('quantity-min')}
              name="quantityMin"
              label="最小数量"
              value={filters.quantityMin}
              step="1"
            />
            <NumberFilter
              id={controlId('quantity-max')}
              name="quantityMax"
              label="最大数量"
              value={filters.quantityMax}
              step="1"
            />
            <TextFilter
              id={controlId('foil-colors')}
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
              options={withSelectedOptions(craftOptions, filters.craftIds, '工艺')}
              emptyMessage="暂无可筛选工艺"
              className="sm:col-span-2 xl:col-span-4"
              idPrefix={idPrefix}
            />
            <CheckboxGroup
              legend="生产任务状态"
              name="taskStatus"
              selected={filters.taskStatuses}
              options={enumOptions(
                TaskStatus,
                (status) =>
                  statusFilterLabel(PRODUCTION_TASK_STATUS_REGISTRY[status]),
              )}
              className="sm:col-span-2"
              idPrefix={idPrefix}
            />
            <CheckboxGroup
              legend="机器类型"
              name="machineType"
              selected={filters.machineTypes}
              options={enumOptions(MachineType, MACHINE_TYPE_LABELS)}
              className="sm:col-span-2"
              idPrefix={idPrefix}
            />

            <TriStateSelect
              id={controlId('requires-outsource')}
              name="requiresOutsource"
              label="是否外协"
              value={filters.requiresOutsource}
              yesLabel="仅外协工单"
              noLabel="仅非外协工单"
            />
            <TextFilter
              id={controlId('supplier')}
              name="supplierName"
              label="外协供应商"
              value={filters.supplierName}
            />
            <CheckboxGroup
              legend="外协状态"
              name="outsourceStatus"
              selected={filters.outsourceStatuses}
              options={enumOptions(
                OutsourceStatus,
                (status) =>
                  statusFilterLabel(OUTSOURCE_STATUS_REGISTRY[status]),
              )}
              className="sm:col-span-2"
              idPrefix={idPrefix}
            />
          </div>
        ) : null}
      </Disclosure>
      <noscript>
        <Button
          type="submit"
          name="advanced"
          value="1"
          variant="outline"
          className="mt-2 min-h-11"
        >
          加载更多筛选
        </Button>
      </noscript>
    </>
  );
}
