import type Decimal from 'decimal.js';
import { firstSearchParam, paginateItems, parsePositiveInt } from '@/lib/admin/table';
import { readBillSettlementDetail } from './settlement-detail';

type Item = { orderNoSnapshot: string; settlementDetailSnapshot?: unknown; settledFeeSnapshot: Decimal.Value; order: { customName: string | null } };
export function billItemName(item: Omit<Item, 'orderNoSnapshot'>) {
  const detail = readBillSettlementDetail(item.settlementDetailSnapshot, item.settledFeeSnapshot);
  return { name: (detail ? detail.orderName : item.order.customName)?.trim() || '未命名工单', current: !detail };
}

export function billItemPage<T extends Item>(items: T[], params: { q?: string | string[]; page?: string | string[] }) {
  const q = firstSearchParam(params.q).trim().slice(0, 100);
  const needle = q.toLocaleLowerCase('zh-CN');
  const matches = q ? items.filter((item) => [item.orderNoSnapshot, billItemName(item).name].some((value) => value.toLocaleLowerCase('zh-CN').includes(needle))) : items;
  return { ...paginateItems(matches, parsePositiveInt(params.page, { defaultValue: 1 }), 30), q };
}
