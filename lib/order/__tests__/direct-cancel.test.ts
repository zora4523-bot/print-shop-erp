import { describe, expect, it } from 'vitest';
import { OrderStatus, Role, ShipmentStatus } from '../../../generated/prisma/enums';
import { canShowAdminDirectCancel, isDirectCancelStatus } from '../direct-cancel';

describe('isDirectCancelStatus', () => {
  it.each([
    OrderStatus.DRAFT,
    OrderStatus.SUBMITTED,
    OrderStatus.PENDING_FACTORY,
    OrderStatus.REJECTED,
  ])('%s 尚未进入已确认生产合同，可直接撤回', (status) => {
    expect(isDirectCancelStatus(status)).toBe(true);
  });

  it.each([
    OrderStatus.CONFIRMED,
    OrderStatus.ON_HOLD,
    OrderStatus.RELEASED,
    OrderStatus.FOILING,
    OrderStatus.PACKING,
    OrderStatus.SHIPPED,
    OrderStatus.SETTLED,
    OrderStatus.CANCELLED,
  ])('%s 必须走取消申请或已是终态，不能直接取消', (status) => {
    expect(isDirectCancelStatus(status)).toBe(false);
  });
});

describe('canShowAdminDirectCancel（工单详情页入口）', () => {
  it('管理员对停在 SUBMITTED 的内部/直营单可见取消入口', () => {
    expect(canShowAdminDirectCancel(Role.ADMIN, OrderStatus.SUBMITTED)).toBe(true);
  });

  it('任一地址已发货时不显示直接取消入口（正常收费）', () => {
    expect(canShowAdminDirectCancel(Role.ADMIN, OrderStatus.SUBMITTED, [{ status: ShipmentStatus.SHIPPED }])).toBe(false);
    expect(canShowAdminDirectCancel(Role.ADMIN, OrderStatus.SUBMITTED, [{ status: ShipmentStatus.PLANNED }])).toBe(true);
  });

  it('管理员对已确认工单不显示直接取消入口', () => {
    expect(canShowAdminDirectCancel(Role.ADMIN, OrderStatus.CONFIRMED)).toBe(false);
  });

  it.each([Role.SALES, Role.WORKER])(
    '%s 在管理后台详情页不显示直接取消入口',
    (role) => {
      expect(canShowAdminDirectCancel(role, OrderStatus.SUBMITTED)).toBe(false);
    },
  );
});
