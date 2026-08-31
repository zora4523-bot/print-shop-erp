import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findManyMock } = vi.hoisted(() => ({ findManyMock: vi.fn() }));
vi.mock('@/lib/db', () => ({
  db: { pieceworkSettlement: { findMany: findManyMock } },
}));

import {
  buildPieceworkSettlementWorkbook,
  loadPieceworkSettlementExportData,
} from '../piecework-settlement-xlsx';

beforeEach(() => {
  findManyMock.mockReset().mockResolvedValue([]);
});

describe('new piecework settlement export', () => {
  it('queries only the new settlement ledger in the requested date range', async () => {
    await loadPieceworkSettlementExportData({
      from: '2026-08-01',
      to: '2026-08-31',
      workerId: 'worker-1',
    });

    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          workDate: {
            gte: new Date('2026-08-01T00:00:00.000Z'),
            lt: new Date('2026-09-01T00:00:00.000Z'),
          },
          reporterId: 'worker-1',
        },
      }),
    );
  });

  it('rejects inverted or invalid date ranges before reading data', async () => {
    await expect(
      loadPieceworkSettlementExportData({
        from: '2026-08-31',
        to: '2026-08-01',
      }),
    ).rejects.toThrow(/日期范围不合法/);
    expect(findManyMock).not.toHaveBeenCalled();
  });

  it('builds a standalone two-sheet xlsx even when the ledger is empty', async () => {
    const workbook = await buildPieceworkSettlementWorkbook([]);

    expect(workbook.subarray(0, 2).toString()).toBe('PK');
    expect(workbook.length).toBeGreaterThan(1_000);
  });
});
