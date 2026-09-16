import { z } from 'zod';
import { db } from '../db';
import { orderCascadeLockKey } from '../order/locks';
import { operationLockKey } from './operation-reporting';
import { assertActivePieceworkAdmin } from '../salary/piecework-price-book-admin';
import type { AuditActor } from '../audit-log';

export const payrollPassSchema = z.object({
  operationId: z.string().min(1),
  expectedRevision: z.number().int().nonnegative(),
  passCount: z.number().int().min(1).max(999),
  reason: z.string().trim().min(2).max(500),
});
export class PayrollPassError extends Error {}

/** Shares order -> operation locks with reporting and version changes. */
export async function updatePayrollPassCount(raw: z.infer<typeof payrollPassSchema>, actor: AuditActor) {
  const parsed = payrollPassSchema.safeParse(raw);
  if (!parsed.success) throw new PayrollPassError('次数须为 1–999 的整数，调整原因至少填写两个字');
  const input = parsed.data;
  return db.$transaction(async (tx) => {
    const activeActor = await assertActivePieceworkAdmin(tx, actor);
    const locator = await tx.productionOperation.findUnique({ where: { id: input.operationId }, select: { orderId: true } });
    if (!locator) throw new PayrollPassError('工序不存在，请刷新工单');
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orderCascadeLockKey(locator.orderId)}))`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${operationLockKey(input.operationId)}))`;
    const operation = await tx.productionOperation.findUniqueOrThrow({
      where: { id: input.operationId },
      include: { order: { select: { workOrderVersion: true, status: true } }, sources: { include: { orderItem: true } } },
    });
    if (operation.operationType !== 'PARTIAL' || operation.workOrderVersion !== operation.order.workOrderVersion ||
      !['PENDING', 'IN_PROGRESS'].includes(operation.status) ||
      !['CONFIRMED', 'RELEASED', 'FOILING', 'PACKING', 'SCHEDULING', 'IN_PRODUCTION'].includes(operation.order.status)) {
      throw new PayrollPassError('当前工序不能调整计薪次数，请检查工单状态');
    }
    if (operation.payrollRevision !== input.expectedRevision) throw new PayrollPassError('计薪次数已被修改，请刷新后重试');
    const defaults = new Set(operation.sources.map((s) => s.orderItem ? s.orderItem.frontFoilColors.length + s.orderItem.backFoilColors.length : 0));
    if (defaults.size !== 1 || defaults.has(0)) throw new PayrollPassError('工序款式的过版次数不一致，请先核对工单');
    const previous = operation.payrollPassCount ?? [...defaults][0]!;
    if (previous === input.passCount) return { orderId: operation.orderId };
    await tx.productionOperation.update({ where: { id: operation.id }, data: { payrollPassCount: input.passCount, payrollRevision: { increment: 1 } } });
    await tx.orderLog.create({ data: {
      orderId: operation.orderId, operatorId: activeActor.id, action: 'PAYROLL_PASS_CHANGE',
      changedFields: { payrollPassCount: { before: previous, after: input.passCount }, remark: { before: null, after: input.reason } },
      remark: `局部烫金计薪次数：${previous} → ${input.passCount}；款式 ${operation.sources.map((s) => s.orderItem?.sequence).join('、')}；${input.reason}`,
    } });
    return { orderId: operation.orderId };
  });
}
