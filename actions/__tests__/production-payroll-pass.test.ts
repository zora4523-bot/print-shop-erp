import { beforeEach, expect, it, vi } from 'vitest';
const { permission, update, revalidate } = vi.hoisted(() => ({ permission: vi.fn(), update: vi.fn(), revalidate: vi.fn() }));
vi.mock('@/lib/auth/permissions', () => ({ requirePermission: permission }));
vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('next/cache', () => ({ revalidatePath: revalidate }));
vi.mock('@/lib/production/payroll-pass-admin', async (original) => ({ ...await original<typeof import('@/lib/production/payroll-pass-admin')>(), updatePayrollPassCount: update }));
import { updatePayrollPassAction } from '../production-payroll-pass';
const actor = { id: 'admin', role: 'ADMIN', username: 'admin', displayName: '管理员' };
function form() { const f = new FormData(); Object.entries({ operationId: 'op', expectedRevision: '0', passCount: '3', reason: '加工三次' }).forEach(([k, v]) => f.set(k, v)); return f; }
beforeEach(() => { vi.clearAllMocks(); permission.mockResolvedValue(actor); update.mockResolvedValue({ orderId: 'order' }); });
it('先授权，再传递管理员身份，成功刷新工单与师傅页面', async () => {
  expect(await updatePayrollPassAction(null, form())).toMatchObject({ status: 'success' });
  expect(permission).toHaveBeenCalledWith('salary:rule:manage');
  expect(update).toHaveBeenCalledWith({ operationId: 'op', expectedRevision: 0, passCount: 3, reason: '加工三次' }, actor);
  expect(revalidate).toHaveBeenCalledWith('/worker/tasks/op');
});
it('无权限拒绝写入', async () => {
  permission.mockRejectedValueOnce(new Error('Forbidden'));
  await expect(updatePayrollPassAction(null, form())).rejects.toThrow('Forbidden');
  expect(update).not.toHaveBeenCalled();
});
it('非法输入返回字段错误', async () => {
  const f = form(); f.set('passCount', '1.5');
  expect(await updatePayrollPassAction(null, f)).toMatchObject({ status: 'error', fieldErrors: { passCount: expect.any(Array) } });
  expect(update).not.toHaveBeenCalled();
});
