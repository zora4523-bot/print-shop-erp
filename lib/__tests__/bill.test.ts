import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  BillStatus,
  OrderCostCategory,
  OrderBillingMode,
  OrderSettlementType,
  OrderStatus,
  Role,
} from '../../generated/prisma/client';

const { dbMock } = vi.hoisted(() => {
  const mock = {
    order: { findMany: vi.fn(), findUnique: vi.fn() },
    bill: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    billItem: { createMany: vi.fn() },
    billPayment: { findUnique: vi.fn(), create: vi.fn() },
    orderCostEntry: { findUnique: vi.fn(), create: vi.fn() },
    salaryPeriod: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    $executeRaw: vi.fn().mockResolvedValue(undefined),
    $transaction: vi.fn(async (fn: unknown) => {
      if (typeof fn === 'function') return await (fn as (tx: unknown) => unknown)(mock);
      return fn;
    }),
  };
  return { dbMock: mock };
});
vi.mock('@/lib/db', () => ({ db: dbMock }));

import {
  generateBillsForPeriod,
  issueBill,
  recordPayment,
  listBills,
  getAdminBillDetail,
  getSalesBillDetail,
  addOrderCostEntry,
  BillError,
  BillGenerationUnexpectedError,
  InvalidBillTransitionError,
} from '../bill';

const ownerActor = { id: 'owner-1', role: Role.ADMIN };
const salesActor = { id: 'sales-1', role: Role.SALES };

beforeEach(() => {
  dbMock.order.findMany.mockReset().mockResolvedValue([]);
  dbMock.order.findUnique.mockReset().mockResolvedValue({
    id: 'order-1',
    isSfCollect: false,
  });
  dbMock.bill.findUnique.mockReset();
  dbMock.bill.findMany.mockReset().mockResolvedValue([]);
  dbMock.bill.create.mockReset();
  dbMock.bill.update.mockReset();
  dbMock.billItem.createMany.mockReset().mockResolvedValue({ count: 0 });
  dbMock.billPayment.create.mockReset().mockResolvedValue({ id: 'payment-1' });
  dbMock.billPayment.findUnique.mockReset().mockResolvedValue(null);
  dbMock.orderCostEntry.findUnique.mockReset().mockResolvedValue(null);
  dbMock.orderCostEntry.create.mockReset().mockResolvedValue({ id: 'cost-1' });
  dbMock.salaryPeriod.findFirst.mockReset().mockResolvedValue(null);
  dbMock.salaryPeriod.update.mockReset();
  dbMock.$executeRaw.mockReset().mockResolvedValue(undefined);
  dbMock.$transaction.mockReset().mockImplementation(async (fn: unknown) => {
    if (typeof fn === 'function') return await (fn as (tx: unknown) => unknown)(dbMock);
    return fn;
  });
});

describe('generateBillsForPeriod', () => {
  it('rejects bad period format (reuses parseShanghaiMonth)', async () => {
    await expect(
      generateBillsForPeriod('2026/05', ownerActor),
    ).rejects.toThrow(/月份格式非法/);
  });

  it('groups external-sales FINISHED orders by submitter and creates one Bill per group', async () => {
    dbMock.order.findMany.mockResolvedValue([
      { id: 'o1', submitterId: 'sales-a', totalAmount: '1000.00' },
      { id: 'o2', submitterId: 'sales-a', totalAmount: '2500.00' },
      { id: 'o3', submitterId: 'sales-b', totalAmount: '800.00' },
    ]);
    dbMock.bill.findUnique.mockResolvedValue(null);
    let createdCount = 0;
    dbMock.bill.create.mockImplementation(async ({ data }: { data: { salesUserId: string } }) => {
      createdCount += 1;
      return { id: `bill-${createdCount}`, salesUserId: data.salesUserId };
    });

    const r = await generateBillsForPeriod('2026-05', ownerActor);
    expect(r.period).toBe('2026-05');
    expect(r.generated).toHaveLength(2);
    const bySubmitter = Object.fromEntries(
      r.generated.map((g) => [g.salesUserId, g]),
    );
    expect(bySubmitter['sales-a'].totalAmount).toBe('3500.00'); // 1000 + 2500
    expect(bySubmitter['sales-a'].orderCount).toBe(2);
    expect(bySubmitter['sales-a'].isNew).toBe(true);
    expect(bySubmitter['sales-b'].totalAmount).toBe('800.00');
  });

  it('queries only external-sales FINISHED charge orders with Shanghai [start, end) range', async () => {
    await generateBillsForPeriod('2026-05', ownerActor);
    const where = dbMock.order.findMany.mock.calls[0][0].where;
    expect(where.status).toBe(OrderStatus.FINISHED);
    expect(where.billingMode).toBe(OrderBillingMode.CHARGE);
    expect(where.settlementType).toBe(OrderSettlementType.EXTERNAL_SALES);
    expect(where).not.toHaveProperty('submitterRole');
    expect((where.finishedAt.gte as Date).toISOString()).toBe(
      '2026-04-30T16:00:00.000Z',
    );
    expect((where.finishedAt.lt as Date).toISOString()).toBe(
      '2026-05-31T16:00:00.000Z',
    );
  });

  it('uses the locked settlement type instead of submitter role for receivables', async () => {
    const candidates = [
      {
        id: 'sales-order',
        submitterId: 'sales-a',
        submitterRole: Role.SALES,
        settlementType: OrderSettlementType.EXTERNAL_SALES,
        totalAmount: '1200.00',
      },
      {
        id: 'internal-sales-order',
        submitterId: 'cs-a',
        submitterRole: Role.CUSTOMER_SERVICE,
        settlementType: OrderSettlementType.INTERNAL_SALES,
        totalAmount: '800.00',
      },
      {
        id: 'admin-order',
        submitterId: 'admin-a',
        submitterRole: Role.ADMIN,
        settlementType: OrderSettlementType.FACTORY_DIRECT,
        totalAmount: '500.00',
      },
    ];
    dbMock.order.findMany.mockImplementation(
      async ({
        where,
        select,
      }: {
        where: {
          settlementType?: OrderSettlementType;
          submitterRole?: Role;
        };
        select: Record<string, boolean>;
      }) => {
        expect(where.settlementType).toBe(OrderSettlementType.EXTERNAL_SALES);
        expect(where).not.toHaveProperty('submitterRole');
        expect(select).toEqual({
          id: true,
          submitterId: true,
          totalAmount: true,
        });
        return candidates
          .filter((order) => order.settlementType === where.settlementType)
          .map(({ id, submitterId, totalAmount }) => ({
            id,
            submitterId,
            totalAmount,
          }));
      },
    );
    dbMock.bill.findUnique.mockResolvedValue(null);
    dbMock.bill.create.mockResolvedValue({ id: 'bill-sales-a' });

    const result = await generateBillsForPeriod('2026-05', ownerActor);

    expect(result.generated).toEqual([
      {
        billId: 'bill-sales-a',
        salesUserId: 'sales-a',
        totalAmount: '1200.00',
        orderCount: 1,
        isNew: true,
      },
    ]);
    expect(dbMock.bill.create).toHaveBeenCalledTimes(1);
    expect(dbMock.bill.create.mock.calls[0][0].data.salesUserId).toBe('sales-a');
  });

  it('does not infer external settlement from a mutable SALES role', async () => {
    const roleOnlyOrder = {
      id: 'role-only-sales-order',
      submitterId: 'sales-a',
      submitterRole: Role.SALES,
      settlementType: OrderSettlementType.INTERNAL_SALES,
      totalAmount: '999.00',
    };
    dbMock.order.findMany.mockImplementation(
      async ({ where }: { where: { settlementType?: OrderSettlementType } }) => {
        expect(where.settlementType).toBe(OrderSettlementType.EXTERNAL_SALES);
        return [roleOnlyOrder]
          .filter((order) => order.settlementType === where.settlementType)
          .map(({ id, submitterId, totalAmount }) => ({
            id,
            submitterId,
            totalAmount,
          }));
      },
    );

    const result = await generateBillsForPeriod('2026-05', ownerActor);

    expect(result.generated).toEqual([]);
    expect(dbMock.bill.create).not.toHaveBeenCalled();
  });

  it('re-run on existing DRAFT: appends only NEW orders, leaves paid state untouched', async () => {
    dbMock.order.findMany.mockResolvedValue([
      { id: 'o1', submitterId: 'sales-a', totalAmount: '1000.00' },
      { id: 'o2-new', submitterId: 'sales-a', totalAmount: '500.00' },
    ]);
    dbMock.bill.findUnique.mockResolvedValue({
      id: 'bill-1',
      status: BillStatus.DRAFT,
      openingAmount: '0.00',
      items: [{ orderId: 'o1', orderAmount: '1000.00' }], // o1 already on the bill
    });
    dbMock.bill.update.mockResolvedValue({ id: 'bill-1' });
    const r = await generateBillsForPeriod('2026-05', ownerActor);
    expect(r.generated[0].isNew).toBe(false);
    expect(r.generated[0].orderCount).toBe(2); // existing 1 + new 1
    expect(r.generated[0].totalAmount).toBe('1500.00');
    // Only the new order gets added as a BillItem
    const createManyArg = dbMock.billItem.createMany.mock.calls[0][0].data;
    expect(createManyArg).toEqual([
      { billId: 'bill-1', orderId: 'o2-new', orderAmount: '500.00' },
    ]);
  });

  it('refuses to update a non-DRAFT bill (ISSUED / PARTIAL_PAID / FULLY_PAID)', async () => {
    dbMock.order.findMany.mockResolvedValue([
      { id: 'o1', submitterId: 'sales-a', totalAmount: '1000.00' },
    ]);
    dbMock.bill.findUnique.mockResolvedValue({
      id: 'bill-1',
      status: BillStatus.ISSUED,
      openingAmount: '0.00',
      items: [],
    });
    const r = await generateBillsForPeriod('2026-05', ownerActor);
    expect(r.generated).toHaveLength(0);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].salesUserId).toBe('sales-a');
    expect(r.errors[0].message).toMatch(/ISSUED/);
  });

  it('recomputes a draft from persisted bill items plus newly appended items', async () => {
    dbMock.order.findMany.mockResolvedValue([
      { id: 'o2-new', submitterId: 'sales-a', totalAmount: '500.00' },
    ]);
    dbMock.bill.findUnique.mockResolvedValue({
      id: 'bill-1',
      status: BillStatus.DRAFT,
      openingAmount: '25.00',
      items: [{ orderId: 'historical-o1', orderAmount: '1000.00' }],
    });
    dbMock.bill.update.mockResolvedValue({ id: 'bill-1' });

    const result = await generateBillsForPeriod('2026-05', ownerActor);

    expect(result.generated[0].totalAmount).toBe('1525.00');
    expect(dbMock.bill.update).toHaveBeenCalledWith({
      where: { id: 'bill-1' },
      data: { totalAmount: '1525.00' },
      select: { id: true },
    });
  });

  it('refuses a negative or overflowing draft total before updating finance state', async () => {
    dbMock.order.findMany.mockResolvedValue([
      { id: 'o1', submitterId: 'sales-a', totalAmount: '1000.00' },
    ]);
    dbMock.bill.findUnique.mockResolvedValue({
      id: 'bill-1',
      status: BillStatus.DRAFT,
      openingAmount: '-2000.00',
      items: [],
    });

    const negative = await generateBillsForPeriod('2026-05', ownerActor);
    expect(negative.generated).toEqual([]);
    expect(negative.errors[0]?.message).toMatch(/不能为负数/);
    expect(dbMock.bill.update).not.toHaveBeenCalled();

    dbMock.order.findMany.mockResolvedValue([
      {
        id: 'o-max',
        submitterId: 'sales-a',
        totalAmount: '9999999999.99',
      },
    ]);
    dbMock.bill.findUnique.mockResolvedValue({
      id: 'bill-1',
      status: BillStatus.DRAFT,
      openingAmount: '0.01',
      items: [],
    });

    const overflow = await generateBillsForPeriod('2026-05', ownerActor);
    expect(overflow.generated).toEqual([]);
    expect(overflow.errors[0]?.message).toMatch(/超过可保存上限/);
    expect(dbMock.bill.update).not.toHaveBeenCalled();
    expect(dbMock.billItem.createMany).not.toHaveBeenCalled();
  });

  it('empty month: no orders → generated=[] errors=[]', async () => {
    dbMock.order.findMany.mockResolvedValue([]);
    const r = await generateBillsForPeriod('2026-05', ownerActor);
    expect(r.generated).toEqual([]);
    expect(r.errors).toEqual([]);
  });

  it('takes per-(salesUser, period) advisory lock before findUnique (Codex round 52 / P1)', async () => {
    dbMock.order.findMany.mockResolvedValue([
      { id: 'o1', submitterId: 'sales-a', totalAmount: '1000.00' },
    ]);
    dbMock.bill.findUnique.mockResolvedValue(null);
    dbMock.bill.create.mockResolvedValue({ id: 'bill-1' });
    await generateBillsForPeriod('2026-05', ownerActor);
    expect(dbMock.$executeRaw).toHaveBeenCalled();
    const sql = (dbMock.$executeRaw.mock.calls[0][0] as TemplateStringsArray).join('?');
    expect(sql).toMatch(/pg_advisory_xact_lock/);
    expect(dbMock.$executeRaw.mock.calls[0][1]).toMatch(
      /print-shop-erp:bill-gen:sales-a:2026-05/,
    );
  });

  it('rethrows an unexpected group failure with committed partial results', async () => {
    const databaseFailure = new Error('transaction connection lost');
    dbMock.order.findMany.mockResolvedValue([
      { id: 'o1', submitterId: 'sales-a', totalAmount: '1000.00' },
      { id: 'o2', submitterId: 'sales-b', totalAmount: '500.00' },
    ]);
    dbMock.bill.findUnique.mockImplementation(
      async ({ where }: { where: Record<string, unknown> }) => {
        const identity = where.salesUserId_period as
          | { salesUserId: string }
          | undefined;
        if (identity?.salesUserId === 'sales-b') throw databaseFailure;
        return null;
      },
    );
    dbMock.bill.create.mockImplementation(
      async ({ data }: { data: { salesUserId: string } }) => ({
        id: `bill-${data.salesUserId}`,
      }),
    );

    let caught: unknown;
    try {
      await generateBillsForPeriod('2026-05', ownerActor);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(BillGenerationUnexpectedError);
    const unexpected = caught as BillGenerationUnexpectedError;
    expect(unexpected.partialResult.generated).toEqual([
      expect.objectContaining({ salesUserId: 'sales-a' }),
    ]);
    expect(unexpected.partialResult.errors).toEqual([]);
    expect(unexpected.cause).toBe(databaseFailure);
  });

  it('wraps an order-scan failure with an empty partial result', async () => {
    const databaseFailure = new Error('scan unavailable');
    dbMock.order.findMany.mockRejectedValue(databaseFailure);

    let caught: unknown;
    try {
      await generateBillsForPeriod('2026-05', ownerActor);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(BillGenerationUnexpectedError);
    const unexpected = caught as BillGenerationUnexpectedError;
    expect(unexpected.partialResult).toEqual({
      period: '2026-05',
      generated: [],
      errors: [],
    });
    expect(unexpected.cause).toBe(databaseFailure);
  });
});

describe('issueBill', () => {
  const draftBill = {
    id: 'bill-1',
    salesUserId: 'sales-1',
    period: '2026-05',
    totalAmount: '1000.00',
    status: BillStatus.DRAFT,
  };

  it('throws when bill is missing', async () => {
    dbMock.bill.findUnique.mockResolvedValue(null);
    await expect(issueBill('ghost', ownerActor)).rejects.toBeInstanceOf(
      BillError,
    );
  });

  it('transitions DRAFT → ISSUED and stamps issuedAt', async () => {
    dbMock.bill.findUnique.mockResolvedValue(draftBill);
    dbMock.bill.update.mockResolvedValue({
      id: 'bill-1',
      status: BillStatus.ISSUED,
    });
    const now = new Date('2026-06-01T10:00:00Z');
    const r = await issueBill('bill-1', ownerActor, now);
    expect(r.status).toBe(BillStatus.ISSUED);
    const data = dbMock.bill.update.mock.calls[0][0].data;
    expect(data.status).toBe(BillStatus.ISSUED);
    expect(data.issuedAt).toBe(now);
  });

  it('refuses to re-issue an ISSUED bill', async () => {
    dbMock.bill.findUnique.mockResolvedValue({
      ...draftBill,
      status: BillStatus.ISSUED,
    });
    await expect(issueBill('bill-1', ownerActor)).rejects.toBeInstanceOf(
      InvalidBillTransitionError,
    );
  });

  it('takes the per-bill advisory lock', async () => {
    dbMock.bill.findUnique.mockResolvedValue(draftBill);
    dbMock.bill.update.mockResolvedValue({ id: 'bill-1', status: BillStatus.ISSUED });
    await issueBill('bill-1', ownerActor);
    const lockValues = dbMock.$executeRaw.mock.calls.map((call) => call[1]);
    expect(lockValues).toEqual([
      'print-shop-erp:bill-gen:sales-1:2026-05',
      'print-shop-erp:bill:bill-1',
    ]);
  });

  it('rejects empty or negative bills and non-admin callers', async () => {
    dbMock.bill.findUnique.mockResolvedValue({
      ...draftBill,
      totalAmount: '0.00',
    });
    await expect(issueBill('bill-1', ownerActor)).rejects.toThrow(/空账单/);

    dbMock.bill.findUnique.mockResolvedValue({
      ...draftBill,
      totalAmount: '-1.00',
    });
    await expect(issueBill('bill-1', ownerActor)).rejects.toThrow(/不能为负数/);

    await expect(issueBill('bill-1', salesActor)).rejects.toThrow(/只有管理员/);
  });
});

describe('recordPayment', () => {
  function billFixture(overrides: Partial<{
    status: BillStatus;
    totalAmount: string;
    paidAmount: string;
    paidAt: Date | null;
    paymentDates: Date[];
    salesUserRole: Role;
  }> = {}) {
    return {
      id: 'bill-1',
      status: overrides.status ?? BillStatus.ISSUED,
      salesUserId: 'sales-1',
      totalAmount: overrides.totalAmount ?? '1000.00',
      paidAmount: overrides.paidAmount ?? '0.00',
      paidAt: overrides.paidAt ?? null,
      payments: (overrides.paymentDates ?? []).map((paidAt) => ({ paidAt })),
      salesUser: { role: overrides.salesUserRole ?? Role.SALES },
    };
  }

  it('rejects non-positive amounts', async () => {
    dbMock.bill.findUnique.mockResolvedValue(billFixture());
    await expect(
      recordPayment('bill-1', 0, ownerActor),
    ).rejects.toThrow(/必须大于 0/);
    await expect(
      recordPayment('bill-1', -100, ownerActor),
    ).rejects.toThrow(/必须大于 0/);
  });

  it('rejects fractional cents, invalid decimals and Decimal(12,2) overflow', async () => {
    await expect(
      recordPayment('bill-1', '0.001', ownerActor),
    ).rejects.toThrow(/小数最多 2 位/);
    await expect(
      recordPayment('bill-1', 'not-money', ownerActor),
    ).rejects.toThrow(/格式不合法/);
    await expect(
      recordPayment('bill-1', '10000000000.00', ownerActor),
    ).rejects.toThrow(/超过可保存上限/);
    expect(dbMock.$transaction).not.toHaveBeenCalled();
  });

  it('rejects when bill is DRAFT (must issue first)', async () => {
    dbMock.bill.findUnique.mockResolvedValue(
      billFixture({ status: BillStatus.DRAFT }),
    );
    await expect(
      recordPayment('bill-1', 500, ownerActor),
    ).rejects.toThrow(/需先发单/);
  });

  it('rejects when bill is FULLY_PAID (terminal)', async () => {
    dbMock.bill.findUnique.mockResolvedValue(
      billFixture({ status: BillStatus.FULLY_PAID }),
    );
    await expect(
      recordPayment('bill-1', 100, ownerActor),
    ).rejects.toThrow(/不能重复结清/);
  });

  it('rejects overpayment (next > total)', async () => {
    dbMock.bill.findUnique.mockResolvedValue(
      billFixture({ paidAmount: '600.00' }),
    );
    await expect(
      recordPayment('bill-1', 500, ownerActor),
    ).rejects.toThrow(/超出未结清余额/);
  });

  it('partial payment: ISSUED → PARTIAL_PAID, no paidAt', async () => {
    dbMock.bill.findUnique.mockResolvedValue(billFixture());
    dbMock.bill.update.mockResolvedValue({});
    const r = await recordPayment('bill-1', 400, ownerActor);
    expect(r.status).toBe(BillStatus.PARTIAL_PAID);
    expect(r.previousPaidAmount).toBe('0.00');
    expect(r.newPaidAmount).toBe('400.00');
    expect(r.totalAmount).toBe('1000.00');
    const data = dbMock.bill.update.mock.calls[0][0].data;
    expect(data.status).toBe(BillStatus.PARTIAL_PAID);
    expect(data.paidAmount).toBe('400.00');
    // paidAt stays null for PARTIAL_PAID (inherits existing)
    expect(data.paidAt).toBeNull();
    expect(dbMock.billPayment.create).toHaveBeenCalledWith({
      data: {
        idempotencyKey: expect.any(String),
        billId: 'bill-1',
        amount: '400.00',
        paidAt: expect.any(Date),
        paymentMethod: null,
        referenceNo: null,
        remark: null,
        recordedById: 'owner-1',
      },
    });
  });

  it('second partial payment: PARTIAL_PAID → PARTIAL_PAID (累加)', async () => {
    dbMock.bill.findUnique.mockResolvedValue(
      billFixture({
        status: BillStatus.PARTIAL_PAID,
        paidAmount: '400.00',
      }),
    );
    dbMock.bill.update.mockResolvedValue({});
    const r = await recordPayment('bill-1', 300, ownerActor);
    expect(r.newPaidAmount).toBe('700.00');
    expect(r.status).toBe(BillStatus.PARTIAL_PAID);
  });

  it('final payment: PARTIAL_PAID → FULLY_PAID, stamps paidAt from injected clock', async () => {
    dbMock.bill.findUnique.mockResolvedValue(
      billFixture({
        status: BillStatus.PARTIAL_PAID,
        paidAmount: '400.00',
      }),
    );
    dbMock.bill.update.mockResolvedValue({});
    const now = new Date('2026-06-15T10:00:00Z');
    const r = await recordPayment('bill-1', 600, ownerActor, now);
    expect(r.newPaidAmount).toBe('1000.00');
    expect(r.status).toBe(BillStatus.FULLY_PAID);
    const data = dbMock.bill.update.mock.calls[0][0].data;
    expect(data.paidAt).toBe(now);
  });

  it('keeps the latest receipt time when a backdated final payment closes the bill', async () => {
    const laterPartialPayment = new Date('2026-08-02T04:00:00Z');
    const backdatedFinalPayment = new Date('2026-08-01T04:00:00Z');
    dbMock.bill.findUnique.mockResolvedValue(
      billFixture({
        status: BillStatus.PARTIAL_PAID,
        paidAmount: '400.00',
        paymentDates: [laterPartialPayment],
      }),
    );
    dbMock.bill.update.mockResolvedValue({});

    await recordPayment(
      'bill-1',
      600,
      ownerActor,
      backdatedFinalPayment,
    );

    expect(dbMock.bill.update.mock.calls[0][0].data.paidAt).toBe(
      laterPartialPayment,
    );
  });

  it('one-shot full payment: ISSUED → FULLY_PAID directly', async () => {
    dbMock.bill.findUnique.mockResolvedValue(billFixture());
    dbMock.bill.update.mockResolvedValue({});
    const r = await recordPayment('bill-1', 1000, ownerActor);
    expect(r.status).toBe(BillStatus.FULLY_PAID);
    expect(r.newPaidAmount).toBe('1000.00');
  });

  it('takes the per-bill advisory lock before reading', async () => {
    dbMock.bill.findUnique.mockResolvedValue(billFixture());
    dbMock.bill.update.mockResolvedValue({});
    await recordPayment('bill-1', 100, ownerActor);
    const lockValues = dbMock.$executeRaw.mock.calls.map((call) => call[1]);
    expect(lockValues[0]).toMatch(/print-shop-erp:payment-request:/);
    expect(lockValues[1]).toBe('print-shop-erp:bill:bill-1');
  });

  it('SALES account: does NOT call accumulateCsSales', async () => {
    dbMock.bill.findUnique.mockResolvedValue(
      billFixture({ salesUserRole: Role.SALES }),
    );
    dbMock.bill.update.mockResolvedValue({});
    const r = await recordPayment('bill-1', 500, ownerActor);
    expect(r.csAccumulated).toBe(false);
    // salaryPeriod never touched
    expect(dbMock.salaryPeriod.findFirst).not.toHaveBeenCalled();
  });

  it('CUSTOMER_SERVICE payments do not change commission sales', async () => {
    dbMock.bill.findUnique.mockResolvedValue(
      billFixture({
        salesUserRole: Role.CUSTOMER_SERVICE,
        paidAmount: '100.00', // already some paid
      }),
    );
    dbMock.bill.update.mockResolvedValue({});
    const r = await recordPayment('bill-1', 400, ownerActor);
    expect(r.csAccumulated).toBe(false);
    expect(dbMock.salaryPeriod.findFirst).not.toHaveBeenCalled();
    expect(dbMock.salaryPeriod.update).not.toHaveBeenCalled();
  });

  it('stores payment method, reference number, remark and injected paidAt', async () => {
    dbMock.bill.findUnique.mockResolvedValue(
      billFixture({ salesUserRole: Role.CUSTOMER_SERVICE }),
    );
    dbMock.bill.update.mockResolvedValue({});
    const paidAt = new Date('2026-06-08T02:30:00Z');
    const r = await recordPayment('bill-1', 500, ownerActor, paidAt, {
      paymentMethod: ' 银行转账 ',
      referenceNo: ' TX-20260608 ',
      remark: ' 首付款 ',
    });
    expect(r.csAccumulated).toBe(false);
    expect(dbMock.billPayment.create).toHaveBeenCalledWith({
      data: {
        idempotencyKey: expect.any(String),
        billId: 'bill-1',
        amount: '500.00',
        paidAt,
        paymentMethod: '银行转账',
        referenceNo: 'TX-20260608',
        remark: '首付款',
        recordedById: 'owner-1',
      },
    });
  });

  it('payment ledger and bill balance share one transaction', async () => {
    dbMock.bill.findUnique.mockResolvedValue(
      billFixture({ salesUserRole: Role.CUSTOMER_SERVICE }),
    );
    dbMock.bill.update.mockResolvedValue({});
    await recordPayment('bill-1', 500, ownerActor);
    expect(dbMock.$transaction).toHaveBeenCalledTimes(1);
    expect(dbMock.bill.update).toHaveBeenCalledTimes(1);
    expect(dbMock.billPayment.create).toHaveBeenCalledTimes(1);
  });

  it('replays the same idempotency key without applying the payment twice', async () => {
    const paidAt = new Date('2026-06-08T02:30:00Z');
    dbMock.billPayment.findUnique.mockResolvedValue({
      billId: 'bill-1',
      amount: '400.00',
      paidAt,
      paymentMethod: null,
      referenceNo: null,
      remark: null,
      recordedById: 'owner-1',
      bill: {
        paidAmount: '400.00',
        totalAmount: '1000.00',
        status: BillStatus.PARTIAL_PAID,
      },
    });
    const result = await recordPayment(
      'bill-1',
      '400.00',
      ownerActor,
      paidAt,
      { idempotencyKey: '00000000-0000-4000-8000-000000000001' },
    );

    expect(result.newPaidAmount).toBe('400.00');
    expect(dbMock.bill.update).not.toHaveBeenCalled();
    expect(dbMock.billPayment.create).not.toHaveBeenCalled();
  });

  it('rejects an idempotency replay when any audit payload field changed', async () => {
    const originalPaidAt = new Date('2026-06-08T02:30:00Z');
    dbMock.billPayment.findUnique.mockResolvedValue({
      billId: 'bill-1',
      amount: '400.00',
      paidAt: originalPaidAt,
      paymentMethod: '银行',
      referenceNo: 'TX-1',
      remark: '首款',
      recordedById: 'owner-1',
      bill: {
        paidAmount: '400.00',
        totalAmount: '1000.00',
        status: BillStatus.PARTIAL_PAID,
      },
    });
    const idempotencyKey = '00000000-0000-4000-8000-000000000001';
    const cases = [
      {
        paidAt: new Date('2026-06-08T02:31:00Z'),
        details: { paymentMethod: '银行', referenceNo: 'TX-1', remark: '首款' },
      },
      {
        paidAt: originalPaidAt,
        details: { paymentMethod: '微信', referenceNo: 'TX-1', remark: '首款' },
      },
      {
        paidAt: originalPaidAt,
        details: { paymentMethod: '银行', referenceNo: 'TX-2', remark: '首款' },
      },
      {
        paidAt: originalPaidAt,
        details: { paymentMethod: '银行', referenceNo: 'TX-1', remark: '尾款' },
      },
    ];

    for (const testCase of cases) {
      await expect(
        recordPayment('bill-1', '400.00', ownerActor, testCase.paidAt, {
          idempotencyKey,
          ...testCase.details,
        }),
      ).rejects.toThrow(/请求标识已被其他付款使用/);
    }
    expect(dbMock.bill.update).not.toHaveBeenCalled();
    expect(dbMock.billPayment.create).not.toHaveBeenCalled();
  });
});

describe('addOrderCostEntry', () => {
  const baseInput = {
    idempotencyKey: '00000000-0000-4000-8000-000000000002',
    orderId: 'order-1',
    category: OrderCostCategory.MATERIAL,
    description: '纸张',
    quantity: '2.000',
    unitPrice: '12.5000',
    amount: '25.00',
  };

  it('takes request then order lock before the fresh fulfillment read', async () => {
    await expect(addOrderCostEntry(baseInput, ownerActor)).resolves.toEqual({
      id: 'cost-1',
    });

    expect(dbMock.$executeRaw).toHaveBeenCalledTimes(2);
    expect(dbMock.$executeRaw.mock.calls[0]?.[1]).toBe(
      'print-shop-erp:cost-request:00000000-0000-4000-8000-000000000002',
    );
    expect(dbMock.$executeRaw.mock.calls[1]?.[1]).toBe(
      'print-shop-erp:order-cascade:order-1',
    );
    expect(dbMock.$executeRaw.mock.invocationCallOrder[1]).toBeLessThan(
      dbMock.order.findUnique.mock.invocationCallOrder[0]!,
    );
    expect(dbMock.order.findUnique.mock.invocationCallOrder[0]).toBeLessThan(
      dbMock.orderCostEntry.create.mock.invocationCallOrder[0]!,
    );
  });

  it('fresh-reads after a contended order lock and rejects a newly marked SF collect order', async () => {
    let releaseOrderLock!: () => void;
    let signalOrderLockReached!: () => void;
    const orderLockReached = new Promise<void>((resolve) => {
      signalOrderLockReached = resolve;
    });
    const orderLockReleased = new Promise<void>((resolve) => {
      releaseOrderLock = resolve;
    });
    dbMock.$executeRaw
      .mockResolvedValueOnce(undefined)
      .mockImplementationOnce(async () => {
        signalOrderLockReached();
        await orderLockReleased;
      });
    dbMock.order.findUnique.mockResolvedValue({
      id: 'order-1',
      isSfCollect: true,
    });

    const pending = addOrderCostEntry(
      { ...baseInput, category: OrderCostCategory.SHIPPING },
      ownerActor,
    );
    await orderLockReached;
    expect(dbMock.order.findUnique).not.toHaveBeenCalled();
    releaseOrderLock();

    await expect(pending).rejects.toThrow(/顺丰到付.*不能录入物流费/);
    expect(dbMock.orderCostEntry.findUnique).toHaveBeenCalledTimes(1);
    expect(dbMock.orderCostEntry.create).not.toHaveBeenCalled();
  });

  it('replays an existing shipping write even if the order is now SF collect', async () => {
    dbMock.order.findUnique.mockResolvedValue({
      id: 'order-1',
      isSfCollect: true,
    });
    dbMock.orderCostEntry.findUnique.mockResolvedValue({
      id: 'cost-existing',
      orderId: 'order-1',
      amount: '25.00',
      category: OrderCostCategory.SHIPPING,
      description: '物流费',
      quantity: null,
      unit: null,
      unitPrice: null,
      remark: null,
      createdById: 'owner-1',
    });

    await expect(
      addOrderCostEntry(
        {
          ...baseInput,
          category: OrderCostCategory.SHIPPING,
          description: '物流费',
          quantity: null,
          unitPrice: null,
        },
        ownerActor,
      ),
    ).resolves.toMatchObject({ id: 'cost-existing' });
    expect(dbMock.orderCostEntry.create).not.toHaveBeenCalled();
  });

  it('reports a mismatched replay key before applying the current SF restriction', async () => {
    dbMock.order.findUnique.mockResolvedValue({
      id: 'order-1',
      isSfCollect: true,
    });
    dbMock.orderCostEntry.findUnique.mockResolvedValue({
      id: 'cost-existing',
      orderId: 'order-1',
      amount: '30.00',
      category: OrderCostCategory.SHIPPING,
      description: '物流费',
      quantity: null,
      unit: null,
      unitPrice: null,
      remark: null,
      createdById: 'owner-1',
    });

    await expect(
      addOrderCostEntry(
        {
          ...baseInput,
          category: OrderCostCategory.SHIPPING,
          description: '物流费',
          quantity: null,
          unitPrice: null,
        },
        ownerActor,
      ),
    ).rejects.toThrow(/请求标识已被其他记录使用/);
    expect(dbMock.orderCostEntry.create).not.toHaveBeenCalled();
  });

  it('allows non-shipping manual costs on an SF collect order', async () => {
    dbMock.order.findUnique.mockResolvedValue({
      id: 'order-1',
      isSfCollect: true,
    });

    await expect(addOrderCostEntry(baseInput, ownerActor)).resolves.toEqual({
      id: 'cost-1',
    });
  });

  it('rejects automatic cost categories and mismatched multiplication', async () => {
    await expect(
      addOrderCostEntry(
        { ...baseInput, category: OrderCostCategory.PIECEWORK },
        ownerActor,
      ),
    ).rejects.toThrow(/自动汇总/);
    await expect(
      addOrderCostEntry({ ...baseInput, amount: '24.99' }, ownerActor),
    ).rejects.toThrow(/数量 × 单价/);
  });

  it('rejects values that would be rounded or overflow database decimals', async () => {
    await expect(
      addOrderCostEntry({ ...baseInput, amount: '25.001' }, ownerActor),
    ).rejects.toThrow(/成本金额小数最多 2 位/);
    await expect(
      addOrderCostEntry(
        {
          ...baseInput,
          quantity: null,
          unitPrice: null,
          amount: '10000000000.00',
        },
        ownerActor,
      ),
    ).rejects.toThrow(/成本金额超过可保存上限/);
    await expect(
      addOrderCostEntry(
        { ...baseInput, quantity: '1.0001', unitPrice: null },
        ownerActor,
      ),
    ).rejects.toThrow(/成本数量小数最多 3 位/);
    await expect(
      addOrderCostEntry(
        { ...baseInput, quantity: '1000000000', unitPrice: null },
        ownerActor,
      ),
    ).rejects.toThrow(/成本数量超过可保存上限/);
    await expect(
      addOrderCostEntry(
        { ...baseInput, quantity: null, unitPrice: '1.00001' },
        ownerActor,
      ),
    ).rejects.toThrow(/成本单价小数最多 4 位/);
    await expect(
      addOrderCostEntry(
        { ...baseInput, quantity: null, unitPrice: '100000000' },
        ownerActor,
      ),
    ).rejects.toThrow(/成本单价超过可保存上限/);
    expect(dbMock.$transaction).not.toHaveBeenCalled();
  });

  it('allows a precise signed adjustment but never a rounded-to-zero entry', async () => {
    await expect(
      addOrderCostEntry(
        {
          ...baseInput,
          category: OrderCostCategory.ADJUSTMENT,
          quantity: null,
          unitPrice: null,
          amount: '-1.25',
        },
        ownerActor,
      ),
    ).resolves.toEqual({ id: 'cost-1' });
    await expect(
      addOrderCostEntry(
        {
          ...baseInput,
          category: OrderCostCategory.ADJUSTMENT,
          quantity: null,
          unitPrice: null,
          amount: '0.001',
        },
        ownerActor,
      ),
    ).rejects.toThrow(/小数最多 2 位/);
  });

  it('replays a stable request key without inserting twice', async () => {
    dbMock.orderCostEntry.findUnique.mockResolvedValue({
      id: 'cost-existing',
      orderId: 'order-1',
      amount: '25.00',
      category: OrderCostCategory.MATERIAL,
      description: '纸张',
      quantity: '2.000',
      unit: null,
      unitPrice: '12.5000',
      remark: null,
      createdById: 'owner-1',
    });
    const result = await addOrderCostEntry(baseInput, ownerActor);
    expect(result.id).toBe('cost-existing');
    expect(dbMock.orderCostEntry.create).not.toHaveBeenCalled();
  });

  it('rejects a cost replay when any descriptive payload field changed', async () => {
    dbMock.orderCostEntry.findUnique.mockResolvedValue({
      id: 'cost-existing',
      orderId: 'order-1',
      amount: '25.00',
      category: OrderCostCategory.MATERIAL,
      description: '纸张',
      quantity: '2.000',
      unit: '张',
      unitPrice: '12.5000',
      remark: '原始',
      createdById: 'owner-1',
    });
    const cases = [
      { ...baseInput, description: '特种纸', unit: '张', remark: '原始' },
      {
        ...baseInput,
        quantity: '1.000',
        unitPrice: '25.0000',
        unit: '张',
        remark: '原始',
      },
      { ...baseInput, unit: '公斤', remark: '原始' },
      { ...baseInput, unit: '张', remark: '修改后' },
    ];

    for (const input of cases) {
      await expect(addOrderCostEntry(input, ownerActor)).rejects.toThrow(
        /请求标识已被其他记录使用/,
      );
    }
    expect(dbMock.orderCostEntry.create).not.toHaveBeenCalled();
  });
});

describe('listBills', () => {
  it('rejects invalid period', async () => {
    await expect(listBills({ period: '2026/05' })).rejects.toThrow(
      /月份格式非法/,
    );
  });

  it('filters by salesUserId / period / status together', async () => {
    await listBills({
      salesUserId: 'sales-1',
      period: '2026-05',
      status: BillStatus.ISSUED,
    });
    const where = dbMock.bill.findMany.mock.calls[0][0].where;
    expect(where).toEqual({
      salesUserId: 'sales-1',
      period: '2026-05',
      status: BillStatus.ISSUED,
    });
  });

  it('no filter returns everything', async () => {
    await listBills({});
    expect(dbMock.bill.findMany.mock.calls[0][0].where).toEqual({});
  });
});

describe('bill detail read models', () => {
  it('returns null when bill is missing', async () => {
    dbMock.bill.findUnique.mockResolvedValue(null);
    const r = await getAdminBillDetail('ghost');
    expect(r).toBeNull();
  });

  it('includes auditable cost details for original and rework orders', async () => {
    dbMock.bill.findUnique.mockResolvedValue({
      id: 'bill-1',
      items: [{ id: 'item-1', orderId: 'o1', orderAmount: '500.00', order: { orderNo: '20260501-0001' } }],
    });
    const r = await getAdminBillDetail('bill-1');
    expect(r).toBeTruthy();
    const query = dbMock.bill.findUnique.mock.calls[0][0];
    const orderSelect = query.select.items.select.order.select;
    expect(orderSelect.id).toBe(true);
    expect(orderSelect.settlementType).toBe(true);
    expect(orderSelect.costEntries.include.createdBy).toEqual({
      select: { displayName: true },
    });
    expect(orderSelect.reworkOrders.select.costEntries).toEqual({
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        category: true,
        description: true,
        quantity: true,
        unit: true,
        unitPrice: true,
        amount: true,
        remark: true,
        createdAt: true,
        createdBy: { select: { displayName: true } },
      },
    });
    void salesActor; // reference to avoid unused import
  });

  it('scopes the external-sales query before reading and returns only receivable fields', async () => {
    dbMock.bill.findUnique.mockResolvedValue({
      id: 'bill-1',
      salesUserId: 'sales-1',
      items: [],
      payments: [],
    });

    await getSalesBillDetail('bill-1', 'sales-1');

    const query = dbMock.bill.findUnique.mock.calls[0][0];
    expect(query.where).toEqual({ id: 'bill-1', salesUserId: 'sales-1' });
    expect(query.select).not.toHaveProperty('salesUser');
    expect(query.select).not.toHaveProperty('createdAt');
    expect(query.select).not.toHaveProperty('updatedAt');

    expect(query.select.payments.select).toEqual({
      id: true,
      amount: true,
      paidAt: true,
      paymentMethod: true,
      referenceNo: true,
      remark: true,
      idempotencyKey: true,
    });
    expect(query.select.payments).not.toHaveProperty('include');
    expect(query.select.payments.select).not.toHaveProperty('recordedBy');

    expect(query.select.items.where).toEqual({
      order: {
        submitterId: 'sales-1',
        settlementType: OrderSettlementType.EXTERNAL_SALES,
      },
    });
    expect(query.select.items.select.order.select).toEqual({
      id: true,
      orderNo: true,
      customerRef: true,
      processingAmount: true,
      finishedAt: true,
      status: true,
      customerCharges: {
        orderBy: { createdAt: 'asc' },
        select: {
          amount: true,
          status: true,
          category: { select: { code: true, name: true } },
          shipment: { select: { sequence: true } },
        },
      },
      items: {
        orderBy: { sequence: 'asc' },
        select: {
          id: true,
          sequence: true,
          name: true,
          pricingSnapshot: true,
        },
      },
    });
    for (const internalField of [
      'costEntries',
      'outsourceOrders',
      'reworkOrders',
      'csSalesEntries',
      'shipments',
    ]) {
      expect(query.select.items.select.order.select).not.toHaveProperty(
        internalField,
      );
    }
  });
});
