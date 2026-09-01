'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requirePermission } from '@/lib/auth/permissions';
import { getOrderScopeFilter } from '@/lib/auth/order-scope';
import { db } from '@/lib/db';
import type { OrderStarMutationResult } from './order-workspace.types';

const starInputSchema = z.object({
  orderId: z.string().trim().min(1).max(128),
  starred: z.boolean(),
});

export async function setOrderStarredAction(input: {
  orderId: string;
  starred: boolean;
}): Promise<OrderStarMutationResult> {
  const actor = await requirePermission('order:view:all');
  const parsed = starInputSchema.safeParse(input);
  if (!parsed.success) {
    return { status: 'invalid', message: '星标请求不合法' };
  }

  const order = await db.order.findFirst({
    where: {
      AND: [
        getOrderScopeFilter(actor),
        { id: parsed.data.orderId },
      ],
    },
    select: { id: true },
  });
  if (!order) {
    return { status: 'not-found', message: '工单不存在或无权访问' };
  }

  if (parsed.data.starred) {
    await db.userOrderStar.upsert({
      where: {
        userId_orderId: { userId: actor.id, orderId: order.id },
      },
      create: { userId: actor.id, orderId: order.id },
      update: {},
    });
  } else {
    await db.userOrderStar.deleteMany({
      where: { userId: actor.id, orderId: order.id },
    });
  }

  revalidatePath('/orders');
  return {
    status: 'success',
    orderId: order.id,
    starred: parsed.data.starred,
  };
}
