import { expect, it } from 'vitest';
import { createBillSettlementDetail, readBillSettlementDetail } from '../settlement-detail';

it('retains only public settlement facts and exact decimal amounts', () => {
  const detail = createBillSettlementDetail({ customName: '原名称', processingAmount: '0.10', customerCharges: [{ description: '包装费', amount: '0.20' }] });
  expect(detail).toEqual({ schemaVersion: 1, orderName: '原名称', processingAmount: '0.10', charges: [{ description: '包装费', amount: '0.20' }] });
  expect(readBillSettlementDetail(detail, '0.30')).toEqual(detail);
  expect(readBillSettlementDetail(detail, '0.31')).toBeNull();
});
it('does not invent a breakdown for old, unknown-version or invalid data', () => {
  for (const value of [null, undefined, {}, { schemaVersion: 2 }, { schemaVersion: 1, orderName: null, processingAmount: 'NaN', charges: [] }]) {
    expect(readBillSettlementDetail(value, '10.00')).toBeNull();
  }
});
it('preserves unnamed orders and negative customer adjustments', () => {
  const detail = createBillSettlementDetail({ customName: null, processingAmount: '100', customerCharges: [{ description: '调整金额', amount: '-10.50' }] });
  expect(readBillSettlementDetail(detail, '89.50')?.orderName).toBeNull();
});

it('freezes cancellation settlement independently of unpriced or waived original charges', () => {
  const detail = createBillSettlementDetail({ status: 'CANCELLED', settledFee: '12.34', customName: '取消前名称', processingAmount: null,
    customerCharges: [{ description: '待报价', amount: null }, { description: '免收', amount: '99', status: 'WAIVED' }] });
  expect(detail).toEqual({ schemaVersion: 2, kind: 'CANCELLATION', orderName: '取消前名称', settlementAmount: '12.34' });
  expect(readBillSettlementDetail(detail, '12.34')).toMatchObject({ orderName: '取消前名称', processingAmount: null, charges: [{ description: '取消结算金额', amount: '12.34' }] });
  expect(readBillSettlementDetail(detail, '12.35')).toBeNull();
});
it('excludes waived charges while refusing missing or invalid normal amounts', () => {
  const base = { customName: '名称', processingAmount: '20', customerCharges: [{ description: '免收', amount: null, status: 'WAIVED' }] };
  expect(readBillSettlementDetail(createBillSettlementDetail(base), '20.00')).toMatchObject({ processingAmount: '20.00', charges: [] });
  expect(createBillSettlementDetail({ ...base, processingAmount: null })).toBeNull();
  expect(createBillSettlementDetail({ ...base, customerCharges: [{ description: '未定价', amount: null, status: 'PENDING_AMOUNT' }] })).toBeNull();
  for (const processingAmount of ['NaN', 'Infinity', 'not-a-number']) expect(createBillSettlementDetail({ ...base, processingAmount })).toBeNull();
});
