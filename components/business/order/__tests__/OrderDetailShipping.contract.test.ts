import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { OrderStatus } from '@/generated/prisma/enums';
import { orderShippingAvailability } from '../order-shipping-availability';

const source = readFileSync('app/(admin)/orders/[id]/page.tsx', 'utf8');

describe('order detail shipping availability contract', () => {
  it('does not expose an unusable shipping form when no shipment address exists', () => {
    expect(
      orderShippingAvailability({
        isAdministrator: true,
        status: OrderStatus.COMPLETED,
        incompleteProductionCount: 0,
        hasLiveOutsource: false,
        isPricingPending: false,
        hasShipment: false,
        hasPendingChange: false,
      }),
    ).toEqual({
      canShip: false,
      disabledReason: '缺少发货地址，无法发货',
    });
    expect(source).toContain('hasShipment: order.shipments.length > 0');
    expect(source).toContain('hasPendingChange: Boolean(pendingChangeRequest)');
  });

  it('blocks shipping while a change request is pending', () => {
    expect(
      orderShippingAvailability({
        isAdministrator: true,
        status: OrderStatus.COMPLETED,
        incompleteProductionCount: 0,
        hasLiveOutsource: false,
        isPricingPending: false,
        hasShipment: true,
        hasPendingChange: true,
      }),
    ).toEqual({
      canShip: false,
      disabledReason: '存在待审的工单变更',
    });
  });

  it('passes every version token to per-address registration', () => {
    expect(source).toContain('revision={order.revision}');
    expect(source).toContain('editVersion={order.editVersion}');
    expect(source).toContain('workOrderVersion={order.workOrderVersion}');
    expect(source).toContain('priceRevision={priceRevision ?? 0}');
    expect(source).toContain('version={shipment.registrationVersion}');
    expect(source).toContain('shipmentId={shipment.id}');
    expect(source).not.toContain('<ShipOrderForm');
  });

  it('routes shipped orders to settlement instead of the retired finish writer', () => {
    expect(source).not.toContain('FinishOrderButton');
    expect(source).not.toContain('href="#finish-order"');
    expect(source).not.toContain('确认完工（价格待确认）');
    expect(source).toContain(
      'href="#detail-delivery-records"',
    );
    expect(source).toContain('结算（价格待确认）');
    expect(source).toContain('暂不能结算');
    expect(source).toContain('再结算。');
  });
});
