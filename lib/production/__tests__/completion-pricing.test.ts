import { describe, expect, it, vi } from 'vitest';
import Decimal from 'decimal.js';
import type { Prisma, ProductionJob, ProductionOperation } from '@/generated/prisma/client';
import { completionPricingBasis } from '../completion-pricing';
import { priceCompletionQuantity } from '../completion-wage';
import { resolveReporterPieceworkRate } from '@/lib/salary/piecework-rate-selection';
import { ProductionInputError } from '../input-error';

vi.mock('@/lib/salary/piecework-rate-selection', () => ({ resolveReporterPieceworkRate: vi.fn() }));
const tx = {} as Prisma.TransactionClient;
const originalDay = new Date('2026-09-20T04:00:00Z');
const job = (operationType: 'PARTIAL' | 'FULL') => ({ workerId: 'original-worker', manualPricing: false,
  snapshot: { items: [{ id: 'style', quantity: 1000, frontFoilColors: ['亚金'], backFoilColors: ['红金'] }] },
  operation: { operationType, unit: operationType === 'PARTIAL' ? 'PER_PASS' : 'PER_PIECE', plannedQty: new Decimal(2000), payrollPassCount: null },
}) as unknown as ProductionJob & { operation: ProductionOperation };
function oldRate() {
  const rule = { operationType: 'PARTIAL' as const, unit: 'PER_PASS' as const, amount: new Decimal('0.007'), smallOrderAmount: new Decimal(12), setupAmount: new Decimal(5) };
  const book = { id: 'old-book', version: 4, ruleSetSha256: 'original-hash', workerId: null, useUnifiedRates: false, rules: [rule] };
  vi.mocked(resolveReporterPieceworkRate).mockResolvedValue({ book, rule, source: 'UNIFIED', key: 'old-book:policy',
    policy: { ...book, id: 'policy', workerId: 'original-worker', useUnifiedRates: true, rules: [] },
  });
}
describe('original production inputs and wage rule freezing', () => {
  it.each([{ priceBookId: null }, { rate: 'not-money' }, { smallOrderAmount: '-1' }, { setupAmount: '1.23456' }])('历史计薪资料异常 %j 提示核对历史且不重新读取工价', async invalid => {
    oldRate();
    const task = job('PARTIAL');
    const basis = await completionPricingBasis(tx, task, originalDay);
    task.snapshot = { registrationPricing: { ...basis, ...invalid } } as Prisma.JsonObject;
    vi.mocked(resolveReporterPieceworkRate).mockClear();
    await expect(completionPricingBasis(tx, task, originalDay)).rejects.toBeInstanceOf(ProductionInputError);
    await expect(completionPricingBasis(tx, task, originalDay)).rejects.toThrow('原计薪资料不完整，请先核对历史记录');
    expect(resolveReporterPieceworkRate).not.toHaveBeenCalled();
  });
  it.each(['PARTIAL', 'FULL'] as const)('uses original %s passes/colors and original worker/date at 990 / 1000 / 1001 / 1300', async type => {
    oldRate(); const task = job(type);
    const basis = await completionPricingBasis(tx, task, originalDay);
    expect(resolveReporterPieceworkRate).toHaveBeenLastCalledWith(tx, 'original-worker', type, task.operation.unit, originalDay);
    expect(basis).toMatchObject({ priceBookId: 'old-book', multiplier: 2 });
    expect([990, 1000, 1001, 1300].map(qty => priceCompletionQuantity(basis, new Decimal(qty)))).toEqual(['24.00', '24.00', '24.01', '28.20']);
    // A later rule publication or edited operation must not reprice an existing request.
    task.snapshot = { registrationPricing: basis } as Prisma.JsonObject;
    task.operation.payrollPassCount = 5;
    vi.mocked(resolveReporterPieceworkRate).mockRejectedValue(new Error('new rate must not be read'));
    expect(await completionPricingBasis(tx, task, new Date('2026-09-28T04:00:00Z'))).toEqual(basis);
  });
  it('honors an explicit payroll pass count and refuses ambiguous mixed full-foil colors', async () => {
    oldRate(); const partial = job('PARTIAL'); partial.operation.payrollPassCount = 3;
    expect(await completionPricingBasis(tx, partial, originalDay)).toMatchObject({ multiplier: 3 });
    const mixed = job('FULL');
    mixed.snapshot = { items: [
      { id: 'a', quantity: 500, frontFoilColors: ['亚金'], backFoilColors: [] },
      { id: 'b', quantity: 500, frontFoilColors: ['亚金'], backFoilColors: ['红金'] },
    ] };
    expect(await completionPricingBasis(tx, mixed, originalDay)).toEqual({ mode: 'MANUAL_MIXED_COLORS' });
  });
});
