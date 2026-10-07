import { describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@/generated/prisma/client';
import { lateDailyMinimumEvidence } from '../late-daily-minimum';

const settlement = { id: 's', snapshot: { dailyMinimum: { applies: true } }, reportAmount: '0', payableAmount: '100' };
function setup(evidence: Prisma.JsonValue[] = []) {
  const findMany = vi.fn().mockResolvedValue(evidence.map(evidence => ({ evidence })));
  const tx = { productionFactReview: { findMany } } as unknown as Prisma.TransactionClient;
  return { tx, findMany };
}
describe('已结算日期补登记', () => {
  it('没有日薪的旧结算保持原补发额', async () => {
    const { tx, findMany } = setup();
    expect(await lateDailyMinimumEvidence(tx, { workerId: 'w', workDate: new Date(), jobId: 'j', amount: '60', settlement: { ...settlement, snapshot: {} } })).toEqual({ expectedAmount: '60', paidAmount: '0' });
    expect(findMany).not.toHaveBeenCalled();
  });
  it('已关闭的首笔补登记仍消耗保底余额', async () => {
    const { tx } = setup([{ originalEvidence: { lateCommissionAmount: '60' } }]);
    expect(await lateDailyMinimumEvidence(tx, { workerId: 'w', workDate: new Date(), jobId: 'j', amount: '60', settlement })).toMatchObject({ expectedAmount: '20.00', lateCommissionAmount: '60', earlierLateCommission: '60.00' });
  });
  it.each([null, {}, [], { lateCommissionAmount: null }, { lateCommissionAmount: '-1' }])('前笔金额未知时不误算为零 %j', async evidence => {
    const { tx } = setup([evidence]);
    expect(await lateDailyMinimumEvidence(tx, { workerId: 'w', workDate: new Date(), jobId: 'j', amount: '60', settlement })).toMatchObject({ expectedAmount: null, manualReviewRequired: true });
  });
  it('本笔金额未知保留人工核定', async () => {
    const { tx } = setup();
    expect(await lateDailyMinimumEvidence(tx, { workerId: 'w', workDate: new Date(), jobId: 'j', amount: null, settlement })).toMatchObject({ expectedAmount: null, manualReviewRequired: true });
  });
});
