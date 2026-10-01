import { z } from 'zod';
import { parseStrictYmd } from './shared';

const date = z.string().refine((v) => v === '' || !!parseStrictYmd(v), '日期无效');
export const cdrWorkbenchFilterSchema = z.object({
  scope: z.enum(['pending', 'all']).default('pending'),
  from: date.default(''), to: date.default(''),
  q: z.string().trim().max(100).default(''),
  page: z.coerce.number().int().min(1).max(100000).default(1),
}).refine((v) => !v.from || !v.to || v.from <= v.to, '起始日期不能晚于终止日期');
export type CdrWorkbenchFilter = z.infer<typeof cdrWorkbenchFilterSchema>;
export const cdrSelectionSchema = z.array(z.object({
  id: z.string().min(1).max(128), version: z.string().regex(/^[a-f0-9]{64}$/),
})).min(1).max(100).refine(
  (rows) => new Set(rows.map((row) => row.id)).size === rows.length, '工单不可重复',
);
