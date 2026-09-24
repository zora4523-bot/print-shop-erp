import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MachineType,
  OrderStatus,
  PieceworkOperationType,
  ProductionOperationStatus,
  Role,
  WorkerType,
} from '../../../generated/prisma/enums';

const dbMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  order: { findFirst: vi.fn() },
}));
vi.mock('@/lib/db', () => ({ db: dbMock }));

import { getOrderPrintScope, getOrderPrintTitleRef } from '../print-access';

beforeEach(() => {
  vi.resetAllMocks();
  dbMock.user.findUnique.mockResolvedValue({ role: Role.ADMIN, isActive: true, workerType: null, machineType: null });
  dbMock.order.findFirst.mockResolvedValue({ workOrderVersion: 3 });
});

describe('current production print access', () => {
  it.each([Role.SALES, 'UNKNOWN' as Role])('rejects role %s before loading order or title', async (role) => {
    await expect(getOrderPrintScope('order-1', { id: 'user-1', role })).resolves.toBeNull();
    await expect(getOrderPrintTitleRef('order-1', { id: 'user-1', role })).resolves.toBeNull();
    expect(dbMock.order.findFirst).not.toHaveBeenCalled();
    expect(dbMock.user.findUnique).not.toHaveBeenCalled();
  });

  it.each([null, { role: Role.ADMIN, isActive: false }, { role: Role.SALES, isActive: true }])('rejects a missing, disabled or changed account (%j)', async (account) => {
    dbMock.user.findUnique.mockResolvedValue(account);
    await expect(getOrderPrintTitleRef('order-1', { id: 'user-1', role: Role.ADMIN })).resolves.toBeNull();
    expect(dbMock.order.findFirst).not.toHaveBeenCalled();
  });

  it('allows an active administrator and restricts customer service to its submissions', async () => {
    await expect(getOrderPrintScope('order-1', { id: 'admin-1', role: Role.ADMIN })).resolves.toEqual({ id: 'order-1' });
    dbMock.user.findUnique.mockResolvedValue({ role: Role.CUSTOMER_SERVICE, isActive: true });
    await expect(getOrderPrintScope('order-1', { id: 'cs-1', role: Role.CUSTOMER_SERVICE })).resolves.toEqual({ id: 'order-1', submitterId: 'cs-1' });
    dbMock.order.findFirst.mockResolvedValue(null);
    await expect(getOrderPrintTitleRef('other-order', { id: 'cs-1', role: Role.CUSTOMER_SERVICE })).resolves.toBeNull();
    expect(dbMock.order.findFirst).toHaveBeenCalledWith({ where: { id: 'other-order', submitterId: 'cs-1' }, select: { orderNo: true } });
  });

  it.each([
    [WorkerType.MACHINE, MachineType.HAND_PRESS, PieceworkOperationType.PARTIAL],
    [WorkerType.MACHINE, MachineType.WINDMILL, PieceworkOperationType.FULL],
    [WorkerType.PACKER, null, PieceworkOperationType.PACKING],
    [WorkerType.MACHINE, MachineType.GLUE, null],
  ])('limits %s/%s to current, non-cancelled lane %s or public progress', async (workerType, machineType, operationType) => {
    dbMock.user.findUnique.mockResolvedValue({ role: Role.WORKER, isActive: true, workerType, machineType });
    const scope = await getOrderPrintScope('order-1', { id: 'worker-1', role: Role.WORKER });
    const currentStep = { workOrderVersion: 3, status: { not: ProductionOperationStatus.CANCELLED } };
    expect(scope).toEqual({
      id: 'order-1', workOrderVersion: 3,
      status: { not: OrderStatus.SUBMITTED },
      OR: [
        ...(operationType ? [{ productionOperations: { some: { ...currentStep, operationType } } }] : []),
        { productionProgressSteps: { some: currentStep } },
      ],
    });
    expect(JSON.stringify(scope)).not.toContain('tasks');
    expect(JSON.stringify(scope)).not.toContain('workerId');
  });

  it('does not reveal a title when the current version has no authorized operations', async () => {
    dbMock.user.findUnique.mockResolvedValue({ role: Role.WORKER, isActive: true, workerType: WorkerType.MACHINE, machineType: MachineType.HAND_PRESS });
    dbMock.order.findFirst.mockResolvedValueOnce({ workOrderVersion: 3 }).mockResolvedValueOnce(null);
    await expect(getOrderPrintTitleRef('order-1', { id: 'worker-1', role: Role.WORKER })).resolves.toBeNull();
    expect(dbMock.order.findFirst).toHaveBeenLastCalledWith({
      where: expect.objectContaining({ id: 'order-1', workOrderVersion: 3 }),
      select: { orderNo: true },
    });
  });
});
