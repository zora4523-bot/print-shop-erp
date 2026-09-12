import 'server-only';
import { z } from 'zod';
import { db } from '@/lib/db';
import { Role } from '@/generated/prisma/enums';
import { isOrderEditable } from './editable-fields';
import { orderCascadeLockKey } from './locks';

export const salesTextEditSchema = z.object({
  orderId: z.string().min(1).max(128),
  targetId: z.string().min(1).max(128),
  field: z.enum(['itemName']),
  expectedEditVersion: z.number().int().nonnegative().refine(Number.isSafeInteger),
  value: z.string().trim().min(1, '请填写款式名称').max(64),
}).strict();
export class SalesTextEditError extends Error {}
export async function editSalesOrderText(raw: unknown, actor: { id: string; role: Role }) {
  if (actor.role !== Role.SALES) throw new SalesTextEditError('当前账号不能使用销售编辑入口');
  const input = salesTextEditSchema.parse(raw);
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orderCascadeLockKey(input.orderId)}))`;
    const order = await tx.order.findUnique({ where: { id: input.orderId }, select: {
      submitterId: true, status: true, editVersion: true,
      _count: { select: { changeRequests: { where: { status: 'PENDING' } } } },
    } });
    if (!order || order.submitterId !== actor.id) throw new SalesTextEditError('只能编辑自己的工单');
    if (!isOrderEditable(order.status) || order._count.changeRequests) throw new SalesTextEditError('工单当前不能直接修改，请刷新后核对状态');
    if (order.editVersion !== input.expectedEditVersion) throw new SalesTextEditError('工单已更新，请刷新后重试');
    const item = await tx.orderItem.findFirst({ where: { id: input.targetId, orderId: input.orderId }, select: { name: true } });
    if (!item) throw new SalesTextEditError('款式不属于该工单');
    if (item.name === input.value) return;
    await tx.orderItem.update({ where: { id: input.targetId }, data: { name: input.value } });
    await tx.order.update({ where: { id: input.orderId }, data: { revision: { increment: 1 }, editVersion: { increment: 1 } } });
    await tx.orderLog.create({ data: { orderId: input.orderId, operatorId: actor.id, action: 'UPDATE',
      remark: `修改款式名称：${item.name} → ${input.value}`,
      changedFields: { salesText: { targetId: input.targetId, field: input.field, before: item.name, after: input.value } },
    } });
  });
}
