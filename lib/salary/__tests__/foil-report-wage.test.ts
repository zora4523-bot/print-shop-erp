import { expect, it, vi } from 'vitest';
import type { Prisma } from '../../../generated/prisma/client';
import { priceFoilReport } from '../foil-report-wage';
const operation = { id: 'op', operationType: 'PARTIAL', payrollPassCount: 2, carriedCompletedQty: '0', sources: [{ orderItem: { quantity: 2000, frontFoilColors: ['金'], backFoilColors: ['金'] } }] };
const base = { operation, reporterId: 'w', priceBookId: 'b', completedQty: '2000', baseAmount: '28.00', passCount: 2, rule: { amount: '0.007', smallOrderAmount: '12', setupAmount: '5' } };
async function price(input = base, previous: unknown[] = []) {
  return priceFoilReport({ productionReport: { findMany: vi.fn().mockResolvedValue(previous) } } as unknown as Prisma.TransactionClient, input);
}
const prior = { reporterId: 'w', priceBookId: 'b', reportedCompletedQty: '1000', snapshot: { payroll: { passCount: 2 } } };
it('局部 2000 双过版总计 38', async () => { expect(await price()).toMatchObject({ amount: '38.00', wageSupplement: '10.00', reviewRequired: false }); });
it('同一人分两次报工只收一次装版费', async () => {
  expect(await price({ ...base, completedQty: '1000', baseAmount: '14' })).toMatchObject({ amount: '24.00' });
  expect(await price({ ...base, completedQty: '1000', baseAmount: '14' }, [prior])).toMatchObject({ amount: '14.00', reviewRequired: false });
});
it('第二位师傅触发人工核定，固定费用不重复', async () => {
  expect(await price({ ...base, reporterId: 'w2', completedQty: '1000', baseAmount: '14' }, [prior])).toMatchObject({ amount: '14.00', reviewRequired: true });
});
it('小单含装版包干按次数，分次后续为零', async () => {
  const input = { ...base, completedQty: '400', operation: { ...operation, sources: [{ orderItem: { ...operation.sources[0]!.orderItem, quantity: 800 } }] } };
  expect(await price(input)).toMatchObject({ amount: '24.00' });
  expect(await price(input, [{ ...prior, reportedCompletedQty: '400' }])).toMatchObject({ amount: '0.00' });
});
it('专版颜色去重，不按面重复计算', async () => {
  const input = { ...base, operation: { ...operation, operationType: 'FULL', sources: [{ orderItem: { quantity: 2000, frontFoilColors: ['金', '银'], backFoilColors: ['金'] } }] }, rule: { amount: '0.01', smallOrderAmount: '20', setupAmount: '10' } };
  expect(await price(input)).toMatchObject({ amount: '60.00' });
});
it('零完成数量不提前领取固定费', async () => { expect(await price({ ...base, completedQty: '0', baseAmount: '0' })).toMatchObject({ amount: '0.00' }); });
it('累计金额舍入防止拆单产生分差', async () => {
  expect(await price({ ...base, passCount: 1, completedQty: '1', baseAmount: '.01' }, [{ ...prior, reportedCompletedQty: '1', snapshot: { payroll: { passCount: 1 } } }])).toMatchObject({ amount: '0.00' });
});
it.each([{ priceBookId: 'old' }, { snapshot: { payroll: { passCount: 3 } } }])('计薪条件变化转人工 %j', async (change) => { expect(await price(base, [{ ...prior, ...change }])).toMatchObject({ reviewRequired: true }); });
it('继承进度不再次领取装版费，转人工', async () => { expect(await price({ ...base, operation: { ...operation, carriedCompletedQty: '10' } })).toMatchObject({ amount: '28.00', reviewRequired: true }); });
it.each([[[]], [['a', 'b', 'c', 'd']]])('缺失或非法专版颜色转人工 %j', async (colors) => { expect(await price({ ...base, operation: { ...operation, operationType: 'FULL', sources: [{ orderItem: { quantity: 2000, frontFoilColors: colors, backFoilColors: [] } }] } })).toMatchObject({ amount: base.baseAmount, reviewRequired: true }); });
it('合并不同颜色数的款式转人工', async () => { expect(await price({ ...base, operation: { ...operation, operationType: 'FULL', sources: [operation.sources[0]!, { orderItem: { quantity: 1000, frontFoilColors: ['a', 'b'], backFoilColors: [] } }] } })).toMatchObject({ reviewRequired: true, detail: { mode: 'MANUAL' } }); });
it('旧工价和包装沿用旧算法', async () => { expect(await price({ ...base, rule: { amount: '.007' } } as typeof base)).toBeNull(); expect(await price({ ...base, operation: { ...operation, operationType: 'PACKING' } })).toBeNull(); });
it('四位小数装版费按分入账', async () => { expect(await price({ ...base, rule: { ...base.rule, setupAmount: '5.0026' } })).toMatchObject({ amount: '38.01', wageSupplement: '10.01' }); });
