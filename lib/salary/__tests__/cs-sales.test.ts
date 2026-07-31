import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CsSalesEntryType } from '../../../generated/prisma/client';
import { recordCsSalesEntryInTx } from '../cs-sales';

const tx = {
  $executeRaw: vi.fn(),
  csSalesEntry: {
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
  tx.csSalesEntry.create.mockReset().mockResolvedValue({ id: 'entry-1' });
  tx.salaryPeriod.findFirst.mockReset().mockResolvedValue({ id: 'period-1' });
  tx.salaryPeriod.update.mockReset().mockResolvedValue({ id: 'period-1' });
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
      salaryPeriodId: 'period-1',
      amount: '1200.00',
    });

    const result = await recordCsSalesEntryInTx(tx as never, input);

    expect(result?.entryId).toBe('entry-existing');
    expect(tx.csSalesEntry.create).not.toHaveBeenCalled();
    expect(tx.salaryPeriod.update).not.toHaveBeenCalled();
  });

  it('does not misattribute sales when no active customer-service period exists', async () => {
    tx.salaryPeriod.findFirst.mockResolvedValue(null);

    await expect(
      recordCsSalesEntryInTx(tx as never, input),
    ).resolves.toBeNull();
    expect(tx.csSalesEntry.create).not.toHaveBeenCalled();
    expect(tx.salaryPeriod.update).not.toHaveBeenCalled();
  });

  it('ignores zero-value adjustments', async () => {
    await expect(
      recordCsSalesEntryInTx(tx as never, { ...input, amount: '0' }),
    ).resolves.toBeNull();
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });
});
