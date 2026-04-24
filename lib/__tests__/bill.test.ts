import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  BillStatus,
  OrderStatus,
  Role,
} from '../../generated/prisma/client';

const { dbMock } = vi.hoisted(() => {
  const mock = {
    order: { findMany: vi.fn() },
    bill: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    billItem: { createMany: vi.fn() },
    salaryPeriod: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
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
  generateBillsForPeriod,
  issueBill,
  recordPayment,
  listBills,
  getBillDetail,
  BillError,
  InvalidBillTransitionError,
} from '../bill';

const ownerActor = { id: 'owner-1', role: Role.OWNER };
const salesActor = { id: 'sales-1', role: Role.SALES };

beforeEach(() => {
  dbMock.order.findMany.mockReset().mockResolvedValue([]);
  dbMock.bill.findUnique.mockReset();
  dbMock.bill.findMany.mockReset().mockResolvedValue([]);
  dbMock.bill.create.mockReset();
  dbMock.bill.update.mockReset();
  dbMock.billItem.createMany.mockReset().mockResolvedValue({ count: 0 });
  dbMock.salaryPeriod.findFirst.mockReset().mockResolvedValue(null);
  dbMock.salaryPeriod.update.mockReset();
  dbMock.$queryRaw.mockReset().mockResolvedValue(undefined);
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

  it('groups FINISHED orders by submitter and creates one Bill per group', async () => {
    dbMock.order.findMany.mockResolvedValue([
      { id: 'o1', submitterId: 'sales-a', totalAmount: '1000.00' },
      { id: 'o2', submitterId: 'sales-a', totalAmount: '2500.00' },
      { id: 'o3', submitterId: 'cs-b', totalAmount: '800.00' },
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
    expect(bySubmitter['cs-b'].totalAmount).toBe('800.00');
  });

  it('queries FINISHED orders with Shanghai [start, end) range', async () => {
    await generateBillsForPeriod('2026-05', ownerActor);
    const where = dbMock.order.findMany.mock.calls[0][0].where;
    expect(where.status).toBe(OrderStatus.FINISHED);
    expect((where.finishedAt.gte as Date).toISOString()).toBe(
      '2026-05-01T00:00:00.000Z',
    );
    expect((where.finishedAt.lt as Date).toISOString()).toBe(
      '2026-06-01T00:00:00.000Z',
    );
  });

  it('re-run on existing DRAFT: appends only NEW orders, leaves paid state untouched', async () => {
    dbMock.order.findMany.mockResolvedValue([
      { id: 'o1', submitterId: 'sales-a', totalAmount: '1000.00' },
      { id: 'o2-new', submitterId: 'sales-a', totalAmount: '500.00' },
    ]);
    dbMock.bill.findUnique.mockResolvedValue({
      id: 'bill-1',
      status: BillStatus.DRAFT,
      items: [{ orderId: 'o1' }], // o1 already on the bill
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
      items: [],
    });
    const r = await generateBillsForPeriod('2026-05', ownerActor);
    expect(r.generated).toHaveLength(0);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].salesUserId).toBe('sales-a');
    expect(r.errors[0].message).toMatch(/ISSUED/);
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
    expect(dbMock.$queryRaw).toHaveBeenCalled();
    const sql = (dbMock.$queryRaw.mock.calls[0][0] as TemplateStringsArray).join('?');
    expect(sql).toMatch(/pg_advisory_xact_lock/);
    expect(dbMock.$queryRaw.mock.calls[0][1]).toMatch(
      /print-shop-erp:bill-gen:sales-a:2026-05/,
    );
  });
});

describe('issueBill', () => {
  it('throws when bill is missing', async () => {
    dbMock.bill.findUnique.mockResolvedValue(null);
    await expect(issueBill('ghost', ownerActor)).rejects.toBeInstanceOf(
      BillError,
    );
  });

  it('transitions DRAFT → ISSUED and stamps issuedAt', async () => {
    dbMock.bill.findUnique.mockResolvedValue({
      id: 'bill-1',
      status: BillStatus.DRAFT,
    });
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
      id: 'bill-1',
      status: BillStatus.ISSUED,
    });
    await expect(issueBill('bill-1', ownerActor)).rejects.toBeInstanceOf(
      InvalidBillTransitionError,
    );
  });

  it('takes the per-bill advisory lock', async () => {
    dbMock.bill.findUnique.mockResolvedValue({
      id: 'bill-1',
      status: BillStatus.DRAFT,
    });
    dbMock.bill.update.mockResolvedValue({ id: 'bill-1', status: BillStatus.ISSUED });
    await issueBill('bill-1', ownerActor);
    const sql = (dbMock.$queryRaw.mock.calls[0][0] as TemplateStringsArray).join('?');
    expect(sql).toMatch(/pg_advisory_xact_lock/);
    expect(dbMock.$queryRaw.mock.calls[0][1]).toMatch(/print-shop-erp:bill:bill-1/);
  });
});

describe('recordPayment', () => {
  function billFixture(overrides: Partial<{
    status: BillStatus;
    totalAmount: string;
    paidAmount: string;
    paidAt: Date | null;
    salesUserRole: Role;
  }> = {}) {
    return {
      id: 'bill-1',
      status: overrides.status ?? BillStatus.ISSUED,
      salesUserId: 'sales-1',
      totalAmount: overrides.totalAmount ?? '1000.00',
      paidAmount: overrides.paidAmount ?? '0.00',
      paidAt: overrides.paidAt ?? null,
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
    const sql = (dbMock.$queryRaw.mock.calls[0][0] as TemplateStringsArray).join('?');
    expect(sql).toMatch(/pg_advisory_xact_lock/);
    expect(dbMock.$queryRaw.mock.calls[0][1]).toMatch(/print-shop-erp:bill:bill-1/);
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

  it('CUSTOMER_SERVICE account: wires accumulateCsSales with delta (not total)', async () => {
    dbMock.bill.findUnique.mockResolvedValue(
      billFixture({
        salesUserRole: Role.CUSTOMER_SERVICE,
        paidAmount: '100.00', // already some paid
      }),
    );
    dbMock.bill.update.mockResolvedValue({});
    // accumulateCsSales finds an active period → returns accumulated
    dbMock.salaryPeriod.findFirst.mockResolvedValue({
      id: 'period-1',
      totalSales: '5000.00',
    });
    dbMock.salaryPeriod.update.mockResolvedValue({
      id: 'period-1',
      totalSales: '5400.00',
    });
    const r = await recordPayment('bill-1', 400, ownerActor);
    expect(r.csAccumulated).toBe(true);
    // accumulateCsSales is called with delta=400 (this payment), not
    // newPaidAmount=500. The update to SalaryPeriod.totalSales uses
    // Prisma `increment` which we pin:
    const updateArg = dbMock.salaryPeriod.update.mock.calls[0][0];
    expect(updateArg.data.totalSales).toEqual({ increment: '400.00' });
  });

  it('CUSTOMER_SERVICE with no active period: csAccumulated = false, no throw', async () => {
    dbMock.bill.findUnique.mockResolvedValue(
      billFixture({ salesUserRole: Role.CUSTOMER_SERVICE }),
    );
    dbMock.bill.update.mockResolvedValue({});
    // No active period at `now`
    dbMock.salaryPeriod.findFirst.mockResolvedValue(null);
    const r = await recordPayment('bill-1', 500, ownerActor);
    expect(r.csAccumulated).toBe(false);
  });

  it('CS accumulation shares the bill tx (Codex round 52 / P1 — no independent commit)', async () => {
    // If accumulateCsSales were opening its own $transaction, we'd
    // see a SECOND $transaction call. With the tx threaded through,
    // there's only ONE (the bill tx).
    dbMock.bill.findUnique.mockResolvedValue(
      billFixture({ salesUserRole: Role.CUSTOMER_SERVICE }),
    );
    dbMock.bill.update.mockResolvedValue({});
    dbMock.salaryPeriod.findFirst.mockResolvedValue({
      id: 'period-1',
      totalSales: '0',
    });
    dbMock.salaryPeriod.update.mockResolvedValue({
      id: 'period-1',
      totalSales: '500.00',
    });
    await recordPayment('bill-1', 500, ownerActor);
    // Exactly one $transaction — the outer bill tx. CS accumulation
    // reused it instead of opening a new one.
    expect(dbMock.$transaction).toHaveBeenCalledTimes(1);
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

describe('getBillDetail', () => {
  it('returns null when bill is missing', async () => {
    dbMock.bill.findUnique.mockResolvedValue(null);
    const r = await getBillDetail('ghost');
    expect(r).toBeNull();
  });

  it('includes items + order meta', async () => {
    dbMock.bill.findUnique.mockResolvedValue({
      id: 'bill-1',
      items: [{ id: 'item-1', orderId: 'o1', orderAmount: '500.00', order: { orderNo: '20260501-0001' } }],
    });
    const r = await getBillDetail('bill-1');
    expect(r).toBeTruthy();
    void salesActor; // reference to avoid unused import
  });
});
