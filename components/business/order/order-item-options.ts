import { NO_FOIL_COLOR } from '@/lib/order/foil-colors';

export type OrderItemQuickOption = {
  value: string;
  label: string;
};

// Keep the sales team's most frequently used values first. These remain
// plain text values in OrderItem so historical orders and custom requests
// continue to work without a lookup-table migration.
export const ORDER_SPECIFICATION_OPTIONS: readonly OrderItemQuickOption[] = [
  { value: '迷你', label: '迷你' },
  { value: '大号', label: '大号' },
  { value: '中号', label: '中号' },
  { value: '方形', label: '方形' },
  { value: '万元封', label: '万元封' },
  { value: '大号西封', label: '大号西封' },
];

export const ORDER_PAPER_OPTIONS: readonly OrderItemQuickOption[] = [
  { value: '艳红珠光纸', label: '艳红珠光纸' },
  { value: '暗红珠光纸', label: '暗红珠光纸' },
  { value: '触感纸', label: '触感纸' },
  { value: '铜版纸', label: '铜版纸' },
  { value: '冰白纸', label: '冰白纸' },
  { value: '红卡纸', label: '红卡纸' },
  { value: '金葱纸', label: '金葱纸' },
  { value: '紫色珠光纸', label: '紫色珠光纸' },
  { value: '黄色珠光纸', label: '黄色珠光纸' },
  { value: '米金珠光纸', label: '米金珠光纸' },
  { value: '酒红', label: '酒红' },
  { value: '玫红', label: '玫红' },
  { value: '粉色', label: '粉色' },
  { value: '莱尼纹', label: '莱尼纹' },
];

export const ORDER_FOIL_COLOR_OPTIONS: readonly OrderItemQuickOption[] = [
  { value: '哑金', label: '哑金' },
  { value: '浅金', label: '浅金' },
  { value: '红金', label: '红金' },
  { value: '黑金', label: '黑金' },
  { value: '银色', label: '银色' },
  { value: '黄金', label: '黄金' },
  { value: '蓝金', label: '蓝金' },
  { value: '透明金', label: '透明金' },
  {
    value: NO_FOIL_COLOR,
    label: NO_FOIL_COLOR,
  },
];
