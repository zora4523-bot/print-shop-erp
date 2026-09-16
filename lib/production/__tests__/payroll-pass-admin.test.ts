import { beforeEach, describe, expect, it, vi } from 'vitest';
const { tx, authorize } = vi.hoisted(() => ({
  authorize: vi.fn(),
  tx: { productionOperation: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn() }, orderLog: { create: vi.fn() }, $executeRaw: vi.fn(), $transaction: vi.fn() },
}));
vi.mock('@/lib/db', () => ({ db: tx }));
vi.mock('@/lib/salary/piecework-price-book-admin', () => ({ assertActivePieceworkAdmin: authorize }));
import { updatePayrollPassCount } from '../payroll-pass-admin';
const actor = { id: 'admin', role: 'ADMIN' as const, username: 'admin', displayName: '管理员' };
const input = { operationId: 'op', expectedRevision: 0, passCount: 3, reason: '实际三次' };
function operation(extra = {}) {
  return { id: 'op', orderId: 'order', operationType: 'PARTIAL', workOrderVersion: 1, status: 'PENDING', payrollRevision: 0, payrollPassCount: null,
    order: { workOrderVersion: 1, status: 'RELEASED' }, sources: [{ orderItem: { sequence: 1, frontFoilColors: ['金'], backFoilColors: ['红'] } }], ...extra };
}
beforeEach(() => {
  vi.resetAllMocks();
  tx.$transaction.mockImplementation((fn) => fn(tx)); authorize.mockResolvedValue(actor);
  tx.productionOperation.findUnique.mockResolvedValue({ orderId: 'order' });
  tx.productionOperation.findUniqueOrThrow.mockResolvedValue(operation());
});
describe('管理员调整计薪次数', () => {
  it('同事务锁定并修改当前工序、记录前后数值与原因', async () => {
    await updatePayrollPassCount(input, actor);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(2);
    expect(tx.productionOperation.update).toHaveBeenCalledWith({ where: { id: 'op' }, data: { payrollPassCount: 3, payrollRevision: { increment: 1 } } });
    expect(tx.orderLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ operatorId: 'admin', changedFields: expect.objectContaining({ payrollPassCount: { before: 2, after: 3 } }) }) }));
  });
  it('重复保存相同数值不新增记录', async () => {
    await updatePayrollPassCount({ ...input, passCount: 2 }, actor);
    expect(tx.productionOperation.update).not.toHaveBeenCalled();
  });
  it.each([0, -1, 1.5, 1000, NaN])('拒绝非法次数 %s', async (passCount) => {
    await expect(updatePayrollPassCount({ ...input, passCount }, actor)).rejects.toThrow('次数须');
    expect(tx.$transaction).not.toHaveBeenCalled();
  });
  it('拒绝越权用户', async () => {
    authorize.mockRejectedValue(new Error('权限不足'));
    await expect(updatePayrollPassCount(input, actor)).rejects.toThrow('权限不足');
    expect(tx.productionOperation.update).not.toHaveBeenCalled();
  });
  it.each([{ operationType: 'FULL' }, { status: 'COMPLETED' }, { workOrderVersion: 2 }, { order: { workOrderVersion: 1, status: 'CANCELLED' } }])('拒绝不允许编辑的工序 %j', async (extra) => {
    tx.productionOperation.findUniqueOrThrow.mockResolvedValue(operation(extra));
    await expect(updatePayrollPassCount(input, actor)).rejects.toThrow('不能调整');
    expect(tx.productionOperation.update).not.toHaveBeenCalled();
  });
  it('拒绝旧版本表单覆盖', async () => {
    tx.productionOperation.findUniqueOrThrow.mockResolvedValue(operation({ payrollRevision: 1 }));
    await expect(updatePayrollPassCount(input, actor)).rejects.toThrow('已被修改');
  });
  it('缺少款式来源时拒绝', async () => {
    tx.productionOperation.findUniqueOrThrow.mockResolvedValue(operation({ sources: [] }));
    await expect(updatePayrollPassCount(input, actor)).rejects.toThrow('不一致');
  });
});
