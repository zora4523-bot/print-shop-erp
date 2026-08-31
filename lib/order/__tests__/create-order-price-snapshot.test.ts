import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CustomerPriceBookPurpose,
  OrderSettlementType,
} from '../../../generated/prisma/enums';

const { dbMock, txMock } = vi.hoisted(() => {
  const tx = {
    $executeRaw: vi.fn(),
    customerPriceBook: { findMany: vi.fn() },
  };
  return {
    txMock: tx,
    dbMock: {
      $transaction: vi.fn(
        async (callback: (client: typeof tx) => Promise<unknown>) =>
          callback(tx),
      ),
    },
  };
});

vi.mock('@/lib/db', () => ({ db: dbMock }));

import {
  loadExternalCreateOrderPriceSnapshot,
  readExternalCreateOrderPriceSnapshot,
} from '../create-order-price-snapshot';

const PROCESSING_SHA = 'a'.repeat(64);
const LOGISTICS_SHA = 'b'.repeat(64);
const now = new Date('2026-08-28T08:00:00.000Z');

const processing = {
  purpose: CustomerPriceBookPurpose.PROCESSING,
  id: 'processing-v12',
  code: 'EXTERNAL-PROCESSING',
  name: '外部销售加工费',
  version: 12,
  sourceSha256: PROCESSING_SHA,
} as const;

const logistics = {
  purpose: CustomerPriceBookPurpose.LOGISTICS,
  id: 'logistics-v4',
  code: 'EXTERNAL-LOGISTICS',
  name: '外部销售包装物流',
  version: 4,
  sourceSha256: LOGISTICS_SHA,
} as const;

beforeEach(() => {
  vi.clearAllMocks();
  txMock.$executeRaw.mockResolvedValue(0);
  txMock.customerPriceBook.findMany.mockResolvedValue([
    logistics,
    processing,
  ]);
});

describe('external create-order price snapshot', () => {
  it('reads two distinct current streams under one shared lock', async () => {
    await expect(
      readExternalCreateOrderPriceSnapshot(txMock as never, { now }),
    ).resolves.toEqual({ processing, logistics });

    expect(txMock.$executeRaw).toHaveBeenCalledOnce();
    expect(txMock.customerPriceBook.findMany).toHaveBeenCalledWith({
      where: {
        settlementType: OrderSettlementType.EXTERNAL_SALES,
        purpose: {
          in: [
            CustomerPriceBookPurpose.PROCESSING,
            CustomerPriceBookPurpose.LOGISTICS,
          ],
        },
        isActive: true,
        effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
      },
      select: {
        purpose: true,
        id: true,
        code: true,
        name: true,
        version: true,
        sourceSha256: true,
      },
      orderBy: [
        { purpose: 'asc' },
        { effectiveFrom: 'desc' },
        { version: 'desc' },
        { id: 'asc' },
      ],
    });
    expect(processing.version).not.toBe(logistics.version);
  });

  it.each([
    ['processing', [logistics]],
    ['logistics', [processing]],
  ] as const)('fails closed when %s stream is missing', async (_label, rows) => {
    txMock.customerPriceBook.findMany.mockResolvedValue(rows);
    await expect(
      readExternalCreateOrderPriceSnapshot(txMock as never, { now }),
    ).rejects.toMatchObject({
      code: 'MISSING_PRICE_BOOK',
    });
  });

  it.each([
    [CustomerPriceBookPurpose.PROCESSING, processing, logistics],
    [CustomerPriceBookPurpose.LOGISTICS, logistics, processing],
  ] as const)('fails closed when %s has overlapping active books', async (
    _purpose,
    duplicate,
    other,
  ) => {
    txMock.customerPriceBook.findMany.mockResolvedValue([
      other,
      duplicate,
      { ...duplicate, id: `${duplicate.id}-duplicate`, version: 99 },
    ]);
    await expect(
      readExternalCreateOrderPriceSnapshot(txMock as never, { now }),
    ).rejects.toMatchObject({
      code: 'DUPLICATE_PRICE_BOOK',
    });
  });

  it('rejects malformed version evidence instead of synthesizing a hash', async () => {
    txMock.customerPriceBook.findMany.mockResolvedValue([
      { ...processing, sourceSha256: 'not-a-sha' },
      logistics,
    ]);
    await expect(
      readExternalCreateOrderPriceSnapshot(txMock as never, { now }),
    ).rejects.toMatchObject({
      code: 'INVALID_PRICE_BOOK_METADATA',
    });
  });

  it('supports composition in an existing locked transaction and a standalone transaction entry point', async () => {
    await readExternalCreateOrderPriceSnapshot(txMock as never, {
      now,
      snapshotLockHeld: true,
    });
    expect(txMock.$executeRaw).not.toHaveBeenCalled();

    await loadExternalCreateOrderPriceSnapshot(now);
    expect(dbMock.$transaction).toHaveBeenCalledOnce();
    expect(txMock.$executeRaw).toHaveBeenCalledOnce();
  });

  it('rejects an invalid injected clock before querying', async () => {
    await expect(
      readExternalCreateOrderPriceSnapshot(txMock as never, {
        now: new Date(Number.NaN),
      }),
    ).rejects.toMatchObject({
      code: 'INVALID_NOW',
    });
    expect(txMock.customerPriceBook.findMany).not.toHaveBeenCalled();
  });
});
