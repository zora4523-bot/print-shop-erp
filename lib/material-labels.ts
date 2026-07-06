import type { MaterialCategory } from '../generated/prisma/enums';

export const MATERIAL_CATEGORY_LABELS = {
  PAPER: '纸张',
  FOIL: '烫金纸',
  BAG: '包装袋',
  FINISHED_STOCK: '成品库存',
  OTHER: '其他',
} satisfies Record<MaterialCategory, string>;

// 手工出入库的原因选项。存库值保持英文代码（MaterialTransaction.reasonType
// 是 string 列，PURCHASE_RECEIPT / PURCHASE_RECEIPT_CANCEL 由采购流程
// 系统写入，不在手工选项里），UI 一律显示中文。
export const TX_REASON_OPTIONS = [
  { value: 'PURCHASE', label: '采购入库' },
  { value: 'PRODUCTION_USE', label: '生产领用' },
  { value: 'ADJUSTMENT', label: '盘点调整' },
  { value: 'RETURN', label: '退回入库' },
  { value: 'OTHER', label: '其他' },
] as const;

export const TX_REASON_LABELS: Record<string, string> = {
  ...Object.fromEntries(TX_REASON_OPTIONS.map((o) => [o.value, o.label])),
  PURCHASE_RECEIPT: '采购收货',
  PURCHASE_RECEIPT_CANCEL: '采购收货取消',
};

export function txReasonLabel(reasonType: string): string {
  return TX_REASON_LABELS[reasonType] ?? reasonType;
}
