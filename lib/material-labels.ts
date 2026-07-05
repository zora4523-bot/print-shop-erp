import type { MaterialCategory } from '../generated/prisma/enums';

export const MATERIAL_CATEGORY_LABELS = {
  PAPER: '纸张',
  FOIL: '烫金纸',
  BAG: '包装袋',
  FINISHED_STOCK: '成品库存',
  OTHER: '其他',
} satisfies Record<MaterialCategory, string>;
