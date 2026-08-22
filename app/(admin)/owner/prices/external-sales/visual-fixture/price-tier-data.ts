import type { ExternalSalesPriceTier } from '@/components/business/price/ExternalSalesPriceTierGroupEditor';

export const VISUAL_TIER_PRODUCT =
  '157克超长双铜纸彩印加局部烫金·万元封非标大号（客户专版ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789）';

export const VISUAL_TIER_PAPER =
  '157克双铜纸·客户指定超长纸张名称ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

export const VISUAL_TIER_SIZE =
  '大号·非标定制 123.45 × 678.90 mm（横向折叠长规格）';

export const VISUAL_PRICE_TIERS: ExternalSalesPriceTier[] = [
  ['visual-tier-1000', 1_000, '295', '310', true],
  ['visual-tier-2000', 2_000, '420', '420', false],
  ['visual-tier-3000', 3_000, '530', '560', true],
  ['visual-tier-4000', 4_000, '680', '680', false],
  ['visual-tier-5000', 5_000, '800', '850', true],
  ['visual-tier-10000', 10_000, '1400', '1400', false],
  ['visual-tier-20000', 20_000, '2300', '2480', true],
].map(([ruleId, quantity, currentAmount, draftAmount, changed]) => ({
  ruleId: String(ruleId),
  quantity: Number(quantity),
  currentAmount: String(currentAmount),
  draftAmount: String(draftAmount),
  expectedUpdatedAt: '2026-08-11T20:00:00.000Z',
  isActive: true,
  changed: Boolean(changed),
}));

export const VISUAL_PER_PIECE_PRICE_TIERS: ExternalSalesPriceTier[] = [
  ['visual-piece-tier-1000', 1_000, '0.52', '0.54', true],
  ['visual-piece-tier-2000', 2_000, '0.325', '0.325', false],
  ['visual-piece-tier-3000', 3_000, '0.285', '0.29', true],
  ['visual-piece-tier-4000', 4_000, '0.27', '0.27', false],
  ['visual-piece-tier-5000', 5_000, '0.245', '0.25', true],
  ['visual-piece-tier-10000', 10_000, '0.2', '0.2', false],
  ['visual-piece-tier-20000', 20_000, '0.19', '0.18', true],
].map(([ruleId, quantity, currentAmount, draftAmount, changed]) => ({
  ruleId: String(ruleId),
  quantity: Number(quantity),
  currentAmount: String(currentAmount),
  draftAmount: String(draftAmount),
  expectedUpdatedAt: '2026-08-11T20:00:00.000Z',
  isActive: true,
  changed: Boolean(changed),
}));
