// Shared fixtures for SalesOrdersList SSR and browser tests.
import {
  OrderPricingStatus,
  OrderStatus,
} from '@/generated/prisma/enums';
import type { OrderListQuery } from '@/lib/order/list-query';
import type { SalesOrderListRow } from '@/lib/order/sales-list-query';

export function row(): SalesOrderListRow {
  return {
    id: 'order-1',
    orderNo: 'GD-260827-001',
    customName: '端午定制',
    status: OrderStatus.SUBMITTED,
    isUrgent: false,
    revision: 2,
    pricingStatus: OrderPricingStatus.PENDING_ADMIN_CONFIRMATION,
    totalAmount: '404.30',
    promisedDate: '2026-08-30',
    dueAlert: { kind: 'due-soon', days: 3 },
    createdAt: '2026-08-26T16:00:00.000Z',
    shippedAt: null,
    updatedAt: '2026-08-27T07:00:00.000Z',
    receiver: {
      name: 'Lam',
      phone: '021-53395199',
      address: '上海市黄浦区测试路 88 号',
    },
    itemCount: 2,
    totalQuantity: 2000,
    craftSummary: '局部烫金 · 触感纸',
    thumbnail: null,
    items: [
      {
        id: 'item-1',
        sequence: 1,
        name: '端午定制 图1',
        quantity: 2000,
        specification: '大号封 90×165',
        paper: '触感纸 200g',
        crafts: ['局部烫金'],
        thumbnail: null,
      },
    ],
    feeLines: [
      {
        id: 'processing',
        label: '款式加工费',
        amount: '404.30',
        estimated: true,
      },
      {
        id: 'plate',
        label: '制烫金版费',
        amount: null,
        estimated: false,
      },
    ],
    pricingAttentionReason: '价格待工厂确认',
    pendingChangeRequest: {
      id: 'change-1',
      type: 'MODIFY',
      reason: '客户改数量',
      createdAt: '2026-08-27T07:30:00.000Z',
    },
    rejectedChangeRequest: null,
    shipments: [{ carrier: '中通', trackingNo: '75312884629891' }],
    shipment: {
      carrier: '中通',
      trackingNo: '75312884629891',
      additionalCount: 0,
    },
    needsAction: true,
  };
}

export function query(): OrderListQuery {
  return {
    filters: {} as OrderListQuery['filters'],
    page: 1,
    pageSize: 20,
    sort: 'createdAt',
    dir: 'desc',
  };
}
