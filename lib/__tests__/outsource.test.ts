import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OutsourceStatus, Role } from '../../generated/prisma/client';

const { dbMock } = vi.hoisted(() => {
  const mock = {
    outsourceOrder: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  };
  return { dbMock: mock };
});
vi.mock('@/lib/db', () => ({ db: dbMock }));

import {
  createOutsourceOrder,
  markOutsourceReceived,
  cancelOutsourceOrder,
  OutsourceError,
  InvalidOutsourceTransitionError,
} from '../outsource';

const foremanActor = { id: 'foreman-1', role: Role.FOREMAN };

beforeEach(() => {
  dbMock.outsourceOrder.findUnique.mockReset();
  dbMock.outsourceOrder.findMany.mockReset();
  dbMock.outsourceOrder.create.mockReset();
  dbMock.outsourceOrder.update.mockReset();
});

const baseInput = {
  orderId: 'order-1',
  orderItemIds: ['item-1'],
  supplierName: '东方印刷厂',
  supplierContact: '13800000000',
  craftDescription: 'UV',
  specialRequirement: null,
  totalQty: 5000,
  expectedDate: new Date('2026-05-01'),
  amount: '500',
  remark: null,
};

describe('createOutsourceOrder', () => {
  it('creates with SENT status and Decimal-formatted amount', async () => {
    dbMock.outsourceOrder.create.mockResolvedValue({ id: 'outsource-1' });
    const r = await createOutsourceOrder(baseInput, foremanActor);
    expect(r.id).toBe('outsource-1');
    const data = dbMock.outsourceOrder.create.mock.calls[0][0].data as {
      status: OutsourceStatus;
      amount: string | null;
      supplierName: string;
      orderItemIds: string[];
    };
    expect(data.status).toBe(OutsourceStatus.SENT);
    expect(data.amount).toBe('500.00');
    expect(data.orderItemIds).toEqual(['item-1']);
    expect(data.supplierName).toBe('东方印刷厂');
  });

  it('persists null amount when input is null', async () => {
    dbMock.outsourceOrder.create.mockResolvedValue({ id: 'outsource-1' });
    await createOutsourceOrder(
      { ...baseInput, amount: null },
      foremanActor,
    );
    const data = dbMock.outsourceOrder.create.mock.calls[0][0].data;
    expect(data.amount).toBeNull();
  });
});

describe('markOutsourceReceived', () => {
  it('throws OutsourceError when the outsource order is missing', async () => {
    dbMock.outsourceOrder.findUnique.mockResolvedValue(null);
    await expect(
      markOutsourceReceived('ghost', { actualDate: null }, foremanActor),
    ).rejects.toBeInstanceOf(OutsourceError);
  });

  it('transitions SENT → RECEIVED and stamps actualDate from the injected clock', async () => {
    dbMock.outsourceOrder.findUnique.mockResolvedValue({
      id: 'outsource-1',
      status: OutsourceStatus.SENT,
    });
    dbMock.outsourceOrder.update.mockResolvedValue({
      id: 'outsource-1',
      status: OutsourceStatus.RECEIVED,
    });
    const now = new Date('2026-05-01T12:00:00Z');
    const r = await markOutsourceReceived(
      'outsource-1',
      { actualDate: null },
      foremanActor,
      now,
    );
    expect(r.status).toBe(OutsourceStatus.RECEIVED);
    const data = dbMock.outsourceOrder.update.mock.calls[0][0].data;
    expect(data.status).toBe(OutsourceStatus.RECEIVED);
    expect(data.actualDate).toBe(now);
  });

  it('honors an explicit actualDate from the caller', async () => {
    dbMock.outsourceOrder.findUnique.mockResolvedValue({
      id: 'outsource-1',
      status: OutsourceStatus.SENT,
    });
    dbMock.outsourceOrder.update.mockResolvedValue({
      id: 'outsource-1',
      status: OutsourceStatus.RECEIVED,
    });
    const actualDate = new Date('2026-04-29');
    await markOutsourceReceived(
      'outsource-1',
      { actualDate },
      foremanActor,
    );
    expect(dbMock.outsourceOrder.update.mock.calls[0][0].data.actualDate).toBe(
      actualDate,
    );
  });

  it('refuses to re-receive a RECEIVED record', async () => {
    dbMock.outsourceOrder.findUnique.mockResolvedValue({
      id: 'outsource-1',
      status: OutsourceStatus.RECEIVED,
    });
    await expect(
      markOutsourceReceived('outsource-1', { actualDate: null }, foremanActor),
    ).rejects.toBeInstanceOf(InvalidOutsourceTransitionError);
  });

  it('refuses to receive a CANCELLED record (terminal)', async () => {
    dbMock.outsourceOrder.findUnique.mockResolvedValue({
      id: 'outsource-1',
      status: OutsourceStatus.CANCELLED,
    });
    await expect(
      markOutsourceReceived('outsource-1', { actualDate: null }, foremanActor),
    ).rejects.toBeInstanceOf(InvalidOutsourceTransitionError);
  });
});

describe('cancelOutsourceOrder', () => {
  it('cancels from SENT', async () => {
    dbMock.outsourceOrder.findUnique.mockResolvedValue({
      id: 'outsource-1',
      status: OutsourceStatus.SENT,
    });
    dbMock.outsourceOrder.update.mockResolvedValue({
      id: 'outsource-1',
      status: OutsourceStatus.CANCELLED,
    });
    const r = await cancelOutsourceOrder('outsource-1', foremanActor);
    expect(r.status).toBe(OutsourceStatus.CANCELLED);
  });

  it('cancels from IN_PROGRESS', async () => {
    dbMock.outsourceOrder.findUnique.mockResolvedValue({
      id: 'outsource-1',
      status: OutsourceStatus.IN_PROGRESS,
    });
    dbMock.outsourceOrder.update.mockResolvedValue({
      id: 'outsource-1',
      status: OutsourceStatus.CANCELLED,
    });
    const r = await cancelOutsourceOrder('outsource-1', foremanActor);
    expect(r.status).toBe(OutsourceStatus.CANCELLED);
  });

  it('refuses to cancel a RECEIVED record (goods already arrived)', async () => {
    dbMock.outsourceOrder.findUnique.mockResolvedValue({
      id: 'outsource-1',
      status: OutsourceStatus.RECEIVED,
    });
    await expect(
      cancelOutsourceOrder('outsource-1', foremanActor),
    ).rejects.toBeInstanceOf(InvalidOutsourceTransitionError);
  });
});
