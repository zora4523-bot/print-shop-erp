import Decimal from 'decimal.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Role } from '@/generated/prisma/enums';
import { batchOrder } from '@/components/business/order/__tests__/admin-order-batch-fixture';

const { workspaceMock, inlineMock, printJobsMock, reportsMock, currentOrderMock } = vi.hoisted(() => ({
  workspaceMock: vi.fn(), inlineMock: vi.fn(), printJobsMock: vi.fn(),
  reportsMock: vi.fn(), currentOrderMock: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', () => ({ db: {
  orderPrintJob: { findMany: printJobsMock },
  productionWorkOrderProgress: { findMany: reportsMock },
  order: { findUnique: currentOrderMock },
} }));
vi.mock('@/lib/order/admin-workspace', () => ({ getAdminOrderByOrderNo: workspaceMock }));
vi.mock('@/lib/order/admin-inline-operations', () => ({ getAdminOrderInlineOperations: inlineMock }));

import { getAdminOrderDetailPresentation } from '../admin-detail-query';

const actor = { id: 'admin-1', role: Role.ADMIN };
const order = {
  id: 'order-1', orderNo: 'GD-260907-001', revision: 4,
  editVersion: 3, workOrderVersion: 2, priceRevision: 7,
};

beforeEach(() => {
  vi.resetAllMocks();
  workspaceMock.mockResolvedValue(batchOrder({ editVersion: 3 }));
  inlineMock.mockResolvedValue(null);
  printJobsMock.mockResolvedValue([]);
  reportsMock.mockResolvedValue([]);
  currentOrderMock.mockResolvedValue({ revision: 4, editVersion: 3, workOrderVersion: 2, priceRevision: 7 });
});

describe('admin order detail presentation query', () => {
  it.each([Role.SALES, Role.CUSTOMER_SERVICE, Role.WORKER])('rejects %s before reading any commercial, address or production data', async (role) => {
    await expect(getAdminOrderDetailPresentation({ id: 'other-user', role }, order)).rejects.toThrow('仅管理员');
    expect(workspaceMock).not.toHaveBeenCalled();
    expect(inlineMock).not.toHaveBeenCalled();
    expect(printJobsMock).not.toHaveBeenCalled();
    expect(reportsMock).not.toHaveBeenCalled();
    expect(currentOrderMock).not.toHaveBeenCalled();
  });

  it('returns no presentation for a missing order before reading its supplementary records', async () => {
    workspaceMock.mockResolvedValue(null);
    expect(await getAdminOrderDetailPresentation(actor, order)).toBeNull();
    expect(workspaceMock).toHaveBeenCalledExactlyOnceWith(actor, order.orderNo);
    expect(inlineMock).not.toHaveBeenCalled();
    expect(printJobsMock).not.toHaveBeenCalled();
    expect(reportsMock).not.toHaveBeenCalled();
  });

  it.each([
    { revision: 5 }, { editVersion: 4 }, { workOrderVersion: 3 }, { priceRevision: 8 },
  ])('discards stale supplementary data after concurrent order change %j', async (changed) => {
    currentOrderMock.mockResolvedValue({ ...order, ...changed });
    expect(await getAdminOrderDetailPresentation(actor, order)).toBeNull();
    expect(currentOrderMock).toHaveBeenCalledWith({
      where: { id: order.id },
      select: { revision: true, editVersion: true, workOrderVersion: true, priceRevision: true },
    });
  });

  it.each([
    { id: 'other-order' }, { revision: 5 }, { editVersion: 4 }, { workOrderVersion: 3 },
  ])('does not join a mismatched workspace snapshot %j', async (changed) => {
    workspaceMock.mockResolvedValue(batchOrder({ editVersion: 3, ...changed }));
    expect(await getAdminOrderDetailPresentation(actor, order)).toBeNull();
  });

  it('returns null if the order was removed during its independently guarded reads', async () => {
    currentOrderMock.mockResolvedValue(null);
    expect(await getAdminOrderDetailPresentation(actor, order)).toBeNull();
  });

  it('projects immutable print requests with their resolution state and timestamp', async () => {
    const requestedAt = new Date('2026-09-07T01:00:00Z');
    const resolvedAt = new Date('2026-09-07T02:15:00Z');
    printJobsMock.mockResolvedValue([
      { id: 'pending', workOrderVersion: 2, state: 'PENDING', createdAt: requestedAt, resolution: null },
      { id: 'printed', workOrderVersion: 2, state: 'PENDING', createdAt: requestedAt, resolution: { state: 'PRINTED', createdAt: resolvedAt } },
      { id: 'old-request', workOrderVersion: 1, state: 'PENDING', createdAt: requestedAt, resolution: { state: 'SUPERSEDED', createdAt: resolvedAt } },
    ]);
    const result = await getAdminOrderDetailPresentation(actor, order);
    expect(result?.prints).toEqual([
      { id: 'pending', version: 2, state: 'PENDING', at: '2026/09/07 09:00' },
      { id: 'printed', version: 2, state: 'PRINTED', at: '2026/09/07 10:15' },
      { id: 'old-request', version: 1, state: 'SUPERSEDED', at: '2026/09/07 10:15' },
    ]);
    expect(printJobsMock).toHaveBeenCalledWith(expect.objectContaining({
      where: { orderId: order.id, requestJobId: null },
      select: expect.objectContaining({ resolution: { select: { state: true, createdAt: true } } }),
    }));
  });

  it('reads only the current production-version ledger and does not fabricate cumulative progress from a limited page', async () => {
    const reportedAt = new Date('2026-09-07T03:00:00Z');
    reportsMock.mockResolvedValue([{
      id: 'report-1', workOrderVersion: 2, stage: 'FOILING', reportedAt,
      workOrderProgressQuantity: new Decimal('123456789.000'), reporter: { displayName: '烫金师傅' },
    }]);
    const result = await getAdminOrderDetailPresentation(actor, order);
    expect(reportsMock).toHaveBeenCalledWith({
      where: { orderId: order.id, workOrderVersion: order.workOrderVersion },
      orderBy: [{ reportedAt: 'desc' }, { id: 'desc' }], take: 100,
      select: {
        id: true, reportedAt: true, stage: true, workOrderProgressQuantity: true,
        workOrderVersion: true, reporter: { select: { displayName: true } },
      },
    });
    expect(result?.workReports).toEqual([{
      id: 'report-1', workOrderVersion: 2, stage: 'FOILING', reportedAt,
      quantity: '123456789', reporterName: '烫金师傅', cumulative: null,
    }]);
    expect(result?.workspace.progress).toEqual(batchOrder().progress);
  });

  it('attaches only the guarded inline-operation result to the matching workspace', async () => {
    const inline = { pricing: null, fulfillment: null, shipping: null };
    inlineMock.mockResolvedValue(inline);
    const result = await getAdminOrderDetailPresentation(actor, order);
    expect(inlineMock).toHaveBeenCalledExactlyOnceWith(actor, batchOrder({ editVersion: 3 }));
    expect(result?.workspace.inlineOperations).toBe(inline);
    expect(result?.workspace.id).toBe(order.id);
  });
});
