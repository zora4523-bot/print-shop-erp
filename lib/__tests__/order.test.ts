import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OrderStatus, Role } from '../../generated/prisma/client';

const { dbMock } = vi.hoisted(() => {
  const mock: {
    order: {
      findMany: ReturnType<typeof vi.fn>;
      findFirst: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    craft: { findMany: ReturnType<typeof vi.fn> };
    product: { findUnique: ReturnType<typeof vi.fn> };
    orderLog: { create: ReturnType<typeof vi.fn> };
    $queryRaw: ReturnType<typeof vi.fn>;
    $transaction: ReturnType<typeof vi.fn>;
  } = {
    order: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    craft: { findMany: vi.fn() },
    product: { findUnique: vi.fn() },
    orderLog: { create: vi.fn() },
    $queryRaw: vi.fn().mockResolvedValue(undefined),
    $transaction: vi.fn(async (fn: unknown) => {
      if (typeof fn === 'function') return await (fn as (tx: unknown) => unknown)(mock);
      return fn;
    }),
  };
  return { dbMock: mock };
});
vi.mock('@/lib/db', () => ({ db: dbMock }));

import {
  createOrder,
  submitOrder,
  cancelOrder,
  listOrders,
  getOrderDetail,
  OrderInvariantError,
} from '../order';
import { InvalidOrderTransitionError } from '../order/status-machine';

const salesActor = { id: 'sales-1', role: Role.SALES };
const workerActor = { id: 'worker-1', role: Role.WORKER };
const ownerActor = { id: 'owner-1', role: Role.OWNER };

function baseItem(over: Partial<Record<string, unknown>> = {}) {
  return {
    name: '烫金款 A',
    productId: null,
    specification: null,
    paperType: null,
    quantity: 1000,
    crafts: ['craft-1'],
    foilColor: null,
    isDoubleSided: false,
    isDoubleColor: false,
    unitPrice: '0.5000',
    suggestedPrice: null,
    remark: null,
    ...over,
  };
}

beforeEach(() => {
  for (const fn of Object.values(dbMock.order)) fn.mockReset();
  dbMock.craft.findMany.mockReset();
  dbMock.product.findUnique.mockReset();
  dbMock.orderLog.create.mockReset().mockResolvedValue({});
  dbMock.$queryRaw.mockReset().mockResolvedValue(undefined);
  dbMock.$transaction.mockReset().mockImplementation(async (fn: unknown) => {
    if (typeof fn === 'function') return await (fn as (tx: unknown) => unknown)(dbMock);
    return fn;
  });

  // Default: no existing orders for today (fresh serial), every craft
  // exists + is active, no productId references.
  dbMock.order.findFirst.mockResolvedValue(null);
  dbMock.craft.findMany.mockImplementation(async ({ where }: { where: { id: { in: string[] } } }) =>
    where.id.in.map((id) => ({ id })),
  );
  dbMock.order.create.mockImplementation(async ({ data }: { data: { orderNo: string } }) => ({
    id: 'order-created',
    orderNo: data.orderNo,
  }));
});

describe('createOrder', () => {
  it('opens a transaction and acquires the per-day advisory lock', async () => {
    await createOrder(
      {
        customerRef: '苹果福',
        receiverName: null,
        receiverPhone: null,
        receiverAddress: null,
        expressCode: null,
        packageRequirement: null,
        remark: null,
        isUrgent: false,
        items: [baseItem()],
      },
      salesActor,
      new Date('2026-04-23T09:00:00+08:00'),
    );
    expect(dbMock.$transaction).toHaveBeenCalledTimes(1);
    const queryRawCalls = dbMock.$queryRaw.mock.calls;
    expect(queryRawCalls.length).toBeGreaterThan(0);
    const firstSql = (queryRawCalls[0][0] as TemplateStringsArray).join('?');
    expect(firstSql).toMatch(/pg_advisory_xact_lock/);
  });

  it('assigns YYYYMMDD-0001 when the day has no existing orders', async () => {
    const result = await createOrder(
      {
        customerRef: null,
        receiverName: null,
        receiverPhone: null,
        receiverAddress: null,
        expressCode: null,
        packageRequirement: null,
        remark: null,
        isUrgent: false,
        items: [baseItem()],
      },
      salesActor,
      new Date('2026-04-23T09:00:00+08:00'),
    );
    expect(result.orderNo).toBe('20260423-0001');
  });

  it('stores status=DRAFT and writes an initial CREATE log entry', async () => {
    await createOrder(
      {
        customerRef: null,
        receiverName: null,
        receiverPhone: null,
        receiverAddress: null,
        expressCode: null,
        packageRequirement: null,
        remark: null,
        isUrgent: false,
        items: [baseItem()],
      },
      salesActor,
      new Date('2026-04-23T09:00:00+08:00'),
    );
    const createArg = dbMock.order.create.mock.calls[0][0];
    expect(createArg.data.status).toBe(OrderStatus.DRAFT);
    expect(createArg.data.logs.create[0].action).toBe('CREATE');
    expect(createArg.data.logs.create[0].operatorId).toBe('sales-1');
  });

  it('refuses when a referenced craft id does not exist or is inactive', async () => {
    dbMock.craft.findMany.mockResolvedValueOnce([]); // no craft matches
    await expect(
      createOrder(
        {
          customerRef: null,
          receiverName: null,
          receiverPhone: null,
          receiverAddress: null,
          expressCode: null,
          packageRequirement: null,
          remark: null,
          isUrgent: false,
          items: [baseItem({ crafts: ['does-not-exist'] })],
        },
        salesActor,
        new Date('2026-04-23T09:00:00+08:00'),
      ),
    ).rejects.toBeInstanceOf(OrderInvariantError);
    expect(dbMock.order.create).not.toHaveBeenCalled();
  });

  it('refuses when a referenced productId is inactive', async () => {
    dbMock.product.findUnique.mockResolvedValueOnce({ id: 'p1', isActive: false });
    await expect(
      createOrder(
        {
          customerRef: null,
          receiverName: null,
          receiverPhone: null,
          receiverAddress: null,
          expressCode: null,
          packageRequirement: null,
          remark: null,
          isUrgent: false,
          items: [baseItem({ productId: 'p1' })],
        },
        salesActor,
        new Date('2026-04-23T09:00:00+08:00'),
      ),
    ).rejects.toThrowError(/产品已停用/);
  });

  it('computes subtotal + totalAmount with Decimal math (no JS float rounding)', async () => {
    await createOrder(
      {
        customerRef: null,
        receiverName: null,
        receiverPhone: null,
        receiverAddress: null,
        expressCode: null,
        packageRequirement: null,
        remark: null,
        isUrgent: false,
        items: [
          baseItem({ quantity: 3, unitPrice: '0.1' }),
          baseItem({ name: 'B', quantity: 2, unitPrice: '0.2' }),
        ],
      },
      salesActor,
      new Date('2026-04-23T09:00:00+08:00'),
    );
    const createArg = dbMock.order.create.mock.calls[0][0];
    // 3 × 0.1 = 0.30
    expect(createArg.data.items.create[0].subtotal).toBe('0.30');
    // 2 × 0.2 = 0.40
    expect(createArg.data.items.create[1].subtotal).toBe('0.40');
    // total 0.70
    expect(createArg.data.totalAmount).toBe('0.70');
  });

  it('treats a null unitPrice as 0 for the subtotal', async () => {
    await createOrder(
      {
        customerRef: null,
        receiverName: null,
        receiverPhone: null,
        receiverAddress: null,
        expressCode: null,
        packageRequirement: null,
        remark: null,
        isUrgent: false,
        items: [baseItem({ quantity: 500, unitPrice: null })],
      },
      salesActor,
      new Date('2026-04-23T09:00:00+08:00'),
    );
    expect(dbMock.order.create.mock.calls[0][0].data.items.create[0].subtotal).toBe('0.00');
    expect(dbMock.order.create.mock.calls[0][0].data.totalAmount).toBe('0.00');
  });

  it('records isUrgent and stamps a "创建急单" log remark', async () => {
    await createOrder(
      {
        customerRef: null,
        receiverName: null,
        receiverPhone: null,
        receiverAddress: null,
        expressCode: null,
        packageRequirement: null,
        remark: null,
        isUrgent: true,
        items: [baseItem()],
      },
      salesActor,
      new Date('2026-04-23T09:00:00+08:00'),
    );
    const createArg = dbMock.order.create.mock.calls[0][0];
    expect(createArg.data.isUrgent).toBe(true);
    expect(createArg.data.logs.create[0].remark).toBe('创建急单');
  });
});

describe('submitOrder', () => {
  it('transitions DRAFT → SUBMITTED and stamps submittedAt from the injected clock', async () => {
    dbMock.order.findUnique.mockResolvedValue({
      id: 'o1',
      status: OrderStatus.DRAFT,
      submitterId: 'sales-1',
    });
    dbMock.order.update.mockResolvedValue({ id: 'o1', status: OrderStatus.SUBMITTED });

    const clock = new Date('2026-04-23T10:00:00+08:00');
    const r = await submitOrder('o1', salesActor, clock);
    expect(r.status).toBe(OrderStatus.SUBMITTED);
    const updateArg = dbMock.order.update.mock.calls[0][0];
    expect(updateArg.data.status).toBe(OrderStatus.SUBMITTED);
    expect(updateArg.data.submittedAt).toBe(clock);

    // Exactly one STATUS_CHANGE log with before/after.
    const logArg = dbMock.orderLog.create.mock.calls[0][0];
    expect(logArg.data.action).toBe('STATUS_CHANGE');
    expect(logArg.data.changedFields.status).toEqual({
      before: OrderStatus.DRAFT,
      after: OrderStatus.SUBMITTED,
    });
  });

  it('refuses when a non-owner SALES tries to submit another SALES\'s order (Codex round 27 / P1)', async () => {
    dbMock.order.findUnique.mockResolvedValue({
      id: 'o1',
      status: OrderStatus.DRAFT,
      submitterId: 'someone-else',
    });

    await expect(submitOrder('o1', salesActor)).rejects.toThrowError(
      /只能提交自己创建的工单/,
    );
    expect(dbMock.order.update).not.toHaveBeenCalled();
    expect(dbMock.orderLog.create).not.toHaveBeenCalled();
  });

  it('OWNER may submit on behalf of another submitter (global override)', async () => {
    dbMock.order.findUnique.mockResolvedValue({
      id: 'o1',
      status: OrderStatus.DRAFT,
      submitterId: 'someone-else',
    });
    dbMock.order.update.mockResolvedValue({ id: 'o1', status: OrderStatus.SUBMITTED });
    await expect(submitOrder('o1', ownerActor)).resolves.toBeDefined();
  });

  it('refuses the submit when the current status is not DRAFT', async () => {
    dbMock.order.findUnique.mockResolvedValue({
      id: 'o1',
      status: OrderStatus.IN_PRODUCTION,
      submitterId: 'sales-1',
    });

    await expect(submitOrder('o1', salesActor)).rejects.toBeInstanceOf(
      InvalidOrderTransitionError,
    );
    expect(dbMock.order.update).not.toHaveBeenCalled();
    expect(dbMock.orderLog.create).not.toHaveBeenCalled();
  });

  it('throws OrderInvariantError if the target is missing', async () => {
    dbMock.order.findUnique.mockResolvedValue(null);
    await expect(submitOrder('nope', salesActor)).rejects.toBeInstanceOf(OrderInvariantError);
  });
});

describe('cancelOrder', () => {
  it('cancels a non-terminal order and logs with the reason', async () => {
    dbMock.order.findUnique.mockResolvedValue({
      id: 'o1',
      status: OrderStatus.SCHEDULING,
      submitterId: 'sales-1',
    });
    dbMock.order.update.mockResolvedValue({ id: 'o1', status: OrderStatus.CANCELLED });

    await cancelOrder('o1', ownerActor, '客户取消');
    const updateArg = dbMock.order.update.mock.calls[0][0];
    expect(updateArg.data.status).toBe(OrderStatus.CANCELLED);
    // submittedAt shouldn't be touched on CANCELLED.
    expect(updateArg.data.submittedAt).toBeUndefined();

    const logArg = dbMock.orderLog.create.mock.calls[0][0];
    expect(logArg.data.remark).toBe('取消：客户取消');
  });

  it('uses a default remark when reason is null', async () => {
    dbMock.order.findUnique.mockResolvedValue({
      id: 'o1',
      status: OrderStatus.DRAFT,
      submitterId: 'sales-1',
    });
    dbMock.order.update.mockResolvedValue({ id: 'o1', status: OrderStatus.CANCELLED });
    await cancelOrder('o1', ownerActor, null);
    expect(dbMock.orderLog.create.mock.calls[0][0].data.remark).toBe('取消工单');
  });

  it('refuses to cancel terminal states (FINISHED)', async () => {
    dbMock.order.findUnique.mockResolvedValue({
      id: 'o1',
      status: OrderStatus.FINISHED,
      submitterId: 'sales-1',
    });
    await expect(cancelOrder('o1', ownerActor, null)).rejects.toBeInstanceOf(
      InvalidOrderTransitionError,
    );
  });
});

describe('listOrders / getOrderDetail — scope filter application', () => {
  it('applies getOrderScopeFilter (SALES sees only own) to list', async () => {
    dbMock.order.findMany.mockResolvedValue([]);
    await listOrders(salesActor);
    const where = dbMock.order.findMany.mock.calls[0][0].where;
    expect(where).toEqual({ submitterId: 'sales-1' });
  });

  it('OWNER sees everything (empty where)', async () => {
    dbMock.order.findMany.mockResolvedValue([]);
    await listOrders(ownerActor);
    const where = dbMock.order.findMany.mock.calls[0][0].where;
    expect(where).toEqual({});
  });

  it('WORKER scope: only orders whose items have a task assigned to them', async () => {
    dbMock.order.findMany.mockResolvedValue([]);
    await listOrders(workerActor);
    const where = dbMock.order.findMany.mock.calls[0][0].where;
    expect(where).toEqual({
      items: { some: { tasks: { some: { workerId: 'worker-1' } } } },
    });
  });

  it('getOrderDetail enforces the scope filter by id (SALES cannot peek at others)', async () => {
    dbMock.order.findFirst.mockResolvedValue(null);
    const result = await getOrderDetail('someone-elses-order', salesActor);
    expect(result).toBeNull();
    const arg = dbMock.order.findFirst.mock.calls[0][0];
    expect(arg.where).toMatchObject({ id: 'someone-elses-order', submitterId: 'sales-1' });
  });
});
