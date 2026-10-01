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
