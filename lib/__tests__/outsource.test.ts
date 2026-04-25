import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  OrderStatus,
  OutsourceStatus,
  Role,
} from '../../generated/prisma/client';

const { dbMock } = vi.hoisted(() => {
  const mock = {
    order: { findUnique: vi.fn() },
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
  dbMock.order.findUnique.mockReset().mockResolvedValue({
    status: OrderStatus.IN_PRODUCTION,
  });
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

  // Codex round 87 / P2: SHIP / FINISHED / CANCELLED orders shouldn't
  // accept new outsource. Lib layer is the authoritative gate.
  it('throws when the parent order is missing', async () => {
    dbMock.order.findUnique.mockResolvedValue(null);
    await expect(
      createOutsourceOrder(baseInput, foremanActor),
    ).rejects.toThrow(/工单不存在/);
    expect(dbMock.outsourceOrder.create).not.toHaveBeenCalled();
  });

  it.each([
    OrderStatus.SHIPPED,
    OrderStatus.FINISHED,
    OrderStatus.CANCELLED,
  ])('refuses outsource creation when order status is %s', async (status) => {
    dbMock.order.findUnique.mockResolvedValue({ status });
    await expect(
      createOutsourceOrder(baseInput, foremanActor),
    ).rejects.toThrow(/不允许新建外协/);
    expect(dbMock.outsourceOrder.create).not.toHaveBeenCalled();
  });

  it.each([
    OrderStatus.DRAFT,
    OrderStatus.SUBMITTED,
    OrderStatus.SCHEDULING,
    OrderStatus.IN_PRODUCTION,
    OrderStatus.COMPLETED,
  ])('allows outsource creation when order status is %s', async (status) => {
    dbMock.order.findUnique.mockResolvedValue({ status });
    dbMock.outsourceOrder.create.mockResolvedValue({ id: 'o1' });
    await expect(
      createOutsourceOrder(baseInput, foremanActor),
    ).resolves.toEqual({ id: 'o1' });
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

describe('createOutsourceSchema — strict YYYY-MM-DD parsing (Codex round 41 / P1)', () => {
  // Not strictly a lib.outsource test, but belongs here because this
  // flow is the only consumer of optionalDateField today.
  it('rejects invalid calendar dates that new Date() would roll over', async () => {
    const { createOutsourceSchema } = await import('../auth/schemas');
    const bad = createOutsourceSchema.safeParse({
      ...baseInput,
      expectedDate: '2024-02-31',
    });
    expect(bad.success).toBe(false);
    if (!bad.success) {
      expect(bad.error.issues.some((i) => i.path[0] === 'expectedDate')).toBe(
        true,
      );
    }
  });

  it('rejects non-YYYY-MM-DD strings (e.g. "May 2026")', async () => {
    const { createOutsourceSchema } = await import('../auth/schemas');
    const bad = createOutsourceSchema.safeParse({
      ...baseInput,
      expectedDate: 'May 2026',
    });
    expect(bad.success).toBe(false);
  });

  it('accepts valid YYYY-MM-DD', async () => {
    const { createOutsourceSchema } = await import('../auth/schemas');
    const good = createOutsourceSchema.safeParse({
      ...baseInput,
      expectedDate: '2026-04-30',
    });
    expect(good.success).toBe(true);
  });

  it('accepts null / empty string', async () => {
    const { createOutsourceSchema } = await import('../auth/schemas');
    const a = createOutsourceSchema.safeParse({
      ...baseInput,
      expectedDate: null,
    });
    expect(a.success).toBe(true);
    const b = createOutsourceSchema.safeParse({
      ...baseInput,
      expectedDate: '',
    });
    expect(b.success).toBe(true);
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
