import { beforeEach, describe, expect, it, vi } from 'vitest';

const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    $queryRaw: vi.fn(),
  },
}));

vi.mock('@/lib/db', () => ({ db: dbMock }));

import {
  DailyDocumentNumberExhaustedError,
  formatBusinessDateKey,
  nextDailyDocumentNumber,
} from '../daily-document-number';

beforeEach(() => {
  dbMock.$queryRaw.mockReset();
});

describe('formatBusinessDateKey', () => {
  it('uses the Asia/Shanghai calendar day independently of the server timezone', () => {
    expect(formatBusinessDateKey(new Date('2026-07-16T16:30:00.000Z'))).toBe(
      '20260717',
    );
  });
});

describe('nextDailyDocumentNumber', () => {
  it.each([
    ['PURCHASE_ORDER', 'PO20260717-0042'],
    ['PURCHASE_RECEIPT', 'PR20260717-0042'],
    ['STOCK_TRANSFER', 'ST20260717-0042'],
    ['INVENTORY_COUNT', 'IC20260717-0042'],
  ] as const)('formats %s numbers', async (kind, expected) => {
    dbMock.$queryRaw.mockResolvedValueOnce([{ value: 42 }]);
    await expect(
      nextDailyDocumentNumber(kind, new Date('2026-07-17T00:00:00+08:00')),
    ).resolves.toBe(expected);
    expect(dbMock.$queryRaw.mock.calls[0]!.slice(1)).toEqual([
      `${kind}:20260717`,
      9_999,
    ]);
  });

  it('fails explicitly without widening the public format after 9999', async () => {
    dbMock.$queryRaw.mockResolvedValueOnce([]);
    await expect(
      nextDailyDocumentNumber(
        'STOCK_TRANSFER',
        new Date('2026-07-17T00:00:00+08:00'),
      ),
    ).rejects.toBeInstanceOf(DailyDocumentNumberExhaustedError);
  });
});
