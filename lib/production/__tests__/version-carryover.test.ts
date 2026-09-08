import { describe, expect, it } from 'vitest';
import { OrderCraft } from '@/generated/prisma/enums';
import { deriveProductionOperationPlan } from '../operation-materializer';
import { operationCarryoverKey, planOperationCarryovers, type PreviousOperation } from '../version-carryover';

function specs(quantity = 100, second = false) {
  const plan = deriveProductionOperationPlan({
    orderId: 'order',
    items: (second ? ['a', 'b'] : ['a']).map((id, index) => ({
      id, sequence: index + 1, craft: OrderCraft.PARTIAL, quantity,
      frontFoilColors: ['gold', 'red'], backFoilColors: [], hasLocalFoil: false,
    })),
    packagingGroups: [{ id: 'bag', sequence: 1, actualBagCount: quantity / 10,
      lines: (second ? ['a', 'b'] : ['a']).map((orderItemId) => ({ orderItemId, unitsPerBag: 10 })),
    }],
  });
  if (!plan.ok) throw new Error(JSON.stringify(plan.issues));
  return plan.specs;
}
function previous(overrides: Partial<PreviousOperation> = {}): PreviousOperation {
  return { ...specs()[0]!, id: 'old', carriedCompletedQty: '10', carriedWorkOrderProgressQty: '5',
    reports: [{ reportedCompletedQty: '20' }], workOrderProgress: [{ workOrderProgressQuantity: '15' }], ...overrides };
}

describe('production version carryover', () => {
  it('累加上代承接量与本代新增量，合格件数不乘过版次数', () => {
    const next = specs(200);
    const value = planOperationCarryovers([previous()], next).get(operationCarryoverKey(next[0]!))!;
    expect(value.completed.toString()).toBe('30');
    expect(value.progress.toString()).toBe('20');
    expect(value.fromOperationId).toBe('old');
  });
  it('重复改版只承接前一代累计，不重复累计更早代次', () => {
    const next = specs(200);
    const value = planOperationCarryovers([previous({ carriedCompletedQty: '30', reports: [{ reportedCompletedQty: '5' }] })], next);
    expect([...value.values()][0]!.completed.toString()).toBe('35');
  });
  it('减少数量低于已完成量时拒绝；恰好相等允许', () => {
    expect(() => planOperationCarryovers([previous()], specs(20))).toThrow('不能少于');
    expect([...planOperationCarryovers([previous()], specs(30)).values()][0]!.completed.toString()).toBe('30');
  });
  it('零报工可重新划分来源，有报工则拒绝无法对应的新来源', () => {
    expect(() => planOperationCarryovers([previous()], specs(100, true))).toThrow('无法唯一对应');
    expect(planOperationCarryovers([previous({ carriedCompletedQty: '0', carriedWorkOrderProgressQty: '0', reports: [], workOrderProgress: [] })], specs(100, true)).size).toBe(0);
  });
  it('多款汇总报工无法推算各款已产，不允许减少其中一款', () => {
    const old = previous({ ...specs(100, true)[0]!, carriedCompletedQty: '1', reports: [] });
    expect(() => planOperationCarryovers([old], specs(90, true))).toThrow('不能确定各款已产数量');
  });
  it('不允许负数历史合格量', () => {
    expect(() => planOperationCarryovers([previous({ carriedCompletedQty: '-30' })], specs())).toThrow('历史生产进度异常');
  });
});
