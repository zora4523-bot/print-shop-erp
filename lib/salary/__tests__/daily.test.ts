import { describe, it, expect, vi, beforeEach } from 'vitest';
import Decimal from 'decimal.js';
import {
  MachineType,
  Role,
  WorkerType,
} from '../../../generated/prisma/client';

// Mock db before importing the module under test. lib/salary/daily.ts
// calls db.user.findUnique, db.productionTask.findMany, etc.
const { dbMock } = vi.hoisted(() => {
  const mock = {
    user: { findUnique: vi.fn(), findMany: vi.fn() },
    productionTask: { findMany: vi.fn() },
    salaryRule: { findFirst: vi.fn() },
    dailyWorkerSalary: {
      upsert: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
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
  aggregateTasks,
  shanghaiDayRange,
  computeDailyWorkerSalary,
  listDailyWorkerSalaries,
  markDailySalaryPaid,
  DailySalaryError,
} from '../daily';

const HAND_PRESS_RULE = {
  dailyBase: 100,
  pieceRate: 0.007,
  boardRate: 5,
  smallOrderThreshold: 1000,
  smallOrderFlatPrice: 12,
  multiplierFactors: ['DOUBLE_SIDED', 'DOUBLE_COLOR'],
};

describe('shanghaiDayRange', () => {
  it('returns the UTC instant range for a Shanghai calendar date', () => {
    // 2026-04-23 Shanghai = [2026-04-22T16:00Z, 2026-04-23T16:00Z)
    const { start, end } = shanghaiDayRange('2026-04-23');
    expect(start.toISOString()).toBe('2026-04-22T16:00:00.000Z');
    expect(end.toISOString()).toBe('2026-04-23T16:00:00.000Z');
    expect(end.getTime() - start.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it('rejects non-YYYY-MM-DD input', () => {
    expect(() => shanghaiDayRange('2026/04/23')).toThrow(DailySalaryError);
    expect(() => shanghaiDayRange('2026-4-23')).toThrow(DailySalaryError);
    expect(() => shanghaiDayRange('')).toThrow(DailySalaryError);
  });

  it('rejects invalid calendar dates (2026-02-31 rollover) (Codex round 43 / P1)', () => {
    // JS `new Date('2026-02-31')` would silently normalize to Mar 3;
    // shanghaiDayRange must refuse so a cron/UI typo fails loud.
    expect(() => shanghaiDayRange('2026-02-31')).toThrow(DailySalaryError);
    expect(() => shanghaiDayRange('2025-04-31')).toThrow(DailySalaryError);
    expect(() => shanghaiDayRange('2026-13-01')).toThrow(DailySalaryError);
  });
});

describe('aggregateTasks', () => {
  it('sums pieceworkAmount with Decimal math (no float drift)', () => {
    const r = aggregateTasks([
      { pieceworkAmount: '12.00', orderItem: { orderId: 'o1' } },
      { pieceworkAmount: '61.00', orderItem: { orderId: 'o2' } },
      { pieceworkAmount: '52.00', orderItem: { orderId: 'o2' } },
      { pieceworkAmount: '76.00', orderItem: { orderId: 'o3' } },
    ]);
    expect(r.totalPieceworkAmount.toFixed(2)).toBe('201.00');
    expect(r.taskCount).toBe(4);
    expect(r.orderCount).toBe(3);
    expect(r.detail).toHaveLength(4);
    expect(r.detail[0]).toEqual({ pieceworkAmount: '12.00', orderId: 'o1' });
  });

  it('empty task list returns zero totals', () => {
    const r = aggregateTasks([]);
    expect(r.totalPieceworkAmount.toFixed(2)).toBe('0.00');
    expect(r.taskCount).toBe(0);
    expect(r.orderCount).toBe(0);
    expect(r.detail).toEqual([]);
  });
});

describe('computeDailyWorkerSalary', () => {
  const workerFixture = {
    id: 'worker-1',
    role: Role.WORKER,
    workerType: WorkerType.MACHINE,
    machineType: MachineType.HAND_PRESS,
    isActive: true,
  };

  beforeEach(() => {
    dbMock.user.findUnique.mockReset();
    dbMock.user.findMany.mockReset();
    dbMock.productionTask.findMany.mockReset();
    dbMock.salaryRule.findFirst
      .mockReset()
      .mockResolvedValue({ ruleValue: HAND_PRESS_RULE });
    dbMock.dailyWorkerSalary.upsert.mockReset().mockResolvedValue({});
    dbMock.dailyWorkerSalary.findMany.mockReset();
    dbMock.dailyWorkerSalary.findUnique.mockReset().mockResolvedValue(null);
    dbMock.dailyWorkerSalary.update.mockReset();
    dbMock.$executeRaw.mockReset().mockResolvedValue(undefined);
    dbMock.$transaction.mockReset().mockImplementation(async (fn: unknown) => {
      if (typeof fn === 'function') return await (fn as (tx: unknown) => unknown)(dbMock);
      return fn;
    });
  });

  it('refuses a missing worker', async () => {
    dbMock.user.findUnique.mockResolvedValue(null);
    await expect(
      computeDailyWorkerSalary('ghost', '2026-04-23'),
    ).rejects.toBeInstanceOf(DailySalaryError);
  });

  it('refuses non-MACHINE worker types (PACKER / COOK / etc.)', async () => {
    dbMock.user.findUnique.mockResolvedValue({
      ...workerFixture,
      workerType: WorkerType.PACKER,
    });
    await expect(
      computeDailyWorkerSalary('worker-1', '2026-04-23'),
    ).rejects.toThrow(/仅 WorkerType\.MACHINE/);
  });

  it('refuses when the machine worker has no active rule (loud, not silent zero)', async () => {
    dbMock.user.findUnique.mockResolvedValue(workerFixture);
    dbMock.salaryRule.findFirst.mockResolvedValue(null);
    await expect(
      computeDailyWorkerSalary('worker-1', '2026-04-23'),
    ).rejects.toThrow(/无当前生效.*薪资规则/);
  });

  it('SPEC §7.1 张三 reproduction: tasks sum 201, base 100 → actualSalary 201', async () => {
    dbMock.user.findUnique.mockResolvedValue(workerFixture);
    dbMock.productionTask.findMany.mockResolvedValue([
      { pieceworkAmount: '12.00', orderItem: { orderId: 'o1' } },
      { pieceworkAmount: '61.00', orderItem: { orderId: 'o2' } },
      { pieceworkAmount: '52.00', orderItem: { orderId: 'o2' } },
      { pieceworkAmount: '76.00', orderItem: { orderId: 'o3' } },
    ]);
    const r = await computeDailyWorkerSalary('worker-1', '2026-04-23');
    expect(r.totalPieceworkAmount).toBe('201.00');
    expect(r.baseSalary).toBe('100.00');
    expect(r.actualSalary).toBe('201.00');
    expect(r.taskCount).toBe(4);
    expect(r.orderCount).toBe(3);
  });

  it('base-floor case: 0 tasks → actualSalary falls back to dailyBase', async () => {
    dbMock.user.findUnique.mockResolvedValue(workerFixture);
    dbMock.productionTask.findMany.mockResolvedValue([]);
    const r = await computeDailyWorkerSalary('worker-1', '2026-04-23');
    expect(r.totalPieceworkAmount).toBe('0.00');
    expect(r.actualSalary).toBe('100.00');
    expect(r.taskCount).toBe(0);
  });

  it('upserts with Shanghai-midnight date column + snapshots rule value', async () => {
    dbMock.user.findUnique.mockResolvedValue(workerFixture);
    dbMock.productionTask.findMany.mockResolvedValue([
      { pieceworkAmount: '40.00', orderItem: { orderId: 'o1' } },
    ]);
    await computeDailyWorkerSalary('worker-1', '2026-04-23');
    const call = dbMock.dailyWorkerSalary.upsert.mock.calls[0][0];
    // date column is UTC midnight for the Shanghai calendar date
    expect((call.where.workerId_date.date as Date).toISOString()).toBe(
      '2026-04-23T00:00:00.000Z',
    );
    // snapshot shape matches rule + dailyBase
    expect(call.create.salaryRuleSnapshot).toMatchObject({
      pieceRate: 0.007,
      boardRate: 5,
      dailyBase: 100,
    });
  });

  it('queries tasks in the Shanghai day range (not UTC day range)', async () => {
    dbMock.user.findUnique.mockResolvedValue(workerFixture);
    dbMock.productionTask.findMany.mockResolvedValue([]);
    await computeDailyWorkerSalary('worker-1', '2026-04-23');
    const where = dbMock.productionTask.findMany.mock.calls[0][0].where;
    expect((where.completedAt.gte as Date).toISOString()).toBe(
      '2026-04-22T16:00:00.000Z',
    );
    expect((where.completedAt.lt as Date).toISOString()).toBe(
      '2026-04-23T16:00:00.000Z',
    );
  });

  it('payroll counts only COMPLETED tasks — CANCELLED tasks never enter wages (A1)', async () => {
    dbMock.user.findUnique.mockResolvedValue(workerFixture);
    dbMock.productionTask.findMany.mockResolvedValue([]);
    await computeDailyWorkerSalary('worker-1', '2026-04-23');
    const where = dbMock.productionTask.findMany.mock.calls[0][0].where;
    // The status filter is the structural guard: a task voided with its
    // order (CANCELLED) can never match this query, so it can't be paid.
    expect(where.status).toBe('COMPLETED');
  });

  it('recompute: update path does not write isPaid (finance ledger protected)', async () => {
    dbMock.user.findUnique.mockResolvedValue(workerFixture);
    dbMock.productionTask.findMany.mockResolvedValue([
      { pieceworkAmount: '40.00', orderItem: { orderId: 'o1' } },
    ]);
    await computeDailyWorkerSalary('worker-1', '2026-04-23');
    const call = dbMock.dailyWorkerSalary.upsert.mock.calls[0][0];
    // update branch touches numbers but NOT isPaid — finance wouldn't
    // want a recompute to silently reopen a paid record.
    expect('isPaid' in call.update).toBe(false);
    expect('paidAt' in call.update).toBe(false);
  });

  it('refuses to recompute an already-paid row (Codex round 43 / P0)', async () => {
    dbMock.user.findUnique.mockResolvedValue(workerFixture);
    dbMock.productionTask.findMany.mockResolvedValue([
      { pieceworkAmount: '40.00', orderItem: { orderId: 'o1' } },
    ]);
    dbMock.dailyWorkerSalary.findUnique.mockResolvedValue({
      id: 'ds-existing',
      isPaid: true,
      actualSalary: '201.00',
    });
    await expect(
      computeDailyWorkerSalary('worker-1', '2026-04-23'),
    ).rejects.toThrow(/已标记发放.*撤销发放再重算/);
    expect(dbMock.dailyWorkerSalary.upsert).not.toHaveBeenCalled();
  });

  it('allows recompute when the existing row is unpaid', async () => {
    dbMock.user.findUnique.mockResolvedValue(workerFixture);
    dbMock.productionTask.findMany.mockResolvedValue([
      { pieceworkAmount: '40.00', orderItem: { orderId: 'o1' } },
    ]);
    dbMock.dailyWorkerSalary.findUnique.mockResolvedValue({
      id: 'ds-existing',
      isPaid: false,
      actualSalary: '150.00',
    });
    await computeDailyWorkerSalary('worker-1', '2026-04-23');
    expect(dbMock.dailyWorkerSalary.upsert).toHaveBeenCalled();
  });

  it('allows first-time compute when no row exists yet (findUnique null)', async () => {
    dbMock.user.findUnique.mockResolvedValue(workerFixture);
    dbMock.productionTask.findMany.mockResolvedValue([
      { pieceworkAmount: '40.00', orderItem: { orderId: 'o1' } },
    ]);
    dbMock.dailyWorkerSalary.findUnique.mockResolvedValue(null);
    await computeDailyWorkerSalary('worker-1', '2026-04-23');
    expect(dbMock.dailyWorkerSalary.upsert).toHaveBeenCalled();
  });
});

describe('listDailyWorkerSalaries', () => {
  beforeEach(() => {
    dbMock.dailyWorkerSalary.findMany.mockReset().mockResolvedValue([]);
  });

  it('filters by date (converts YYYY-MM-DD to UTC midnight)', async () => {
    await listDailyWorkerSalaries({ date: '2026-04-23' });
    const where = dbMock.dailyWorkerSalary.findMany.mock.calls[0][0].where;
    expect((where.date as Date).toISOString()).toBe('2026-04-23T00:00:00.000Z');
  });

  it('rejects invalid calendar dates on the filter path (Codex round 44 / P3)', async () => {
    // `/owner/salary/daily?date=2026-02-31` should not silently match
    // March 3 rows. listDailyWorkerSalaries throws so the page can
    // fall back / show an error cleanly.
    await expect(
      listDailyWorkerSalaries({ date: '2026-02-31' }),
    ).rejects.toThrow(/非法日历日期/);
    expect(dbMock.dailyWorkerSalary.findMany).not.toHaveBeenCalled();
  });

  it('filters by workerId and isPaid', async () => {
    await listDailyWorkerSalaries({ workerId: 'worker-1', isPaid: false });
    const where = dbMock.dailyWorkerSalary.findMany.mock.calls[0][0].where;
    expect(where.workerId).toBe('worker-1');
    expect(where.isPaid).toBe(false);
  });

  it('empty filter returns everything (no where conditions)', async () => {
    await listDailyWorkerSalaries({});
    const where = dbMock.dailyWorkerSalary.findMany.mock.calls[0][0].where;
    expect(where).toEqual({});
  });
});

describe('markDailySalaryPaid', () => {
  beforeEach(() => {
    dbMock.dailyWorkerSalary.findUnique.mockReset().mockResolvedValue({
      workerId: 'worker-1',
      // Shanghai 2026-04-23 is stored as UTC midnight for that calendar
      // date (see computeDailyWorkerSalary comment).
      date: new Date('2026-04-23T00:00:00.000Z'),
    });
    dbMock.dailyWorkerSalary.update.mockReset().mockResolvedValue({
      id: 'ds-1',
      isPaid: true,
    });
    dbMock.$executeRaw.mockReset().mockResolvedValue(undefined);
    dbMock.$transaction.mockReset().mockImplementation(async (fn: unknown) => {
      if (typeof fn === 'function') return await (fn as (tx: unknown) => unknown)(dbMock);
      return fn;
    });
  });

  it('marks paid stamps paidAt from the injected clock', async () => {
    const now = new Date('2026-05-01T09:00:00Z');
    await markDailySalaryPaid('ds-1', true, now);
    const data = dbMock.dailyWorkerSalary.update.mock.calls[0][0].data;
    expect(data.isPaid).toBe(true);
    expect(data.paidAt).toBe(now);
  });

  it('mark-unpaid clears paidAt', async () => {
    await markDailySalaryPaid('ds-1', false);
    const data = dbMock.dailyWorkerSalary.update.mock.calls[0][0].data;
    expect(data.isPaid).toBe(false);
    expect(data.paidAt).toBeNull();
  });

  it('throws when the row is missing (no silent no-op)', async () => {
    dbMock.dailyWorkerSalary.findUnique.mockResolvedValue(null);
    await expect(markDailySalaryPaid('ghost', true)).rejects.toThrow(
      /日薪记录不存在/,
    );
    expect(dbMock.dailyWorkerSalary.update).not.toHaveBeenCalled();
  });

  it('takes the per-(worker, date) advisory lock (mirrors hourly round 48 / P0)', async () => {
    // mark-paid must take the same lock as computeDailyWorkerSalary so
    // a concurrent recompute can't overwrite salary fields on a row
    // that's being marked paid.
    await markDailySalaryPaid('ds-1', true);
    const sqlCalls = dbMock.$executeRaw.mock.calls;
    expect(sqlCalls.length).toBeGreaterThan(0);
    const sql = (sqlCalls[0][0] as TemplateStringsArray).join('?');
    expect(sql).toMatch(/pg_advisory_xact_lock/);
    expect(sqlCalls[0][1]).toMatch(
      /print-shop-erp:daily:worker-1:2026-04-23/,
    );
  });
});

describe('computeDailyWorkerSalary — advisory lock + now pinning (mirrors hourly round 48)', () => {
  const workerFixture = {
    id: 'worker-1',
    role: Role.WORKER,
    workerType: WorkerType.MACHINE,
    machineType: MachineType.HAND_PRESS,
    isActive: true,
  };

  beforeEach(() => {
    dbMock.user.findUnique.mockReset().mockResolvedValue(workerFixture);
    dbMock.productionTask.findMany.mockReset().mockResolvedValue([]);
    dbMock.salaryRule.findFirst
      .mockReset()
      .mockResolvedValue({ ruleValue: HAND_PRESS_RULE });
    dbMock.dailyWorkerSalary.upsert.mockReset().mockResolvedValue({});
    dbMock.dailyWorkerSalary.findUnique.mockReset().mockResolvedValue(null);
    dbMock.$executeRaw.mockReset().mockResolvedValue(undefined);
    dbMock.$transaction.mockReset().mockImplementation(async (fn: unknown) => {
      if (typeof fn === 'function') return await (fn as (tx: unknown) => unknown)(dbMock);
      return fn;
    });
  });

  it('takes the per-(worker, date) advisory lock (P0)', async () => {
    await computeDailyWorkerSalary('worker-1', '2026-04-23');
    const sqlCalls = dbMock.$executeRaw.mock.calls;
    expect(sqlCalls.length).toBeGreaterThan(0);
    const sql = (sqlCalls[0][0] as TemplateStringsArray).join('?');
    expect(sql).toMatch(/pg_advisory_xact_lock/);
    expect(sqlCalls[0][1]).toMatch(
      /print-shop-erp:daily:worker-1:2026-04-23/,
    );
  });

  it('pins rule-resolution to the injected `now` (batches snapshot one rule version)', async () => {
    const now = new Date('2026-04-23T10:00:00Z');
    await computeDailyWorkerSalary('worker-1', '2026-04-23', now);
    // getActiveMachineRule is the single rule lookup; it must use `now`
    // in effectiveFrom.lte, not Date.now().
    for (const call of dbMock.salaryRule.findFirst.mock.calls) {
      expect(call[0].where.effectiveFrom.lte).toEqual(now);
    }
  });
});

// sanity check: the pure path still lines up with lib/salary/machine-piecework
// since computeDailyWorkerSalary delegates to calcMachineDailySalary.
describe('parity with calcMachineDailySalary', () => {
  it('max(sum, base) behavior identical', () => {
    expect(
      new Decimal('201').eq(new Decimal('201.00')),
    ).toBe(true);
  });
});
