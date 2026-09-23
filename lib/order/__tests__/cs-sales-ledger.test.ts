import Decimal from 'decimal.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  OrderBillingMode,
  OrderSettlementType,
  OrderStatus,
} from '../../../generated/prisma/enums';

const mocks = vi.hoisted(() => ({
  basis: vi.fn(),
  reconcile: vi.fn(),
  record: vi.fn(),
}));

vi.mock('@/lib/salary/cs-sales', () => ({
  csSalesBasisAmountInTx: mocks.basis,
  assertCsOrderSalesLedgerReconciledInTx: mocks.reconcile,
  recordCsSalesEntryInTx: mocks.record,
}));

import { recordCsSalesBasisChangeInTx, reverseCsSalesOnOrderCancelInTx } from '../cs-sales-ledger';

const tx = {} as never;
const occurredAt = new Date('2026-09-02T02:00:00.000Z');
const event = { orderRevision: 4, occurredAt, remark: '取消工单：客户取消' };

function order(overrides: Partial<Parameters<typeof reverseCsSalesOnOrderCancelInTx>[1]> = {}) {
  return {
    id: 'order-1',
    submitterId: 'cs-1',
    settlementType: OrderSettlementType.INTERNAL_SALES,
    billingMode: OrderBillingMode.CHARGE,
    status: OrderStatus.CONFIRMED,
    totalAmount: new Decimal('1008.00'),
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.basis.mockResolvedValue('1000.00');
  mocks.reconcile.mockResolvedValue(undefined);
  mocks.record.mockResolvedValue({ entryId: 'entry-1', periodId: 'period-1', amount: '-1000.00' });
});

describe('reverseCsSalesOnOrderCancelInTx', () => {
  it('内部收费单按不含代收物流的业绩基数先对平、再追加全额负数', async () => {
    await reverseCsSalesOnOrderCancelInTx(tx, order(), event);

    expect(mocks.basis).toHaveBeenCalledWith(tx, 'order-1', new Decimal('1008.00'));
    expect(mocks.reconcile).toHaveBeenCalledWith(tx, 'order-1', '1000.00');
    expect(mocks.record).toHaveBeenCalledTimes(1);
    const [, input] = mocks.record.mock.calls[0]!;
    expect(input).toMatchObject({
      eventKey: 'order:order-1:revision:4:cancel',
      csUserId: 'cs-1',
      orderId: 'order-1',
      orderRevision: 4,
      type: 'ORDER_CANCELLED',
      occurredAt,
      remark: '取消工单：客户取消',
    });
    expect(new Decimal(input.amount).toFixed(2)).toBe('-1000.00');
    expect(mocks.reconcile.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.record.mock.invocationCallOrder[0]!,
    );
  });

  it.each([
    ['草稿从未计入业绩', order({ status: OrderStatus.DRAFT })],
    ['不收费单不计业绩', order({ billingMode: OrderBillingMode.NO_CHARGE })],
    ['外部销售单不计客服业绩', order({ settlementType: OrderSettlementType.EXTERNAL_SALES })],
    ['工厂直供单不计客服业绩', order({ settlementType: OrderSettlementType.FACTORY_DIRECT })],
  ])('%s：不读不写业绩流水', async (_label, value) => {
    await reverseCsSalesOnOrderCancelInTx(tx, value, event);

    expect(mocks.basis).not.toHaveBeenCalled();
    expect(mocks.reconcile).not.toHaveBeenCalled();
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it('流水未对平时原样抛出、不追加冲销', async () => {
    const failure = new Error('工单客服业绩流水未与当前金额对平');
    mocks.reconcile.mockRejectedValue(failure);

    await expect(reverseCsSalesOnOrderCancelInTx(tx, order(), event)).rejects.toBe(failure);
    expect(mocks.record).not.toHaveBeenCalled();
  });
});

describe('recordCsSalesBasisChangeInTx', () => {
  const change = {
    previousBasis: '1000.00',
    nextTotalAmount: new Decimal('1010.30'),
    eventName: 'shipment-added',
    orderRevision: 5,
    occurredAt,
    remark: '添加地址 2，从地址 1 分货',
  };

  it('按改写后的新口径与原口径差额追加 ORDER_CHANGED，先对平原口径', async () => {
    mocks.basis.mockResolvedValue('1002.30');

    await recordCsSalesBasisChangeInTx(tx, order(), change);

    expect(mocks.basis).toHaveBeenCalledWith(tx, 'order-1', new Decimal('1010.30'));
    expect(mocks.reconcile).toHaveBeenCalledWith(tx, 'order-1', '1000.00');
    expect(mocks.record).toHaveBeenCalledWith(tx, {
      eventKey: 'order:order-1:revision:5:shipment-added',
      csUserId: 'cs-1',
      orderId: 'order-1',
      orderRevision: 5,
      type: 'ORDER_CHANGED',
      amount: '2.30',
      occurredAt,
      remark: '添加地址 2，从地址 1 分货',
    });
    expect(mocks.reconcile.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.record.mock.invocationCallOrder[0]!,
    );
  });

  it('口径没有变化时不核对、不写流水', async () => {
    mocks.basis.mockResolvedValue('1000.00');

    await recordCsSalesBasisChangeInTx(tx, order(), change);

    expect(mocks.reconcile).not.toHaveBeenCalled();
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it.each([
    ['草稿', order({ status: OrderStatus.DRAFT })],
    ['不收费单', order({ billingMode: OrderBillingMode.NO_CHARGE })],
    ['外部销售单', order({ settlementType: OrderSettlementType.EXTERNAL_SALES })],
  ])('%s未计入业绩：不读不写', async (_label, value) => {
    await recordCsSalesBasisChangeInTx(tx, value, change);

    expect(mocks.basis).not.toHaveBeenCalled();
    expect(mocks.record).not.toHaveBeenCalled();
  });
});
