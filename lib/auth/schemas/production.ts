// 历史生产任务争议
// 由 lib/auth/schemas.ts 按域拆出（2026-09-14）；对外仍通过 lib/auth/schemas.ts 统一导出。
import { z } from 'zod';
import { safeId } from './shared';

export const createProductionTaskDisputeSchema = z.object({
  taskId: safeId('生产任务 id'),
  reason: z
    .string()
    .trim()
    .min(5, '异议原因至少 5 个字')
    .max(1000, '异议原因最多 1000 个字符'),
});

export type CreateProductionTaskDisputeInput = z.infer<
  typeof createProductionTaskDisputeSchema
>;

export const reviewProductionTaskDisputeSchema = z.object({
  disputeId: safeId('异议 id'),
  decision: z.enum(['RESOLVED', 'REJECTED'], {
    error: '请选择同意调整或驳回异议',
  }),
  resolution: z
    .string()
    .trim()
    .min(2, '处理回复至少 2 个字')
    .max(1000, '处理回复最多 1000 个字符'),
});

export type ReviewProductionTaskDisputeInput = z.infer<
  typeof reviewProductionTaskDisputeSchema
>;
