import { describe, expect, it } from 'vitest';
import { PieceworkOperationType } from '../../../generated/prisma/enums';
import { productionOperationPassCount } from '../operation-quantity';

describe('生产工序展示数量单位', () => {
  it('局部烫金用正反面颜色次数换算计划件数，不把计价次数当件数', () => {
    expect(productionOperationPassCount(PieceworkOperationType.PARTIAL, [
      { orderItem: { frontFoilColors: ['亚金', '红金'], backFoilColors: ['亚金'] } },
      { orderItem: { frontFoilColors: ['金'], backFoilColors: ['红', '绿'] } },
    ])).toBe(3);
  });

  it.each([PieceworkOperationType.PACKING, PieceworkOperationType.FULL])('%s 以袋/个计量，不使用烫印次数', (operationType) => {
    expect(productionOperationPassCount(operationType, [
      { orderItem: { frontFoilColors: ['金', '红'], backFoilColors: ['银'] } },
    ])).toBe(1);
  });

  it('来源缺失或混合旧数据沿用门户原先的保守展示，不进行不可靠换算', () => {
    expect(productionOperationPassCount(PieceworkOperationType.PARTIAL, [])).toBe(1);
    expect(productionOperationPassCount(PieceworkOperationType.PARTIAL, [
      { orderItem: { frontFoilColors: ['金'], backFoilColors: [] } },
      { orderItem: { frontFoilColors: ['金', '红'], backFoilColors: [] } },
    ])).toBe(1);
  });
});
