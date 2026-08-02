import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CsSalesEntryType } from '../../../generated/prisma/client';
import {
  assertCsOrderSalesLedgerReconciledInTx,
  CsSalesLedgerError,
  CsSalesPeriodMissingError,
  recordCsSalesEntryInTx,
} from '../cs-sales';

const tx = {
  $executeRaw: vi.fn(),
  csSalesEntry: {
    aggregate: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
  },
  salaryPeriod: {
    findFirst: vi.fn(),
    update: vi.fn(),
  },
};

const input = {
  eventKey: 'order:order-1:revision:1:submit',
  csUserId: 'cs-1',
  orderId: 'order-1',
  orderRevision: 1,
  type: CsSalesEntryType.ORDER_SUBMITTED,
  amount: '1200.00',
  occurredAt: new Date('2026-07-31T03:00:00Z'),
  remark: '工单提交',
};

beforeEach(() => {
  tx.$executeRaw.mockReset().mockResolvedValue(undefined);
  tx.csSalesEntry.findUnique.mockReset().mockResolvedValue(null);
  tx.csSalesEntry.aggregate.mockReset().mockResolvedValue({
    _sum: { amount: '1200.00' },
  });
  tx.csSalesEntry.create.mockReset().mockResolvedValue({ id: 'entry-1' });
  tx.salaryPeriod.findFirst.mockReset().mockResolvedValue({
    id: 'period-1',
    totalSales: '0.00',
    initialSales: '0.00',
  });
  tx.salaryPeriod.update.mockReset().mockResolvedValue({ id: 'period-1' });
});

describe('assertCsOrderSalesLedgerReconciledInTx', () => {
  it('accepts an order whose immutable sales entries equal its current total', async () => {
    await expect(
      assertCsOrderSalesLedgerReconciledInTx(tx as never, 'order-1', '1200.00'),
    ).resolves.toBeUndefined();
    expect(tx.csSalesEntry.aggregate).toHaveBeenCalledWith({
      where: { orderId: 'order-1' },
      _sum: { amount: true },
    });
  });

  it('blocks a legacy order that has no order-level opening sales entry', async () => {
    tx.csSalesEntry.aggregate.mockResolvedValue({ _sum: { amount: null } });

    await expect(
      assertCsOrderSalesLedgerReconciledInTx(tx as never, 'legacy-1', '1200.00'),
    ).rejects.toThrow(/未与当前金额对平.*历史财务校准/);
  });
});

describe('recordCsSalesEntryInTx', () => {
  it('appends sales and increments the active period in one caller transaction', async () => {
    const result = await recordCsSalesEntryInTx(
      tx as never,
      input,
    );

    expect(result).toEqual({
      entryId: 'entry-1',
      periodId: 'period-1',
      amount: '1200.00',
    });
    expect(tx.csSalesEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventKey: input.eventKey,
        csUserId: 'cs-1',
        salaryPeriodId: 'period-1',
        amount: '1200.00',
        occurredAt: input.occurredAt,
      }),
      select: { id: true },
    });
    expect(tx.salaryPeriod.update).toHaveBeenCalledWith({
      where: { id: 'period-1' },
      data: { totalSales: { increment: '1200.00' } },
      select: { id: true },
    });
  });

  it('is idempotent for the same business event', async () => {
    tx.csSalesEntry.findUnique.mockResolvedValue({
      id: 'entry-existing',
      eventKey: input.eventKey,
      csUserId: input.csUserId,
      salaryPeriodId: 'period-1',
      orderId: input.orderId,
      orderRevision: input.orderRevision,
      type: input.type,
      amount: '1200.00',
      occurredAt: input.occurredAt,
      remark: input.remark,
    });

    const result = await recordCsSalesEntryInTx(tx as never, input);

    expect(result?.entryId).toBe('entry-existing');
    expect(tx.csSalesEntry.create).not.toHaveBeenCalled();
    expect(tx.salaryPeriod.update).not.toHaveBeenCalled();
  });

  it('rejects reuse of an event key with a different immutable payload', async () => {
    tx.csSalesEntry.findUnique.mockResolvedValue({
      id: 'entry-existing',
      eventKey: input.eventKey,
      csUserId: input.csUserId,
      salaryPeriodId: 'period-1',
      orderId: input.orderId,
      orderRevision: input.orderRevision,
      type: input.type,
      amount: '999.00',
      occurredAt: input.occurredAt,
      remark: input.remark,
    });

    await expect(
      recordCsSalesEntryInTx(tx as never, input),
    ).rejects.toBeInstanceOf(CsSalesLedgerError);
  });

  it('rejects the caller transaction when no active customer-service period exists', async () => {
    tx.salaryPeriod.findFirst.mockResolvedValue(null);

    await expect(
      recordCsSalesEntryInTx(tx as never, input),
    ).rejects.toBeInstanceOf(CsSalesPeriodMissingError);
    expect(tx.csSalesEntry.create).not.toHaveBeenCalled();
    expect(tx.salaryPeriod.update).not.toHaveBeenCalled();
  });

  it('compares @db.Date periods using the Shanghai date at the event instant', async () => {
    const firstLocalHour = new Date('2026-08-31T16:30:00.000Z');

    await recordCsSalesEntryInTx(tx as never, {
      ...input,
      occurredAt: firstLocalHour,
    });

    const where = tx.salaryPeriod.findFirst.mock.calls[0][0].where;
    expect(where.periodStart.lte.toISOString()).toBe(
      '2026-09-01T00:00:00.000Z',
    );
    expect(where.periodEnd.gte.toISOString()).toBe(
      '2026-09-01T00:00:00.000Z',
    );
  });

  it('keeps the final Shanghai day in the period until local midnight', async () => {
    const finalLocalHour = new Date('2026-09-30T15:59:59.999Z');

    await recordCsSalesEntryInTx(tx as never, {
      ...input,
      occurredAt: finalLocalHour,
    });

    const where = tx.salaryPeriod.findFirst.mock.calls[0][0].where;
    expect(where.periodStart.lte.toISOString()).toBe(
      '2026-09-30T00:00:00.000Z',
    );
    expect(where.periodEnd.gte.toISOString()).toBe(
      '2026-09-30T00:00:00.000Z',
    );
  });

  it('ignores zero-value adjustments', async () => {
    await expect(
      recordCsSalesEntryInTx(tx as never, { ...input, amount: '0' }),
    ).resolves.toBeNull();
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it('rejects a period total that would overflow Decimal(12,2)', async () => {
    tx.salaryPeriod.findFirst.mockResolvedValue({
      id: 'period-1',
      totalSales: '9999999999.99',
      initialSales: '0.00',
    });
    await expect(
      recordCsSalesEntryInTx(tx as never, { ...input, amount: '0.01' }),
    ).rejects.toThrow(/累计销售额超过/);
    expect(tx.csSalesEntry.create).not.toHaveBeenCalled();
  });

  it('rejects a tier total that would overflow after adding initial sales', async () => {
    tx.salaryPeriod.findFirst.mockResolvedValue({
      id: 'period-1',
      totalSales: '0.00',
      initialSales: '9000000000.00',
    });

    await expect(
      recordCsSalesEntryInTx(tx as never, {
        ...input,
        amount: '2000000000.00',
      }),
    ).rejects.toThrow(/算档业绩.*期初校准.*超过/);
    expect(tx.csSalesEntry.create).not.toHaveBeenCalled();
    expect(tx.salaryPeriod.update).not.toHaveBeenCalled();
  });
});
