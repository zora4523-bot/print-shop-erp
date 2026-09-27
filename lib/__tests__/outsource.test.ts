import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  OrderSettlementType,
  OrderStatus,
  OutsourceStatus,
  Role,
  TaskStatus,
} from '../../generated/prisma/enums';

const { dbMock } = vi.hoisted(() => {
  const mock = {
    order: { findUnique: vi.fn(), update: vi.fn() },
    orderItem: { findMany: vi.fn() },
    craft: { findMany: vi.fn() },
    productionTask: { findMany: vi.fn() },
    productionOperation: { findMany: vi.fn() },
    productionProgressStep: { findMany: vi.fn() },
    orderLog: { create: vi.fn() },
    outsourceOrder: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    outsourceAmountChange: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    outsourcePayment: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    businessAuditLog: { create: vi.fn() },
    $executeRaw: vi.fn().mockResolvedValue(undefined),
    $transaction: vi.fn(async (fn: unknown) => {
      if (typeof fn === 'function')
        return await (fn as (tx: unknown) => unknown)(mock);
      return fn;
    }),
  };
  return { dbMock: mock };
});
vi.mock('@/lib/db', () => ({ db: dbMock }));
const { notifyMock } = vi.hoisted(() => ({
  notifyMock: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/notification/dispatch', () => ({
  dispatchNotification: notifyMock,
}));

import {
  createOutsourceOrder,
  confirmOutsourceAmount,
  recordOutsourcePayment,
  markOutsourceReceived,
  cancelOutsourceOrder,
  getOutsourceOrderDetail,
  OutsourceError,
  InvalidOutsourceTransitionError,
} from '../outsource';

const foremanActor = {
  id: 'foreman-1',
  username: 'admin',
  displayName: '管理员',
  role: Role.ADMIN,
};

beforeEach(() => {
  dbMock.order.findUnique.mockReset().mockResolvedValue({
    status: OrderStatus.IN_PRODUCTION,
  });
  dbMock.order.update.mockReset().mockResolvedValue({});
  // sequence / name / crafts 是完工闸口的款式级覆盖校验要读的字段，
  // 缺了会在 item.crafts.some 上炸——mock 缺什么测试当场报错，是特性。
  dbMock.orderItem.findMany.mockReset().mockResolvedValue([
    {
      id: 'item-1',
      orderId: 'order-1',
      quantity: 5000,
      sequence: 1,
      name: '款式一',
      crafts: ['craft-uv'],
    },
  ]);
  dbMock.craft.findMany
    .mockReset()
    .mockResolvedValue([{ id: 'craft-uv', isOutsource: true }]);
  dbMock.productionTask.findMany.mockReset().mockResolvedValue([]);
  dbMock.productionOperation.findMany.mockReset().mockResolvedValue([]);
  dbMock.productionProgressStep.findMany.mockReset().mockResolvedValue([]);
  dbMock.orderLog.create.mockReset().mockResolvedValue({});
  dbMock.outsourceOrder.findUnique.mockReset().mockResolvedValue(null);
  dbMock.outsourceOrder.findMany.mockReset();
  dbMock.outsourceOrder.create.mockReset();
  dbMock.outsourceOrder.update.mockReset();
  dbMock.outsourceAmountChange.findUnique.mockReset().mockResolvedValue(null);
  dbMock.outsourceAmountChange.create.mockReset();
  dbMock.outsourcePayment.findUnique.mockReset().mockResolvedValue(null);
  dbMock.outsourcePayment.create
    .mockReset()
    .mockResolvedValue({ id: 'payment-1' });
  dbMock.businessAuditLog.create.mockReset().mockResolvedValue({ id: 'audit-1' });
  dbMock.$executeRaw.mockReset().mockResolvedValue(undefined);
  dbMock.$transaction.mockReset().mockImplementation(async (fn: unknown) => {
    if (typeof fn === 'function')
      return await (fn as (tx: unknown) => unknown)(dbMock);
    return fn;
  });
  notifyMock.mockReset().mockResolvedValue(undefined);
});

const baseInput = {
  idempotencyKey: '00000000-0000-4000-8000-000000000001',
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
      idempotencyKey: string;
      createdById: string;
      totalQty: number;
      itemSnapshots: {
        create: Array<{ orderItemId: string; quantity: number }>;
      };
    };
    expect(data.status).toBe(OutsourceStatus.SENT);
    expect(data.amount).toBe('500.00');
    expect(data.orderItemIds).toEqual(['item-1']);
    expect(data.supplierName).toBe('东方印刷厂');
    expect(data.idempotencyKey).toBe(baseInput.idempotencyKey);
    expect(data.createdById).toBe(foremanActor.id);
    expect(data.totalQty).toBe(5000);
    expect(data.itemSnapshots.create).toEqual([
      { orderItemId: 'item-1', quantity: 5000 },
    ]);
    expect(dbMock.businessAuditLog.create).toHaveBeenCalledTimes(1);
  });

  it('derives total quantity from every selected item and stores canonical item order', async () => {
    dbMock.orderItem.findMany.mockResolvedValue([
      { id: 'item-2', orderId: 'order-1', quantity: 1250 },
      { id: 'item-1', orderId: 'order-1', quantity: 5000 },
    ]);
    dbMock.outsourceOrder.create.mockResolvedValue({ id: 'outsource-1' });

    await createOutsourceOrder(
      {
        ...baseInput,
        orderItemIds: ['item-2', 'item-1'],
        totalQty: 6250,
      },
      foremanActor,
    );

    expect(dbMock.outsourceOrder.create.mock.calls[0][0].data).toMatchObject({
      orderItemIds: ['item-1', 'item-2'],
      totalQty: 6250,
    });
    expect(dbMock.businessAuditLog.create.mock.calls[0][0].data.after).toMatchObject({
      orderItemIds: ['item-1', 'item-2'],
      totalQty: 6250,
    });
  });

  it('rejects a duplicate item even when called without the action schema', async () => {
    await expect(
      createOutsourceOrder(
        { ...baseInput, orderItemIds: ['item-1', 'item-1'], totalQty: 10000 },
        foremanActor,
      ),
    ).rejects.toThrow(/不能重复选择/);
    expect(dbMock.orderItem.findMany).not.toHaveBeenCalled();
    expect(dbMock.outsourceOrder.create).not.toHaveBeenCalled();
  });

  it('rejects a selected item that no longer exists', async () => {
    dbMock.orderItem.findMany.mockResolvedValue([]);
    await expect(
      createOutsourceOrder(baseInput, foremanActor),
    ).rejects.toThrow(/不存在或已被删除/);
    expect(dbMock.outsourceOrder.create).not.toHaveBeenCalled();
  });

  it('rejects an item belonging to another order', async () => {
    dbMock.orderItem.findMany.mockResolvedValue([
      { id: 'item-1', orderId: 'order-other', quantity: 5000 },
    ]);
    await expect(
      createOutsourceOrder(baseInput, foremanActor),
    ).rejects.toThrow(/不属于当前工单/);
    expect(dbMock.outsourceOrder.create).not.toHaveBeenCalled();
  });

  it('rejects a client total that differs from the selected item quantities', async () => {
    await expect(
      createOutsourceOrder(
        { ...baseInput, totalQty: 4999 },
        foremanActor,
      ),
    ).rejects.toThrow(/必须等于所选款式合计 5000/);
    expect(dbMock.outsourceOrder.create).not.toHaveBeenCalled();
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
    OrderStatus.COMPLETED,
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
  ])('allows outsource creation when order status is %s', async (status) => {
    dbMock.order.findUnique.mockResolvedValue({ status });
    dbMock.outsourceOrder.create.mockResolvedValue({ id: 'o1' });
    await expect(
      createOutsourceOrder(baseInput, foremanActor),
    ).resolves.toEqual({ id: 'o1' });
  });

  it.each([OrderStatus.PACKING, OrderStatus.ON_HOLD])(
    'refuses new outsource after canonical production readiness is recorded in %s',
    async (status) => {
    dbMock.order.findUnique.mockResolvedValue({
      status,
      completedAt: new Date('2026-09-02T03:00:00.000Z'),
    });

    await expect(
      createOutsourceOrder(baseInput, foremanActor),
    ).rejects.toThrow(/已完成生产.*工单变更/);
    expect(dbMock.outsourceOrder.create).not.toHaveBeenCalled();
    },
  );

  // Codex round 88 / P2: status check + insert must be atomic vs.
  // ship/cancel on the same order. Lock taken inside the same tx.
  it('takes the per-order advisory lock as the first DB call', async () => {
    dbMock.outsourceOrder.create.mockResolvedValue({ id: 'o1' });
    await createOutsourceOrder(baseInput, foremanActor);
    expect(dbMock.$executeRaw).toHaveBeenCalledTimes(2);
    const sql = (dbMock.$executeRaw.mock.calls[0]![0] as TemplateStringsArray).join(
      '?',
    );
    expect(sql).toMatch(/pg_advisory_xact_lock/);
    // Same key as transitionWithLog + operation materialization so all
    // writers serialize through one lock per order.
    expect(dbMock.$executeRaw.mock.calls[0]![1]).toBe(
      `print-shop-erp:order-cascade:${baseInput.orderId}`,
    );
    expect(dbMock.$executeRaw.mock.calls[1]![1]).toBe(
      `print-shop-erp:outsource-create:${baseInput.idempotencyKey}`,
    );
  });

  it('returns an exact same-key replay without a second insert or audit row', async () => {
    dbMock.outsourceOrder.findUnique.mockResolvedValue({
      id: 'outsource-existing',
      orderId: baseInput.orderId,
      orderItemIds: baseInput.orderItemIds,
      supplierName: baseInput.supplierName,
      supplierContact: baseInput.supplierContact,
      craftDescription: baseInput.craftDescription,
      specialRequirement: baseInput.specialRequirement,
      totalQty: baseInput.totalQty,
      expectedDate: baseInput.expectedDate,
      amount: '500.00',
      remark: baseInput.remark,
      createdById: foremanActor.id,
      itemSnapshots: [],
    });

    await expect(
      createOutsourceOrder(baseInput, foremanActor),
    ).resolves.toEqual({ id: 'outsource-existing' });
    expect(dbMock.order.findUnique).not.toHaveBeenCalled();
    expect(dbMock.outsourceOrder.create).not.toHaveBeenCalled();
    expect(dbMock.businessAuditLog.create).not.toHaveBeenCalled();
  });

  it('replays from immutable snapshots after source item quantities changed', async () => {
    dbMock.orderItem.findMany.mockResolvedValue([
      { id: 'item-1', orderId: 'order-1', quantity: 6000 },
    ]);
    dbMock.outsourceOrder.findUnique.mockResolvedValue({
      id: 'outsource-existing',
      orderId: baseInput.orderId,
      orderItemIds: baseInput.orderItemIds,
      supplierName: baseInput.supplierName,
      supplierContact: baseInput.supplierContact,
      craftDescription: baseInput.craftDescription,
      specialRequirement: baseInput.specialRequirement,
      totalQty: 5000,
      expectedDate: baseInput.expectedDate,
      amount: '500.00',
      remark: baseInput.remark,
      createdById: foremanActor.id,
      itemSnapshots: [{ orderItemId: 'item-1', quantity: 5000 }],
    });

    await expect(
      createOutsourceOrder(baseInput, foremanActor),
    ).resolves.toEqual({ id: 'outsource-existing' });
    expect(dbMock.orderItem.findMany).not.toHaveBeenCalled();
    expect(dbMock.outsourceOrder.create).not.toHaveBeenCalled();
  });

  it('replays after canonicalizing item order and reading a null total from snapshots', async () => {
    dbMock.orderItem.findMany.mockResolvedValue([
      { id: 'item-2', orderId: 'order-1', quantity: 1250 },
      { id: 'item-1', orderId: 'order-1', quantity: 5000 },
    ]);
    dbMock.outsourceOrder.findUnique.mockResolvedValue({
      id: 'outsource-existing',
      orderId: baseInput.orderId,
      orderItemIds: ['item-2', 'item-1'],
      supplierName: baseInput.supplierName,
      supplierContact: baseInput.supplierContact,
      craftDescription: baseInput.craftDescription,
      specialRequirement: baseInput.specialRequirement,
      totalQty: null,
      expectedDate: baseInput.expectedDate,
      amount: '500.00',
      remark: baseInput.remark,
      createdById: foremanActor.id,
      itemSnapshots: [
        { orderItemId: 'item-2', quantity: 1250 },
        { orderItemId: 'item-1', quantity: 5000 },
      ],
    });

    await expect(
      createOutsourceOrder(
        {
          ...baseInput,
          orderItemIds: ['item-1', 'item-2'],
          totalQty: 6250,
        },
        foremanActor,
      ),
    ).resolves.toEqual({ id: 'outsource-existing' });
    expect(dbMock.order.findUnique).not.toHaveBeenCalled();
    expect(dbMock.outsourceOrder.create).not.toHaveBeenCalled();
  });

  it('fails closed when a null-total historical replay has no quantity evidence', async () => {
    dbMock.outsourceOrder.findUnique.mockResolvedValue({
      id: 'outsource-existing',
      orderId: baseInput.orderId,
      orderItemIds: baseInput.orderItemIds,
      supplierName: baseInput.supplierName,
      supplierContact: baseInput.supplierContact,
      craftDescription: baseInput.craftDescription,
      specialRequirement: baseInput.specialRequirement,
      totalQty: null,
      expectedDate: baseInput.expectedDate,
      amount: '500.00',
      remark: baseInput.remark,
      createdById: foremanActor.id,
      itemSnapshots: [],
    });

    await expect(
      createOutsourceOrder(baseInput, foremanActor),
    ).rejects.toThrow(/缺少创建时数量证据/);
    expect(dbMock.orderItem.findMany).not.toHaveBeenCalled();
    expect(dbMock.outsourceOrder.create).not.toHaveBeenCalled();
  });

  it('rejects same-key creation when payload or actor differs', async () => {
    dbMock.outsourceOrder.findUnique.mockResolvedValue({
      id: 'outsource-existing',
      orderId: baseInput.orderId,
      orderItemIds: baseInput.orderItemIds,
      supplierName: '其他外协厂',
      supplierContact: baseInput.supplierContact,
      craftDescription: baseInput.craftDescription,
      specialRequirement: baseInput.specialRequirement,
      totalQty: baseInput.totalQty,
      expectedDate: baseInput.expectedDate,
      amount: '500.00',
      remark: baseInput.remark,
      createdById: 'other-actor',
      itemSnapshots: [{ orderItemId: 'item-1', quantity: 5000 }],
    });

    await expect(
      createOutsourceOrder(baseInput, foremanActor),
    ).rejects.toThrow(/请求标识已被其他内容使用/);
    expect(dbMock.outsourceOrder.create).not.toHaveBeenCalled();
  });
});

describe('confirmOutsourceAmount', () => {
  const input = {
    idempotencyKey: '00000000-0000-4000-8000-000000000002',
    amount: '680.50',
    reason: '回货后按对账单确认',
  };

  it('fills a missing amount after receipt and writes both ledgers atomically', async () => {
    dbMock.outsourceOrder.findUnique.mockResolvedValue({
      id: 'outsource-1',
      orderId: 'order-1',
      status: OutsourceStatus.RECEIVED,
      amount: null,
    });
    dbMock.outsourceAmountChange.create.mockResolvedValue({ id: 'change-1' });
    dbMock.outsourceOrder.update.mockResolvedValue({});

    await expect(
      confirmOutsourceAmount('outsource-1', input, foremanActor),
    ).resolves.toEqual({
      id: 'outsource-1',
      orderId: 'order-1',
      status: OutsourceStatus.RECEIVED,
      amount: '680.50',
    });
    expect(dbMock.outsourceAmountChange.create).toHaveBeenCalledWith({
      data: {
        idempotencyKey: input.idempotencyKey,
        outsourceOrderId: 'outsource-1',
        previousAmount: null,
        newAmount: '680.50',
        reason: input.reason,
        changedById: foremanActor.id,
      },
      select: { id: true },
    });
    expect(dbMock.outsourceOrder.update).toHaveBeenCalledWith({
      where: { id: 'outsource-1' },
      data: { amount: '680.50' },
    });
    expect(dbMock.businessAuditLog.create).toHaveBeenCalledTimes(1);
    expect(dbMock.$executeRaw.mock.calls[0]![1]).toBe(
      'print-shop-erp:outsource:outsource-1',
    );
    expect(dbMock.$executeRaw.mock.calls[1]![1]).toBe(
      `print-shop-erp:outsource-amount:${input.idempotencyKey}`,
    );
  });

  it('replays the exact amount request without updating or auditing twice', async () => {
    dbMock.outsourceAmountChange.findUnique.mockResolvedValue({
      outsourceOrderId: 'outsource-1',
      newAmount: '680.50',
      reason: input.reason,
      changedById: foremanActor.id,
      outsourceOrder: {
        id: 'outsource-1',
        orderId: 'order-1',
        status: OutsourceStatus.RECEIVED,
      },
    });

    await expect(
      confirmOutsourceAmount('outsource-1', input, foremanActor),
    ).resolves.toMatchObject({ id: 'outsource-1', amount: '680.50' });
    expect(dbMock.outsourceAmountChange.create).not.toHaveBeenCalled();
    expect(dbMock.outsourceOrder.update).not.toHaveBeenCalled();
    expect(dbMock.businessAuditLog.create).not.toHaveBeenCalled();
  });

  it('rejects same-key amount replay when money, reason, order, or actor differs', async () => {
    dbMock.outsourceAmountChange.findUnique.mockResolvedValue({
      outsourceOrderId: 'outsource-other',
      newAmount: '680.51',
      reason: '其他原因',
      changedById: 'other-actor',
      outsourceOrder: {
        id: 'outsource-other',
        orderId: 'order-1',
        status: OutsourceStatus.RECEIVED,
      },
    });

    await expect(
      confirmOutsourceAmount('outsource-1', input, foremanActor),
    ).rejects.toThrow(/金额请求标识已被其他内容使用/);
    expect(dbMock.outsourceOrder.update).not.toHaveBeenCalled();
  });

  it('records the previous amount when correcting a posted cost', async () => {
    dbMock.outsourceOrder.findUnique.mockResolvedValue({
      id: 'outsource-1',
      orderId: 'order-1',
      status: OutsourceStatus.RECEIVED,
      amount: '600.00',
    });
    dbMock.outsourceAmountChange.create.mockResolvedValue({ id: 'change-2' });
    dbMock.outsourceOrder.update.mockResolvedValue({});

    await confirmOutsourceAmount('outsource-1', input, foremanActor);
    expect(
      dbMock.outsourceAmountChange.create.mock.calls[0][0].data.previousAmount,
    ).toBe('600.00');
    expect(dbMock.businessAuditLog.create.mock.calls[0][0].data.action).toBe(
      'UPDATE_AMOUNT',
    );
  });

  it('does not allow a correction below payments already recorded', async () => {
    dbMock.outsourceOrder.findUnique.mockResolvedValue({
      id: 'outsource-1',
      orderId: 'order-1',
      status: OutsourceStatus.RECEIVED,
      amount: '680.50',
      payments: [{ amount: '500.00' }, { amount: '180.50' }],
    });

    await expect(
      confirmOutsourceAmount(
        'outsource-1',
        { ...input, amount: '680.49' },
        foremanActor,
      ),
    ).rejects.toThrow(/不能低于已付款 680\.50/);
    expect(dbMock.outsourceAmountChange.create).not.toHaveBeenCalled();
    expect(dbMock.outsourceOrder.update).not.toHaveBeenCalled();
  });
});

describe('recordOutsourcePayment', () => {
  const paymentInput = {
    idempotencyKey: '00000000-0000-4000-8000-000000000003',
    amount: '0.20',
    paidAt: new Date('2026-08-07T04:30:00.000Z'),
    method: ' 银行转账 ',
    reference: ' PAY-001 ',
    remark: ' 尾款 ',
  };

  it('rejects non-admin callers before opening a transaction', async () => {
    await expect(
      recordOutsourcePayment('outsource-1', paymentInput, {
        id: 'sales-1',
        username: 'sales',
        displayName: '外部销售',
        role: Role.SALES,
      }),
    ).rejects.toThrow(/只有管理员/);
    expect(dbMock.$transaction).not.toHaveBeenCalled();
    expect(dbMock.outsourcePayment.create).not.toHaveBeenCalled();
  });

  it.each(['0', '-1', '0.001', '10000000000.00', 'not-money'])(
    'rejects unstorable payment amount %s before opening a transaction',
    async (amount) => {
      await expect(
        recordOutsourcePayment(
          'outsource-1',
          { ...paymentInput, amount },
          foremanActor,
        ),
      ).rejects.toBeInstanceOf(OutsourceError);
      expect(dbMock.$transaction).not.toHaveBeenCalled();
    },
  );

  it.each([
    OutsourceStatus.SENT,
    OutsourceStatus.IN_PROGRESS,
    OutsourceStatus.CANCELLED,
  ])('only permits payment after receipt, not in %s', async (status) => {
    dbMock.outsourceOrder.findUnique.mockResolvedValue({
      id: 'outsource-1',
      status,
      amount: '0.30',
      payments: [],
    });
    await expect(
      recordOutsourcePayment('outsource-1', paymentInput, foremanActor),
    ).rejects.toThrow(/只有已回货/);
    expect(dbMock.outsourcePayment.create).not.toHaveBeenCalled();
  });

  it('requires a confirmed payable amount', async () => {
    dbMock.outsourceOrder.findUnique.mockResolvedValue({
      id: 'outsource-1',
      status: OutsourceStatus.RECEIVED,
      amount: null,
      payments: [],
    });
    await expect(
      recordOutsourcePayment('outsource-1', paymentInput, foremanActor),
    ).rejects.toThrow(/请先确认外协应付金额/);
  });

  it('rejects a missing outsource order', async () => {
    dbMock.outsourceOrder.findUnique.mockResolvedValue(null);
    await expect(
      recordOutsourcePayment('missing', paymentInput, foremanActor),
    ).rejects.toThrow(/外协单不存在/);
    expect(dbMock.outsourcePayment.create).not.toHaveBeenCalled();
  });

  it('adds Decimal amounts exactly, takes deterministic locks, and records only the payment ledger', async () => {
    dbMock.outsourceOrder.findUnique.mockResolvedValue({
      id: 'outsource-1',
      status: OutsourceStatus.RECEIVED,
      amount: '0.30',
      payments: [{ amount: '0.10' }],
    });

    await expect(
      recordOutsourcePayment('outsource-1', paymentInput, foremanActor),
    ).resolves.toEqual({
      paymentId: 'payment-1',
      outsourceOrderId: 'outsource-1',
      totalAmount: '0.30',
      newPaidAmount: '0.30',
      remainingAmount: '0.00',
      isFullyPaid: true,
    });
    expect(dbMock.$executeRaw.mock.calls[0]![1]).toBe(
      `print-shop-erp:outsource-payment-request:${paymentInput.idempotencyKey}`,
    );
    expect(dbMock.$executeRaw.mock.calls[1]![1]).toBe(
      'print-shop-erp:outsource:outsource-1',
    );
    expect(dbMock.$executeRaw.mock.invocationCallOrder[1]).toBeLessThan(
      dbMock.outsourcePayment.findUnique.mock.invocationCallOrder[0]!,
    );
    expect(dbMock.outsourcePayment.create).toHaveBeenCalledWith({
      data: {
        idempotencyKey: paymentInput.idempotencyKey,
        outsourceOrderId: 'outsource-1',
        amount: '0.20',
        paidAt: paymentInput.paidAt,
        method: '银行转账',
        reference: 'PAY-001',
        remark: '尾款',
        recordedById: foremanActor.id,
      },
      select: { id: true },
    });
    expect(dbMock.businessAuditLog.create).toHaveBeenCalledTimes(1);
    const auditData = dbMock.businessAuditLog.create.mock.calls[0][0].data;
    expect(auditData).toMatchObject({
      actorId: foremanActor.id,
      action: 'RECORD_PAYMENT',
      entityType: 'OutsourcePayment',
      entityId: 'payment-1',
      requestMetadata: {
        source: 'foreman-outsource.recordOutsourcePaymentAction',
        route: '/foreman/outsource/outsource-1',
      },
    });
    expect(auditData.after).toEqual({
      paymentId: 'payment-1',
      outsourceOrderId: 'outsource-1',
      amount: '0.20',
      paidAt: paymentInput.paidAt.toISOString(),
      totalAmount: '0.30',
      newPaidAmount: '0.30',
      remainingAmount: '0.00',
    });
  });

  it('awaits the audit write inside the payment transaction', async () => {
    dbMock.outsourceOrder.findUnique.mockResolvedValue({
      id: 'outsource-1',
      status: OutsourceStatus.RECEIVED,
      amount: '0.30',
      payments: [{ amount: '0.10' }],
    });
    dbMock.businessAuditLog.create.mockRejectedValue(
      new Error('audit unavailable'),
    );

    await expect(
      recordOutsourcePayment('outsource-1', paymentInput, foremanActor),
    ).rejects.toThrow('audit unavailable');
    expect(dbMock.outsourcePayment.create).toHaveBeenCalledTimes(1);
    expect(dbMock.businessAuditLog.create).toHaveBeenCalledTimes(1);
  });

  it('supports partial payment and returns the remaining payable', async () => {
    dbMock.outsourceOrder.findUnique.mockResolvedValue({
      id: 'outsource-1',
      status: OutsourceStatus.RECEIVED,
      amount: '100.00',
      payments: [{ amount: '20.00' }],
    });
    await expect(
      recordOutsourcePayment(
        'outsource-1',
        { ...paymentInput, amount: '30.00' },
        foremanActor,
      ),
    ).resolves.toMatchObject({
      newPaidAmount: '50.00',
      remainingAmount: '50.00',
      isFullyPaid: false,
    });
  });

  it('rejects a payment that exceeds the remaining payable', async () => {
    dbMock.outsourceOrder.findUnique.mockResolvedValue({
      id: 'outsource-1',
      status: OutsourceStatus.RECEIVED,
      amount: '100.00',
      payments: [{ amount: '60.00' }],
    });
    await expect(
      recordOutsourcePayment(
        'outsource-1',
        { ...paymentInput, amount: '40.01' },
        foremanActor,
      ),
    ).rejects.toThrow(/超出未付余额/);
    expect(dbMock.outsourcePayment.create).not.toHaveBeenCalled();
  });

  it.each([
    ['payments exceed payable', '100.00', [{ amount: '100.01' }]],
    ['payment is non-positive', '100.00', [{ amount: '0.00' }]],
    ['payment has excess precision', '100.00', [{ amount: '0.001' }]],
  ] as const)(
    'blocks writes when the stored ledger is inconsistent: %s',
    async (_label, totalAmount, payments) => {
      dbMock.outsourceOrder.findUnique.mockResolvedValue({
        id: 'outsource-1',
        status: OutsourceStatus.RECEIVED,
        amount: totalAmount,
        payments,
      });
      await expect(
        recordOutsourcePayment('outsource-1', paymentInput, foremanActor),
      ).rejects.toThrow(/对账/);
      expect(dbMock.outsourcePayment.create).not.toHaveBeenCalled();
    },
  );

  it('returns an exact same-key replay without inserting twice', async () => {
    dbMock.outsourcePayment.findUnique.mockResolvedValue({
      id: 'payment-existing',
      outsourceOrderId: 'outsource-1',
      amount: '0.20',
      paidAt: paymentInput.paidAt,
      method: '银行转账',
      reference: 'PAY-001',
      remark: '尾款',
      recordedById: foremanActor.id,
      outsourceOrder: {
        amount: '0.50',
        payments: [
          { amount: '0.10' },
          { amount: '0.20' },
          { amount: '0.05' },
        ],
      },
    });

    await expect(
      recordOutsourcePayment('outsource-1', paymentInput, foremanActor),
    ).resolves.toEqual({
      paymentId: 'payment-existing',
      outsourceOrderId: 'outsource-1',
      totalAmount: '0.50',
      newPaidAmount: '0.35',
      remainingAmount: '0.15',
      isFullyPaid: false,
    });
    expect(dbMock.outsourceOrder.findUnique).not.toHaveBeenCalled();
    expect(dbMock.outsourcePayment.create).not.toHaveBeenCalled();
    expect(dbMock.businessAuditLog.create).not.toHaveBeenCalled();
  });

  it('validates the current payable and cumulative ledger during replay', async () => {
    dbMock.outsourcePayment.findUnique.mockResolvedValue({
      id: 'payment-existing',
      outsourceOrderId: 'outsource-1',
      amount: '0.20',
      paidAt: paymentInput.paidAt,
      method: '银行转账',
      reference: 'PAY-001',
      remark: '尾款',
      recordedById: foremanActor.id,
      outsourceOrder: {
        amount: '-0.01',
        payments: [{ amount: '0.20' }],
      },
    });

    await expect(
      recordOutsourcePayment('outsource-1', paymentInput, foremanActor),
    ).rejects.toThrow(/外协应付金额异常，请先对账/);
    expect(dbMock.outsourcePayment.create).not.toHaveBeenCalled();
  });

  const replayMismatchCases = [
    ['target', { outsourceOrderId: 'outsource-other' }],
    ['actor', { recordedById: 'admin-other' }],
    ['amount', { amount: '0.21' }],
    ['time', { paidAt: new Date('2026-08-07T04:31:00.000Z') }],
    ['method', { method: '现金' }],
    ['reference', { reference: 'PAY-002' }],
    ['remark', { remark: '首付款' }],
  ] as const;

  it.each(replayMismatchCases)(
    'rejects same-key replay when %s differs',
    async (_label, difference) => {
      dbMock.outsourcePayment.findUnique.mockResolvedValue({
        id: 'payment-existing',
        outsourceOrderId: 'outsource-1',
        amount: '0.20',
        paidAt: paymentInput.paidAt,
        method: '银行转账',
        reference: 'PAY-001',
        remark: '尾款',
        recordedById: foremanActor.id,
        outsourceOrder: {
          amount: '0.30',
          payments: [{ amount: '0.20' }],
        },
        ...difference,
      });

      await expect(
        recordOutsourcePayment('outsource-1', paymentInput, foremanActor),
      ).rejects.toThrow(/付款请求标识已被其他付款使用/);
      expect(dbMock.outsourcePayment.create).not.toHaveBeenCalled();
    },
  );
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

  it('completes a pure-outsource order when the final outsource row is received', async () => {
    dbMock.outsourceOrder.findUnique.mockResolvedValue({
      id: 'outsource-1',
      orderId: 'order-1',
      status: OutsourceStatus.SENT,
    });
    dbMock.outsourceOrder.update.mockResolvedValue({
      id: 'outsource-1',
      status: OutsourceStatus.RECEIVED,
    });
    dbMock.outsourceOrder.findMany.mockResolvedValue([
      {
        id: 'outsource-1',
        status: OutsourceStatus.RECEIVED,
        orderItemIds: ['item-1'],
        itemSnapshots: [{ orderItemId: 'item-1', quantity: 5000 }],
      },
    ]);
    dbMock.productionTask.findMany.mockResolvedValue([]);
    dbMock.order.findUnique.mockResolvedValue({
      id: 'order-1',
      status: OrderStatus.SCHEDULING,
      requiresOutsource: true,
      workOrderVersion: 1,
      orderNo: 'O-OUT',
      customerRef: '苹果福',
      settlementType: OrderSettlementType.EXTERNAL_SALES,
      submitter: { displayName: '外销甲' },
      sourceOrder: null,
    });

    const result = await markOutsourceReceived(
      'outsource-1',
      { actualDate: null },
      foremanActor,
    );
    expect(result.orderCompleted).toBe(true);
    expect(dbMock.order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: OrderStatus.COMPLETED }),
      }),
    );
    expect(dbMock.order.findUnique).toHaveBeenCalledWith({
      where: { id: 'order-1' },
      select: {
        id: true,
        status: true,
        requiresOutsource: true,
        workOrderVersion: true,
        orderNo: true,
        customerRef: true,
        settlementType: true,
        submitter: { select: { displayName: true } },
        sourceOrder: { select: { submitter: { select: { displayName: true } } } },
        completedAt: true,
      },
    });
    expect(notifyMock).toHaveBeenCalledWith(
      'ORDER_COMPLETED',
      {
        orderId: 'order-1',
        orderNo: 'O-OUT',
        workOrderVersion: 1,
        externalSalesName: '外销甲',
        customerRef: '苹果福',
      },
      { dedupeKey: 'notification:ORDER_COMPLETED:order-1' },
    );
  });

  it('回传覆盖缺口：内部任务未完时也不被 INTERNAL_TASKS 吞掉', async () => {
    // ⚠️ 这条用例守的是 markOutsourceReceived 的**外层** return（事务外那个
    // 逐字段重建对象的）。漏掉一行 pendingOutsourceItems，字段会被原地丢弃、
    // action 层的 notice 恒为 undefined，而它是可选字段，tsc 不报、
    // actions/__tests__/outsource.test.ts 也发现不了（那边把整个 lib 层
    // vi.mock 掉了）。所以断言必须打在 lib 函数的返回值本身上。
    dbMock.outsourceOrder.findUnique.mockResolvedValue({
      id: 'outsource-1',
      orderId: 'order-1',
      status: OutsourceStatus.SENT,
    });
    dbMock.outsourceOrder.update.mockResolvedValue({
      id: 'outsource-1',
      status: OutsourceStatus.RECEIVED,
    });
    dbMock.outsourceOrder.findMany.mockResolvedValue([
      {
        id: 'outsource-1',
        status: OutsourceStatus.RECEIVED,
        orderItemIds: ['item-1'],
        itemSnapshots: [{ orderItemId: 'item-1', quantity: 5000 }],
      },
    ]);
    dbMock.orderItem.findMany.mockResolvedValue([
      {
        id: 'item-1',
        orderId: 'order-1',
        sequence: 1,
        name: '款式一',
        quantity: 5000,
        crafts: ['craft-uv'],
      },
      {
        id: 'item-2',
        orderId: 'order-1',
        sequence: 2,
        name: '款式二',
        quantity: 5000,
        crafts: ['craft-uv'],
      },
    ]);
    dbMock.productionTask.findMany.mockResolvedValue([
      { id: 'task-1', status: TaskStatus.IN_PROGRESS },
    ]);
    dbMock.order.findUnique.mockResolvedValue({
      id: 'order-1',
      status: OrderStatus.SCHEDULING,
      requiresOutsource: true,
    });

    const result = await markOutsourceReceived(
      'outsource-1',
      { actualDate: null },
      foremanActor,
    );

    expect(result.orderCompleted).toBe(false);
    expect(result.pendingOutsourceItems).toEqual([
      { id: 'item-2', sequence: 2, name: '款式二' },
    ]);
    expect(dbMock.order.update).not.toHaveBeenCalled();
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('覆盖完整时 pendingOutsourceItems 为空数组（不误报 notice）', async () => {
    dbMock.outsourceOrder.findUnique.mockResolvedValue({
      id: 'outsource-1',
      orderId: 'order-1',
      status: OutsourceStatus.SENT,
    });
    dbMock.outsourceOrder.update.mockResolvedValue({
      id: 'outsource-1',
      status: OutsourceStatus.RECEIVED,
    });
    dbMock.outsourceOrder.findMany.mockResolvedValue([
      {
        id: 'outsource-1',
        status: OutsourceStatus.RECEIVED,
        orderItemIds: ['item-1'],
        itemSnapshots: [{ orderItemId: 'item-1', quantity: 5000 }],
      },
    ]);
    dbMock.productionTask.findMany.mockResolvedValue([]);
    dbMock.order.findUnique.mockResolvedValue({
      id: 'order-1',
      status: OrderStatus.SCHEDULING,
      requiresOutsource: true,
      workOrderVersion: 1,
      orderNo: 'O-OUT',
      customerRef: null,
    });

    const result = await markOutsourceReceived(
      'outsource-1',
      { actualDate: null },
      foremanActor,
    );

    expect(result.orderCompleted).toBe(true);
    expect(result.pendingOutsourceItems).toEqual([]);
  });

  it('does not complete a mixed order while an internal task is unfinished', async () => {
    dbMock.outsourceOrder.findUnique.mockResolvedValue({
      id: 'outsource-1',
      orderId: 'order-1',
      status: OutsourceStatus.SENT,
    });
    dbMock.outsourceOrder.update.mockResolvedValue({
      id: 'outsource-1',
      status: OutsourceStatus.RECEIVED,
    });
    dbMock.productionTask.findMany.mockResolvedValue([
      { id: 'task-1', status: TaskStatus.IN_PROGRESS },
    ]);
    dbMock.outsourceOrder.findMany.mockResolvedValue([
      {
        id: 'outsource-1',
        status: OutsourceStatus.RECEIVED,
        orderItemIds: ['item-1'],
        itemSnapshots: [{ orderItemId: 'item-1', quantity: 5000 }],
      },
    ]);
    dbMock.order.findUnique.mockResolvedValue({
      id: 'order-1',
      status: OrderStatus.IN_PRODUCTION,
      requiresOutsource: true,
    });
    const result = await markOutsourceReceived(
      'outsource-1',
      { actualDate: null },
      foremanActor,
    );
    expect(result.orderCompleted).toBe(false);
    expect(dbMock.order.update).not.toHaveBeenCalled();
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

describe('getOutsourceOrderDetail', () => {
  it('includes authoritative item snapshots, compatibility ids, and append-only histories', async () => {
    dbMock.outsourceOrder.findUnique.mockResolvedValue({ id: 'outsource-1' });
    await getOutsourceOrderDetail('outsource-1');
    const query = dbMock.outsourceOrder.findUnique.mock.calls[0][0];
    expect(query.select.orderItemIds).toBe(true);
    expect(query.select.itemSnapshots).toEqual({
      select: { orderItemId: true, quantity: true },
    });
    expect(query.select.amountChanges).toEqual({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        previousAmount: true,
        newAmount: true,
        reason: true,
        createdAt: true,
        changedBy: { select: { displayName: true } },
      },
    });
    expect(query.select.payments).toEqual({
      orderBy: [{ paidAt: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        amount: true,
        paidAt: true,
        method: true,
        reference: true,
        remark: true,
        createdAt: true,
        recordedBy: { select: { displayName: true } },
      },
    });
  });
});
