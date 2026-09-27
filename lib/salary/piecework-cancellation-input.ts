import { z } from 'zod';

export const cancellationBookRevisionSchema = z.object({
  id: z.string().min(1).max(64), version: z.number().int().positive(),
  effectiveFrom: z.iso.datetime(), effectiveTo: z.iso.datetime().nullable(),
  updatedAt: z.iso.datetime(),
});
export const pieceworkCancellationReviewSchema = z.object({
  workerId: z.string().min(1).max(64).nullable(),
  target: cancellationBookRevisionSchema,
  predecessor: cancellationBookRevisionSchema.nullable(),
  successor: cancellationBookRevisionSchema.nullable(),
});
export const pieceworkCancellationSchema = z.object({
  clientRequestId: z.uuid(),
  reason: z.string().trim().min(2, '请填写至少两字的取消原因').max(500, '取消原因最多 500 字'),
  review: pieceworkCancellationReviewSchema,
});
export type PieceworkCancellationReview = z.infer<typeof pieceworkCancellationReviewSchema>;
export type PieceworkCancellationInput = z.infer<typeof pieceworkCancellationSchema>;
