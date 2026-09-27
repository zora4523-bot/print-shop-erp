import { describe, expect, it } from 'vitest';
import { OrderStatus } from '../../../generated/prisma/enums';
import { canCreateReworkFromStatus } from '../rework-eligibility';

describe('canCreateReworkFromStatus', () => {
  const allowed: readonly OrderStatus[] = [OrderStatus.SHIPPED, OrderStatus.SETTLED, OrderStatus.FINISHED];

  it.each(allowed)('发货后的 %s 工单可以发起售后重做', (status) => {
    expect(canCreateReworkFromStatus(status)).toBe(true);
  });

  it.each(Object.values(OrderStatus).filter((status) => !allowed.includes(status)))(
    '未发货或已取消的 %s 工单不能发起重做',
    (status) => {
      expect(canCreateReworkFromStatus(status)).toBe(false);
    },
  );
});
