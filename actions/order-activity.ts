'use server';

import { z } from 'zod';
import { requirePermission } from '@/lib/auth/permissions';
import { readOrderActivity } from '@/lib/order/activity';

const inputSchema = z.object({
  orderId: z.string().trim().min(1).max(128),
  cursor: z.object({ at: z.string().datetime(), id: z.string().min(1).max(128) }),
});

export async function loadOrderActivity(input: unknown) {
  const actor = await requirePermission('order:view:all');
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, message: '加载参数无效，请刷新后重试' };
  const page = await readOrderActivity(parsed.data.orderId, actor, parsed.data.cursor);
  if (!page) return { ok: false as const, message: '工单不存在或无权访问' };
  return { ok: true as const, page };
}
