import { describe, expect, it } from 'vitest';
import { OrderPricingStatus, OrderStatus } from '../../../generated/prisma/enums';
import {
  formatSalesOrderUpdatedAt,
  salesOrderAmountPresentation,
  salesOrderPrimaryAction,
  salesOrderStatusPresentation,
} from '../sales-list-presentation';

describe('sales order list presentation', () => {
  it('projects internal production states into sales-facing language', () => {
    expect(salesOrderStatusPresentation(OrderStatus.DRAFT).label).toBe('草稿');
    expect(
      salesOrderStatusPresentation(OrderStatus.PENDING_FACTORY).label,
    ).toBe('待工厂确认');
    expect(salesOrderStatusPresentation(OrderStatus.SUBMITTED).label).toBe(
      '待工厂确认',
    );
    for (const status of [
      OrderStatus.SCHEDULING,
      OrderStatus.IN_PRODUCTION,
      OrderStatus.COMPLETED,
    ]) {
      expect(salesOrderStatusPresentation(status).label).toBe('生产中');
    }
    expect(salesOrderStatusPresentation(OrderStatus.SHIPPED).label).toBe(
      '已发货',
    );
    expect(salesOrderStatusPresentation(OrderStatus.FINISHED).label).toBe(
      '已完成',
    );
  });

  it('keeps draft, estimated, manual and confirmed amounts distinct', () => {
    expect(
      salesOrderAmountPresentation({
        status: OrderStatus.DRAFT,
        pricingStatus: OrderPricingStatus.PENDING_ADMIN_CONFIRMATION,
        totalAmount: '123.00',
        feeLines: [],
      }),
    ).toEqual({ label: '—', estimated: false, pending: false });
    expect(
      salesOrderAmountPresentation({
        status: OrderStatus.PENDING_FACTORY,
        pricingStatus: OrderPricingStatus.PENDING_ADMIN_CONFIRMATION,
        totalAmount: '404.30',
        feeLines: [],
      }),
    ).toEqual({
      label: '待管理员确认价格',
      estimated: false,
      pending: true,
    });
    expect(
      salesOrderAmountPresentation({
        status: OrderStatus.SUBMITTED,
        pricingStatus: OrderPricingStatus.PENDING_ADMIN_CONFIRMATION,
        totalAmount: '0.00',
        feeLines: [],
      }),
    ).toEqual({
      label: '待管理员确认价格',
      estimated: false,
      pending: true,
    });
    expect(
      salesOrderAmountPresentation({
        status: OrderStatus.SCHEDULING,
        pricingStatus: OrderPricingStatus.AUTO_CONFIRMED,
        totalAmount: '1924.00',
        feeLines: [],
      }),
    ).toEqual({ label: '¥1,924.00', estimated: false, pending: false });
    expect(
      salesOrderAmountPresentation({
        status: OrderStatus.SCHEDULING,
        pricingStatus: OrderPricingStatus.AUTO_CONFIRMED,
        totalAmount: '1924.00',
        feeLines: [
          {
            id: 'shipping',
            label: '快递费',
            amount: '41.30',
            estimated: true,
          },
        ],
      }),
    ).toEqual({ label: '¥1,924.00', estimated: true, pending: false });
  });

  it('uses only real actions exposed by the current application', () => {
    expect(
      salesOrderPrimaryAction({ status: OrderStatus.DRAFT, needsAction: false }),
    ).toBe('查看草稿');
    expect(
      salesOrderPrimaryAction({
        status: OrderStatus.PENDING_FACTORY,
        needsAction: true,
      }),
    ).toBe('查看原因');
    expect(
      salesOrderPrimaryAction({
        status: OrderStatus.IN_PRODUCTION,
        needsAction: false,
      }),
    ).toBe('查看详情');
  });

  it('formats relative updates against the server-provided reference time', () => {
    const now = '2026-08-27T08:00:00.000Z';
    expect(formatSalesOrderUpdatedAt('2026-08-27T07:59:45.000Z', now)).toBe(
      '刚刚更新',
    );
    expect(formatSalesOrderUpdatedAt('2026-08-27T07:42:00.000Z', now)).toBe(
      '18 分钟前更新',
    );
    expect(formatSalesOrderUpdatedAt('2026-08-27T03:00:00.000Z', now)).toBe(
      '5 小时前更新',
    );
  });
});
