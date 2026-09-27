import { beforeEach, describe, expect, it, vi } from 'vitest';

const { dbMock } = vi.hoisted(() => ({
  dbMock: { order: { findUnique: vi.fn() } },
}));

vi.mock('@/lib/db', () => ({ db: dbMock }));

import { withLegacyExternalSalesName } from '../legacy-external-sales';
import type { NotificationPayloadFor } from '../events';

const legacyCompleted = {
  orderId: 'o1',
  orderNo: 'O-1',
  workOrderVersion: 1,
  customerRef: null,
} as unknown as NotificationPayloadFor<'ORDER_COMPLETED'>;

beforeEach(() => {
  dbMock.order.findUnique.mockReset();
});

describe('withLegacyExternalSalesName', () => {
  it('fills the charged order submitter into a legacy payload', async () => {
    dbMock.order.findUnique.mockResolvedValueOnce({
      settlementType: 'EXTERNAL_SALES',
      submitter: { displayName: '外销甲' },
      sourceOrder: null,
    });
    await expect(withLegacyExternalSalesName('ORDER_COMPLETED', legacyCompleted)).resolves.toEqual({
      ...legacyCompleted,
      externalSalesName: '外销甲',
    });
  });

  it('writes 未填 when the order is gone or the payload has no order id', async () => {
    dbMock.order.findUnique.mockResolvedValueOnce(null);
    await expect(
      withLegacyExternalSalesName('ORDER_COMPLETED', legacyCompleted),
    ).resolves.toMatchObject({ externalSalesName: '未填' });

    const noOrder = { ...legacyCompleted, orderId: '' };
    await expect(withLegacyExternalSalesName('ORDER_COMPLETED', noOrder)).resolves.toMatchObject({
      externalSalesName: '未填',
    });
    expect(dbMock.order.findUnique).toHaveBeenCalledTimes(1);
  });

  it('falls back to 未填 instead of failing the delivery when the lookup throws', async () => {
    dbMock.order.findUnique.mockRejectedValueOnce(new Error('statement timeout'));
    await expect(
      withLegacyExternalSalesName('ORDER_COMPLETED', legacyCompleted),
    ).resolves.toMatchObject({ externalSalesName: '未填' });
  });

  it('leaves other events and current payloads untouched without a query', async () => {
    const shipped = { orderId: 'o1', orderNo: 'O-1', trackingNo: 'SF1' } as NotificationPayloadFor<'ORDER_SHIPPED'>;
    await expect(withLegacyExternalSalesName('ORDER_SHIPPED', shipped)).resolves.toBe(shipped);

    const current = { ...legacyCompleted, externalSalesName: '桂林' };
    await expect(withLegacyExternalSalesName('ORDER_COMPLETED', current)).resolves.toBe(current);
    expect(dbMock.order.findUnique).not.toHaveBeenCalled();
  });
});
