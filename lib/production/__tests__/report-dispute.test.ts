import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Role } from '@/generated/prisma/enums';
const { tx } = vi.hoisted(() => {
  const tx = { user: { findFirst: vi.fn() }, productionReport: { findFirst: vi.fn() }, productionReportDispute: { findFirst: vi.fn(), create: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() }, orderLog: { create: vi.fn() }, $executeRaw: vi.fn(), $transaction: vi.fn() };
  return { tx };
});
vi.mock('@/lib/db', () => ({ db: tx }));
import { createReportDispute, reviewReportDispute, listOrderReportDisputes } from '../report-dispute';
const worker = { id: 'worker', role: Role.WORKER };
const admin = { id: 'admin', role: Role.ADMIN };
beforeEach(() => {
  vi.resetAllMocks();
  tx.$transaction.mockImplementation(async (fn) => fn(tx));
  tx.user.findFirst.mockResolvedValue({ id: 'active' });
  tx.productionReport.findFirst.mockResolvedValue({ id: 'report', operationId: 'op', operation: { orderId: 'order' } });
  tx.productionReportDispute.create.mockResolvedValue({ id: 'dispute' });
  tx.productionReportDispute.findUnique.mockResolvedValue({ id: 'dispute', reportId: 'report', status: 'PENDING', report: { operationId: 'op', operation: { orderId: 'order' } } });
});
describe('new report feedback authorization and lifecycle', () => {
  it('binds feedback to the signed-in reporter and records an audit log', async () => {
    await createReportDispute({ reportId: 'report', reason: '请核对装版费用' }, worker);
    expect(tx.productionReport.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'report', reporterId: 'worker' } }));
    expect(tx.orderLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ operatorId: 'worker', action: 'REPORT_DISPUTE_CREATED' }) }));
  });
  it('rejects other reporters, disabled accounts and non-workers', async () => {
    tx.productionReport.findFirst.mockResolvedValue(null);
    await expect(createReportDispute({ reportId: 'other', reason: '请核对装版费用' }, worker)).rejects.toThrow('不属于本人');
    tx.user.findFirst.mockResolvedValue(null);
    await expect(createReportDispute({ reportId: 'report', reason: '请核对装版费用' }, worker)).rejects.toThrow('无权');
    await expect(createReportDispute({ reportId: 'report', reason: '请核对装版费用' }, admin)).rejects.toThrow('无权');
    expect(tx.productionReportDispute.create).not.toHaveBeenCalled();
  });
  it('does not create duplicate pending feedback or accept blank reasons', async () => {
    tx.productionReportDispute.findFirst.mockResolvedValue({ id: 'existing' });
    await expect(createReportDispute({ reportId: 'report', reason: '请核对装版费用' }, worker)).rejects.toThrow('已有待处理');
    await expect(createReportDispute({ reportId: 'report', reason: ' ' }, worker)).rejects.toThrow('5–1000');
    expect(tx.productionReportDispute.create).not.toHaveBeenCalled();
  });
  it.each(['RESOLVED', 'REJECTED'] as const)('admin records %s once without rewriting payroll', async (decision) => {
    await reviewReportDispute({ disputeId: 'dispute', decision, resolution: '核对完成' }, admin);
    expect(tx.productionReportDispute.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: decision, resolvedById: 'admin' }) }));
    tx.productionReportDispute.findUnique.mockResolvedValue({ status: decision });
    await expect(reviewReportDispute({ disputeId: 'dispute', decision, resolution: '再次回复' }, admin)).rejects.toThrow('已处理');
    expect(tx.productionReportDispute.update).toHaveBeenCalledTimes(1);
  });
  it('denies worker review and access to all order disputes', async () => {
    await expect(reviewReportDispute({ disputeId: 'dispute', decision: 'RESOLVED', resolution: '自己解决' }, worker)).rejects.toThrow('无权');
    await expect(listOrderReportDisputes('order', worker)).rejects.toThrow('无权');
    expect(tx.productionReportDispute.update).not.toHaveBeenCalled();
    expect(tx.productionReportDispute.findMany).not.toHaveBeenCalled();
  });
  it('rejects invalid decisions even when called outside the action', async () => {
    await expect(reviewReportDispute({ disputeId: 'dispute', decision: 'RESOLVED', resolution: ' ' }, admin)).rejects.toThrow('2–1000');
    expect(tx.productionReportDispute.update).not.toHaveBeenCalled();
  });
});
