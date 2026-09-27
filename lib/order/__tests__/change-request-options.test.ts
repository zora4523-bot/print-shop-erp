import { describe, expect, it } from 'vitest';
import { OrderStatus, ShipmentStatus } from '../../../generated/prisma/enums';
import { resolveOrderChangeRequestOptions } from '../change-request-options';
import { hasShippedShipment, shippedShipmentViolation } from '../change-request-shipment-guard';

const planned = { status: ShipmentStatus.PLANNED };
const shipped = { status: ShipmentStatus.SHIPPED };

describe('hasShippedShipment', () => {
  it('任一地址 SHIPPED 即视为已发货', () => {
    expect(hasShippedShipment([])).toBe(false);
    expect(hasShippedShipment([planned])).toBe(false);
    expect(hasShippedShipment([planned, shipped])).toBe(true);
  });
});

describe('shippedShipmentViolation', () => {
  it('未发货时不拦截任何申请', () => {
    expect(shippedShipmentViolation({ phase: 'REVIEW', isCancellation: true, itemChangeCount: 0, shipments: [planned] })).toBeNull();
  });

  it('已发货：取消与改款式数量给出拒绝原因，只改交期放行', () => {
    const shipments = [shipped, planned];
    expect(shippedShipmentViolation({ phase: 'REVIEW', isCancellation: true, itemChangeCount: 0, shipments }))
      .toBe('工单已有地址发货，不能批准取消，请驳回该申请');
    expect(shippedShipmentViolation({ phase: 'REQUEST', isCancellation: false, itemChangeCount: 2, shipments }))
      .toBe('工单已有地址发货，只能申请修改交期');
    expect(shippedShipmentViolation({ phase: 'REVIEW', isCancellation: false, itemChangeCount: 0, shipments })).toBeNull();
  });
});

describe('resolveOrderChangeRequestOptions', () => {
  it('未发货的生产中工单：可改款式数量，也可申请取消', () => {
    expect(resolveOrderChangeRequestOptions({ status: OrderStatus.PACKING, hasPendingChange: false, shipments: [planned] }))
      .toEqual({ canRequestModify: true, allowItemChanges: true, canRequestCancellation: true, shipped: false });
  });

  it('已有地址发货：没有取消选项，修改申请只剩交期', () => {
    expect(resolveOrderChangeRequestOptions({ status: OrderStatus.PACKING, hasPendingChange: false, shipments: [shipped, planned] }))
      .toEqual({ canRequestModify: true, allowItemChanges: false, canRequestCancellation: false, shipped: true });
  });

  it('暂停中的已发货工单同样不能申请取消', () => {
    expect(resolveOrderChangeRequestOptions({ status: OrderStatus.ON_HOLD, hasPendingChange: false, shipments: [shipped] }).canRequestCancellation)
      .toBe(false);
  });

  it('存在待审申请时两个入口都不显示', () => {
    expect(resolveOrderChangeRequestOptions({ status: OrderStatus.CONFIRMED, hasPendingChange: true, shipments: [] }))
      .toEqual({ canRequestModify: false, allowItemChanges: false, canRequestCancellation: false, shipped: false });
  });

  it('草稿可改款式但不走取消申请（草稿直接取消）', () => {
    expect(resolveOrderChangeRequestOptions({ status: OrderStatus.DRAFT, hasPendingChange: false, shipments: [] }))
      .toEqual({ canRequestModify: true, allowItemChanges: true, canRequestCancellation: false, shipped: false });
  });

  it('已发货终态不再提供修改申请', () => {
    expect(resolveOrderChangeRequestOptions({ status: OrderStatus.SHIPPED, hasPendingChange: false, shipments: [shipped] }).canRequestModify)
      .toBe(false);
  });
});
