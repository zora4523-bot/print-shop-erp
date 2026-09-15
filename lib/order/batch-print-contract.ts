import { z } from 'zod';

export const BATCH_PRINT_MAX = 50;
export const batchPrintRequestSchema = z.object({
  requestId: z.string().uuid(),
  orderIds: z.array(z.string().min(1).max(128)).min(1).max(BATCH_PRINT_MAX)
    .refine((ids) => new Set(ids).size === ids.length, '不能重复选择工单'),
});
export type BatchPrintIssue = { position: number; message: string };
export type BatchPrintStatus = {
  status: 'pending' | 'ready' | 'failed' | 'unavailable';
  phase?: 'queued' | 'rendering' | 'merging';
  completed: number;
  total: number;
  issues: BatchPrintIssue[];
};
