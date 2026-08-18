import { AdjustmentType } from '../generated/prisma/enums';

export const ADJUSTMENT_TYPE_LABELS: Record<AdjustmentType, string> = {
  [AdjustmentType.PER_SHEET]: '按张',
  [AdjustmentType.PER_PIECE]: '按个',
  [AdjustmentType.PER_ORDER]: '每款一次',
  [AdjustmentType.PER_10K]: '每万个',
};
