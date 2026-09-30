import { describe, expect, it } from 'vitest';
import { orderCancelImpact } from '../order-detail-timeline';

describe('orderCancelImpact', () => {
  it('lists already-loaded task and outsource counts', () => {
    expect(
      orderCancelImpact({
        pendingProductionCount: 2,
        inProgressProductionCount: 1,
        completedProductionCount: 3,
        liveOutsourceCount: 1,
      }),
    ).toEqual([
      { label: '取消未开工的生产工序', value: '2 个' },
      { label: '进行中工序需人工收尾', value: '1 个' },
      { label: '已报工工资保留', value: '3 个' },
      { label: '外协单需人工处理', value: '1 单已发出或进行中' },
    ]);
  });
});
