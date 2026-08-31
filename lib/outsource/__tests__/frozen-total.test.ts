import { describe, expect, it } from 'vitest';
import {
  OUTSOURCE_FROZEN_TOTAL_MISSING_MESSAGE,
  OUTSOURCE_SNAPSHOT_INVALID_MESSAGE,
  OUTSOURCE_TOTAL_SNAPSHOT_MISMATCH_MESSAGE,
  readFrozenOutsourceTotal,
} from '../frozen-total';

describe('readFrozenOutsourceTotal', () => {
  it('sums every item snapshot from the same outsource order', () => {
    expect(
      readFrozenOutsourceTotal({
        orderItemIds: ['item-2', 'item-1'],
        totalQty: null,
        itemSnapshots: [
          { orderItemId: 'item-1', quantity: 5_000 },
          { orderItemId: 'item-2', quantity: 1_250 },
        ],
      }),
    ).toEqual({ ok: true, totalQty: 6_250 });
  });

  it('accepts canonical equality without mutating either item order', () => {
    const orderItemIds = ['item-2', 'item-1'];
    const itemSnapshots = [
      { orderItemId: 'item-1', quantity: 5_000 },
      { orderItemId: 'item-2', quantity: 1_250 },
    ];

    expect(
      readFrozenOutsourceTotal({
        orderItemIds,
        totalQty: 6_250,
        itemSnapshots,
      }),
    ).toEqual({ ok: true, totalQty: 6_250 });
    expect(orderItemIds).toEqual(['item-2', 'item-1']);
    expect(itemSnapshots.map((snapshot) => snapshot.orderItemId)).toEqual([
      'item-1',
      'item-2',
    ]);
  });

  it.each([
    {
      name: 'missing item snapshot',
      orderItemIds: ['item-1', 'item-2'],
      itemSnapshots: [{ orderItemId: 'item-1', quantity: 5_000 }],
    },
    {
      name: 'duplicate item snapshot',
      orderItemIds: ['item-1', 'item-2'],
      itemSnapshots: [
        { orderItemId: 'item-1', quantity: 2_500 },
        { orderItemId: 'item-1', quantity: 2_500 },
      ],
    },
    {
      name: 'non-positive quantity',
      orderItemIds: ['item-1'],
      itemSnapshots: [{ orderItemId: 'item-1', quantity: 0 }],
    },
    {
      name: 'non-integer quantity',
      orderItemIds: ['item-1'],
      itemSnapshots: [{ orderItemId: 'item-1', quantity: 0.5 }],
    },
  ])('rejects $name as an invalid snapshot ledger', (evidence) => {
    expect(
      readFrozenOutsourceTotal({
        ...evidence,
        totalQty: null,
      }),
    ).toEqual({
      ok: false,
      errorMessage: OUTSOURCE_SNAPSHOT_INVALID_MESSAGE,
    });
  });

  it('rejects an unsafe snapshot sum', () => {
    expect(
      readFrozenOutsourceTotal({
        orderItemIds: ['item-1', 'item-2'],
        totalQty: null,
        itemSnapshots: [
          { orderItemId: 'item-1', quantity: Number.MAX_SAFE_INTEGER },
          { orderItemId: 'item-2', quantity: 1 },
        ],
      }),
    ).toEqual({
      ok: false,
      errorMessage: OUTSOURCE_SNAPSHOT_INVALID_MESSAGE,
    });
  });

  it('rejects disagreement between the aggregate and item snapshots', () => {
    expect(
      readFrozenOutsourceTotal({
        orderItemIds: ['item-1'],
        totalQty: 4_999,
        itemSnapshots: [{ orderItemId: 'item-1', quantity: 5_000 }],
      }),
    ).toEqual({
      ok: false,
      errorMessage: OUTSOURCE_TOTAL_SNAPSHOT_MISMATCH_MESSAGE,
    });
  });

  it('falls back to a valid legacy aggregate when snapshots are absent', () => {
    expect(
      readFrozenOutsourceTotal({
        orderItemIds: ['item-1'],
        totalQty: 5_000,
        itemSnapshots: [],
      }),
    ).toEqual({ ok: true, totalQty: 5_000 });
  });

  it.each([null, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'fails closed for missing or invalid legacy evidence: %s',
    (totalQty) => {
      expect(
        readFrozenOutsourceTotal({
          orderItemIds: ['item-1'],
          totalQty,
          itemSnapshots: [],
        }),
      ).toEqual({
        ok: false,
        errorMessage: OUTSOURCE_FROZEN_TOTAL_MISSING_MESSAGE,
      });
    },
  );
});
