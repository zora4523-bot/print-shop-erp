import { z } from 'zod';
import { DEFAULT_FOIL_WAGES, FOIL_WAGE_THRESHOLD } from './foil-wage';

export const PIECEWORK_RATE_FIELDS = [
  { key: 'partial', label: '局部烫金', unitLabel: '元/下', operationType: 'PARTIAL', unit: 'PER_PASS' },
  { key: 'full', label: '专版烫金', unitLabel: '元/个', operationType: 'FULL', unit: 'PER_PIECE' },
  { key: 'bag', label: '包装入袋', unitLabel: '元/袋', operationType: 'PACKING', unit: 'PER_BAG' },
  { key: 'box', label: '包装装盒', unitLabel: '元/盒', operationType: 'PACKING', unit: 'PER_BOX' },
] as const;

export const FOIL_WAGE_FIELDS = [
  { key: 'partialSmall', label: `局部 1–${FOIL_WAGE_THRESHOLD} 个工资（含装版）`, unitLabel: '元/次', operationType: 'PARTIAL', unit: 'PER_PASS', column: 'smallOrderAmount', defaultValue: DEFAULT_FOIL_WAGES.PARTIAL.smallOrderAmount },
  { key: 'partialSetup', label: `局部 ${FOIL_WAGE_THRESHOLD + 1} 个及以上装版费`, unitLabel: '元/次', operationType: 'PARTIAL', unit: 'PER_PASS', column: 'setupAmount', defaultValue: DEFAULT_FOIL_WAGES.PARTIAL.setupAmount },
  { key: 'fullSmall', label: `专版 1–${FOIL_WAGE_THRESHOLD} 个工资（含装版）`, unitLabel: '元/色', operationType: 'FULL', unit: 'PER_PIECE', column: 'smallOrderAmount', defaultValue: DEFAULT_FOIL_WAGES.FULL.smallOrderAmount },
  { key: 'fullSetup', label: `专版 ${FOIL_WAGE_THRESHOLD + 1} 个及以上装版费`, unitLabel: '元/色', operationType: 'FULL', unit: 'PER_PIECE', column: 'setupAmount', defaultValue: DEFAULT_FOIL_WAGES.FULL.setupAmount },
] as const;

// Fixed decimal text prevents floating-point rounding and scientific notation.
const rate = z.string().trim().regex(/^(?:\d{1,10}(?:\.\d{1,4})?)?$/, '工价须为非负数，最多四位小数');
export const pieceworkDraftSchema = z.object({
  version: z.number().int().positive(),
  updatedAt: z.iso.datetime(),
  partial: rate, full: rate, bag: rate, box: rate,
  partialSmall: rate.optional(), partialSetup: rate.optional(), fullSmall: rate.optional(), fullSetup: rate.optional(),
  effectiveFrom: z.union([z.literal(''), z.iso.datetime({ offset: true })]),
  sourceName: z.string().trim().max(500),
  publishNote: z.string().trim().max(500),
}).strict();
export type PieceworkDraftInput = z.infer<typeof pieceworkDraftSchema>;
export const pieceworkRevisionSchema = pieceworkDraftSchema.pick({ version: true, updatedAt: true });
export type PieceworkRevision = z.infer<typeof pieceworkRevisionSchema>;
