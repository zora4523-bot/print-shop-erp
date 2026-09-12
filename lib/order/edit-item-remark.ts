import 'server-only';

import { z } from 'zod';
import { Role } from '@/generated/prisma/enums';
import { db } from '@/lib/db';
import { isOrderEditable } from './editable-fields';
import { orderCascadeLockKey } from './locks';

export const editItemRemarkSchema = z.object({
  orderId: z.string().trim().min(1).max(128),
  itemId: z.string().trim().min(1).max(128),
  expectedEditVersion: z.number().int().nonnegative().refine(Number.isSafeInteger),
  remark: z.string().transform((value) => value.replace(/\r\n?/g, '\n').trim())
    .pipe(z.string().max(1000, '款式备注最多 1000 字')),
}).strict();

export class EditItemRemarkError extends Error {}

/** Internal text-only edit: never accepts production or pricing fields. */
export async function editItemRemark(raw: unknown, actor: { id: string; role: Role }) {
  if (actor.role !== Role.ADMIN && actor.role !== Role.CUSTOMER_SERVICE)
    throw new EditItemRemarkError('当前账号不能修改内部款式备注');
  const input = editItemRemarkSchema.parse(raw);
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orderCascadeLockKey(input.orderId)}))`;
    await tx.$executeRaw`SELECT id FROM "Order" WHERE id = ${input.orderId} FOR UPDATE`;
    const order = await tx.order.findUnique({
      where: { id: input.orderId },
      select: { submitterId: true, status: true, editVersion: true,
        _count: { select: { changeRequests: { where: { status: 'PENDING' } } } } },
    });
    if (!order || (actor.role !== Role.ADMIN && order.submitterId !== actor.id))
      throw new EditItemRemarkError('无权修改该工单，请返回工单列表');
    if (!isOrderEditable(order.status) || order._count.changeRequests)
      throw new EditItemRemarkError('工单当前不能修改，请刷新后核对状态');
    if (order.editVersion !== input.expectedEditVersion)
      throw new EditItemRemarkError('工单已更新，请刷新后重新填写');
    const item = await tx.orderItem.findFirst({
      where: { id: input.itemId, orderId: input.orderId }, select: { remark: true, sequence: true },
    });
    if (!item) throw new EditItemRemarkError('款式不属于该工单，请刷新后重试');
    const remark = input.remark || null;
    if (remark === item.remark) return false;
    await tx.orderItem.update({ where: { id: input.itemId }, data: { remark } });
    await tx.order.update({ where: { id: input.orderId },
      data: { revision: { increment: 1 }, editVersion: { increment: 1 } } });
    await tx.orderLog.create({ data: {
      orderId: input.orderId, operatorId: actor.id, action: 'UPDATE',
      remark: `修改第 ${item.sequence} 款备注：${item.remark ?? '未填写'} → ${remark ?? '未填写'}`,
      changedFields: { itemRemark: { itemId: input.itemId, before: item.remark, after: remark } },
    } });
    return true;
  });
}
