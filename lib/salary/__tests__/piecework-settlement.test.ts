import Decimal from 'decimal.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PieceworkSettlementStatus,
  Role,
} from '../../../generated/prisma/enums';

const { dbMock, databaseClockNowMock, databaseNowMock } = vi.hoisted(() => ({
  databaseClockNowMock: vi.fn(),
  databaseNowMock: vi.fn(),
  dbMock: {
    pieceworkSettlement: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    productionReport: { findMany: vi.fn() },
    productionJob: { count: vi.fn().mockResolvedValue(0) },
    productionWage: { findMany: vi.fn(), updateMany: vi.fn() },
    user: { findUnique: vi.fn() },
    businessAuditLog: { create: vi.fn() },
    $executeRaw: vi.fn(),
    $transaction: vi.fn(),
  },
}));

vi.mock('@/lib/db', () => ({ db: dbMock }));
vi.mock('@/lib/background-jobs/clock', () => ({
  databaseClockNow: databaseClockNowMock,
  databaseNow: databaseNowMock,
}));

import {
  aggregatePieceworkSettlementReports,
  getPieceworkSettlementDay,
  getPieceworkSettlementDetail,
  listWorkerPieceworkSettlements,
  lockPieceworkSettlement,
  lockPieceworkSettlementsForDate,
  markPieceworkSettlementPaid,
  PieceworkSettlementError,
} from '../piecework-settlement';

const NOW = new Date('2026-08-28T08:00:00.000Z');
const ACTOR = {
  id: 'admin-1',
  role: Role.ADMIN,
  username: 'owner',
  displayName: '管理员',
};

function report(
  id: string,
  amount: string,
  operationType: 'PARTIAL' | 'FULL' | 'PACKING',
  orderId = `order-${id}`,
) {
  return {
    id,
    amount: new Decimal(amount),
    priceBook: { rules: [] },
    entryType: amount.startsWith('-') ? 'REVERSAL' : 'REPORT',
    reportedAt: new Date('2026-08-27T04:00:00.000Z'),
    operation: { id: `operation-${id}`, orderId, operationType },
  };
}

function settlementRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: 'settlement-1',
    reporterId: 'worker-1',
    workDate: new Date('2026-08-27T00:00:00.000Z'),
    status: PieceworkSettlementStatus.LOCKED,
    reportAmount: new Decimal('8.25'),
    adjustmentAmount: new Decimal('0.00'),
    payableAmount: new Decimal('8.25'),
    reporter: { displayName: '张师傅' },
    _count: { items: 3 },
    ...overrides,
  };
}

beforeEach(() => {
  for (const delegate of [
    dbMock.pieceworkSettlement,
    dbMock.productionReport,
    dbMock.user,
    dbMock.businessAuditLog,
  ]) {
    for (const method of Object.values(delegate)) method.mockReset();
  }
  dbMock.productionWage.findMany.mockReset().mockResolvedValue([]);
  dbMock.productionWage.updateMany.mockReset().mockResolvedValue({ count: 0 });
  dbMock.$executeRaw.mockReset().mockResolvedValue(0);
  dbMock.$transaction
    .mockReset()
    .mockImplementation(async (run: (tx: typeof dbMock) => unknown) =>
      run(dbMock),
    );
  databaseNowMock.mockReset().mockResolvedValue(NOW);
  databaseClockNowMock.mockReset().mockResolvedValue(NOW);
  dbMock.pieceworkSettlement.findUnique.mockResolvedValue(null);
  dbMock.user.findUnique.mockResolvedValue({
    id: 'worker-1',
    displayName: '张师傅',
  });
  dbMock.productionJob.count.mockResolvedValue(0);
  dbMock.productionReport.findMany.mockResolvedValue([
    report('partial', '3.00', 'PARTIAL', 'order-1'),
    report('full', '5.00', 'FULL', 'order-2'),
    report('packing', '0.25', 'PACKING', 'order-2'),
  ]);
  dbMock.pieceworkSettlement.create.mockResolvedValue(settlementRow());
  dbMock.businessAuditLog.create.mockResolvedValue({ id: 'audit-1' });
});

describe('aggregatePieceworkSettlementReports', () => {
  it('sums immutable operation reports, including PACKING, without a daily-base floor', () => {
    const result = aggregatePieceworkSettlementReports([
      report('partial', '3.00', 'PARTIAL', 'order-1'),
      report('full', '5.00', 'FULL', 'order-2'),
      report('packing', '0.25', 'PACKING', 'order-2'),
    ]);
    expect(result.reportAmount.toFixed(2)).toBe('8.25');
    expect(result.reportCount).toBe(3);
    expect(result.orderCount).toBe(2);
    expect(result.operationCounts).toEqual({
      PARTIAL: 1,
      FULL: 1,
      PACKING: 1,
    });
  });

  it('nets an exact reversal from the append-only ledger', () => {
    const result = aggregatePieceworkSettlementReports([
      report('original', '5.00', 'FULL'),
      report('reversal', '-5.00', 'FULL'),
      report('packing', '0.50', 'PACKING'),
    ]);
    expect(result.reportAmount.toFixed(2)).toBe('0.50');
  });

  it('rejects duplicate report ids instead of paying the same scan twice', () => {
    expect(() =>
      aggregatePieceworkSettlementReports([
        report('same', '1.00', 'FULL'),
        report('same', '1.00', 'FULL'),
      ]),
    ).toThrow(PieceworkSettlementError);
  });
});

describe('lockPieceworkSettlementsForDate', () => {
  it('holds the closed-day discovery gate while scanning reporters', async () => {
    dbMock.productionReport.findMany.mockResolvedValue([]);

    await expect(
      lockPieceworkSettlementsForDate({
        workDate: '2026-08-27',
        actor: ACTOR,
        now: NOW,
      }),
    ).resolves.toEqual({ settled: [], errors: [] });

    expect(dbMock.$executeRaw.mock.calls[0]?.[1]).toBe(
      'print-shop-erp:piecework-reporting-day:2026-08-27',
    );
    expect(dbMock.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      dbMock.productionReport.findMany.mock.invocationCallOrder[0]!,
    );
  });

  it('uses the database wall clock for the closed-day boundary', async () => {
    await expect(
      lockPieceworkSettlementsForDate({
        workDate: '2026-08-28',
        actor: ACTOR,
      }),
    ).rejects.toMatchObject({ code: 'OPEN_WORK_DATE' });

    expect(databaseClockNowMock).toHaveBeenCalledWith(dbMock);
    expect(dbMock.productionReport.findMany).not.toHaveBeenCalled();
  });
});

describe('piecework settlement read models', () => {
  it('keeps unlocked candidates separate from finance-of-record settlements', async () => {
    dbMock.pieceworkSettlement.findMany.mockResolvedValue([
      {
        ...settlementRow(),
        lockedAt: NOW,
        paidAt: null,
        reporter: { displayName: '张师傅', username: 'zhang' },
      },
    ]);
    dbMock.productionReport.findMany.mockResolvedValue([
      {
        id: 'report-1',
        reporterId: 'worker-2',
        amount: new Decimal('2.50'),
        reporter: { displayName: '李师傅', username: 'li' },
        operation: { orderId: 'order-1', operationType: 'PACKING' },
      },
      {
        id: 'report-2',
        reporterId: 'worker-2',
        amount: new Decimal('1.50'),
        reporter: { displayName: '李师傅', username: 'li' },
        operation: { orderId: 'order-1', operationType: 'PACKING' },
      },
    ]);

    const result = await getPieceworkSettlementDay({
      workDate: '2026-08-27',
    });

    expect(result.settlements).toHaveLength(1);
    expect(result.candidates).toEqual([
      expect.objectContaining({
        reporterId: 'worker-2',
        reportAmount: '4.00',
        reportCount: 2,
        orderCount: 1,
        operationCounts: { PACKING: 2 },
      }),
    ]);
  });

  it('scopes worker list and detail reads by reporter id', async () => {
    dbMock.pieceworkSettlement.findMany.mockResolvedValue([]);
    dbMock.pieceworkSettlement.findFirst.mockResolvedValue(null);

    await listWorkerPieceworkSettlements({ reporterId: 'worker-1' });
    await getPieceworkSettlementDetail('settlement-1', { id: 'worker-1', role: Role.WORKER });

    expect(dbMock.pieceworkSettlement.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { reporterId: 'worker-1' } }),
    );
    expect(dbMock.pieceworkSettlement.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'settlement-1', reporterId: 'worker-1' },
      }),
    );
  });
});

it('fails closed before querying when the settlement actor is missing or unrelated', async () => {
  // @ts-expect-error runtime callers cannot bypass the required actor either
  await expect(getPieceworkSettlementDetail('settlement-1')).rejects.toThrow('无权');
  await expect(getPieceworkSettlementDetail('settlement-1', { id: 'sales', role: Role.SALES })).rejects.toThrow('无权');
  expect(dbMock.pieceworkSettlement.findFirst).not.toHaveBeenCalled();
});

it('allows an explicit admin actor to read a settlement', async () => {
  await getPieceworkSettlementDetail('settlement-1', { id: 'admin', role: Role.ADMIN });
  expect(dbMock.pieceworkSettlement.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'settlement-1' } }));
});

describe('lockPieceworkSettlement', () => {
  it('locks only ProductionReport rows for one closed Shanghai day', async () => {
    const receipt = await lockPieceworkSettlement({
      reporterId: 'worker-1',
      workDate: '2026-08-27',
      actor: ACTOR,
      now: NOW,
    });

    expect(receipt).toMatchObject({
      id: 'settlement-1',
      reportAmount: '8.25',
      payableAmount: '8.25',
      reportCount: 3,
      idempotentReplay: false,
    });
    expect(dbMock.productionReport.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          reporterId: 'worker-1',
          settlementItem: null,
        }),
      }),
    );
    // The new settlement boundary has no ProductionTask delegate at all.
    expect('productionTask' in dbMock).toBe(false);
    expect(dbMock.pieceworkSettlement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: PieceworkSettlementStatus.LOCKED,
          reportAmount: '8.25',
          adjustmentAmount: '0.00',
          payableAmount: '8.25',
          items: { create: expect.any(Array) },
        }),
      }),
    );
    const createCall = dbMock.pieceworkSettlement.create.mock.calls[0]?.[0];
    expect(createCall.data.items.create).toHaveLength(3);
    expect(createCall.data.snapshot).toMatchObject({
      ledger: 'PRODUCTION_REPORT_AND_COMPLETION',
      legacyProductionTaskIncluded: false,
      operationCounts: { PARTIAL: 1, FULL: 1, PACKING: 1 },
    });
  });

  it('rejects current-day locking so later scans cannot be omitted', async () => {
    await expect(
      lockPieceworkSettlement({
        reporterId: 'worker-1',
        workDate: '2026-08-28',
        actor: ACTOR,
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: 'OPEN_WORK_DATE' });
    expect(dbMock.productionReport.findMany).not.toHaveBeenCalled();
  });

  it('uses the database wall clock when a caller does not inject time', async () => {
    await expect(
      lockPieceworkSettlement({
        reporterId: 'worker-1',
        workDate: '2026-08-28',
        actor: ACTOR,
      }),
    ).rejects.toMatchObject({ code: 'OPEN_WORK_DATE' });

    expect(databaseClockNowMock).toHaveBeenCalledWith(dbMock);
    expect(dbMock.productionReport.findMany).not.toHaveBeenCalled();
  });

  it('returns an existing locked settlement without rebuilding items', async () => {
    dbMock.pieceworkSettlement.findUnique.mockResolvedValue(settlementRow());
    const receipt = await lockPieceworkSettlement({
      reporterId: 'worker-1',
      workDate: '2026-08-27',
      actor: ACTOR,
      now: NOW,
    });
    expect(receipt.idempotentReplay).toBe(true);
    expect(dbMock.productionReport.findMany).not.toHaveBeenCalled();
    expect(dbMock.pieceworkSettlement.create).not.toHaveBeenCalled();
  });

  it('fails closed when the closed day has no unsettled reports', async () => {
    dbMock.productionReport.findMany.mockResolvedValue([]);
    await expect(
      lockPieceworkSettlement({
        reporterId: 'worker-1',
        workDate: '2026-08-27',
        actor: ACTOR,
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: 'NO_REPORTS' });
    expect(dbMock.pieceworkSettlement.create).not.toHaveBeenCalled();
  });
});

describe('markPieceworkSettlementPaid', () => {
  it('moves LOCKED to PAID under the same reporter/day lock', async () => {
    dbMock.pieceworkSettlement.findUnique
      .mockResolvedValueOnce({
        reporterId: 'worker-1',
        workDate: new Date('2026-08-27T00:00:00.000Z'),
      })
      .mockResolvedValueOnce(settlementRow());
    dbMock.pieceworkSettlement.update.mockResolvedValue(
      settlementRow({ status: PieceworkSettlementStatus.PAID }),
    );

    const receipt = await markPieceworkSettlementPaid({
      settlementId: 'settlement-1',
      actor: ACTOR,
    });
    expect(receipt.status).toBe(PieceworkSettlementStatus.PAID);
    expect(dbMock.pieceworkSettlement.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          status: PieceworkSettlementStatus.PAID,
          paidAt: NOW,
        },
      }),
    );
  });
});

it('待人工核定的多人提成不能进入结算', async () => {
  const row = report('partial', '24.00', 'PARTIAL');
  dbMock.productionReport.findMany.mockResolvedValue([{ ...row, operation: { ...row.operation, payrollReviewRequired: true } }]);
  await expect(lockPieceworkSettlement({ reporterId: 'worker-1', workDate: '2026-08-27', actor: ACTOR })).rejects.toThrow('待人工核定');
  expect(dbMock.pieceworkSettlement.create).not.toHaveBeenCalled();
});

it.each([['PENDING', 'PARTIAL', 'PER_PASS'], ['IN_PROGRESS', 'PARTIAL', 'PER_PASS'], ['IN_PROGRESS', 'FULL', 'PER_PIECE']] as const)('分档烫金工序 %s %s 时禁止提前锁定固定费', async (status, operationType, unit) => {
  const row = report('foil', '24.00', operationType);
  dbMock.productionReport.findMany.mockResolvedValue([{ ...row, unit, priceBook: { rules: [{ operationType, unit, smallOrderAmount: '12' }] }, operation: { ...row.operation, status, payrollReviewRequired: false } }]);
  await expect(lockPieceworkSettlement({ reporterId: 'worker-1', workDate: '2026-08-27', actor: ACTOR })).rejects.toThrow('尚未结束');
  expect(dbMock.pieceworkSettlement.create).not.toHaveBeenCalled();
});

it.each(['COMPLETED', 'CANCELLED'])('已结束且已核定的分档工序 %s 可结算', async (status) => {
  const row = report('partial', '24.00', 'PARTIAL');
  dbMock.productionReport.findMany.mockResolvedValue([{ ...row, unit: 'PER_PASS', priceBook: { rules: [{ operationType: 'PARTIAL', unit: 'PER_PASS', smallOrderAmount: '12' }] }, operation: { ...row.operation, status, payrollReviewRequired: false } }]);
  await lockPieceworkSettlement({ reporterId: 'worker-1', workDate: '2026-08-27', actor: ACTOR });
  expect(dbMock.pieceworkSettlement.create).toHaveBeenCalled();
});
