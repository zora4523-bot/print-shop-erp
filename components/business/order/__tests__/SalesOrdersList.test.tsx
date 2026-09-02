import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  OrderPricingStatus,
  OrderStatus,
} from '@/generated/prisma/enums';
import type { OrderListQuery } from '@/lib/order/list-query';
import type { SalesOrderListRow } from '@/lib/order/sales-list-query';
import { SalesOrdersList } from '../SalesOrdersList';

describe('SalesOrdersList', () => {
  it('renders the sales card fields without exposing workshop details', () => {
    const html = renderToStaticMarkup(
      <SalesOrdersList
        orders={[row()]}
        query={query()}
        nowIso="2026-08-27T08:00:00.000Z"
        footer={<div>分页</div>}
      />,
    );

    expect(html).toContain('data-slot="sales-orders-list"');
    expect(html).toContain(
      'data-slot="sales-orders-list" class="min-w-0"',
    );
    expect(html).toContain('aria-label="销售工单列表" class="grid gap-2"');
    expect(html).toContain('data-sales-order-card=""');
    expect(html).toContain(
      'data-slot="sales-orders-pagination" class="mt-4"',
    );
    expect(html).toContain('端午定制');
    expect(html).toContain('张三商贸');
    expect(html).toContain('GD-260827-001');
    expect(html).toContain('>2</b> 款');
    expect(html).toContain('2,000');
    expect(html).toContain('局部烫金 · 触感纸');
    expect(html).toContain('待工厂确认');
    expect(html).toContain('待管理员确认价格');
    expect(html).toContain('修改申请中');
    expect(html).toContain('中通');
    expect(html).toContain('75312884629891');
    expect(html).not.toContain('师傅');
    expect(html).not.toContain('计件成本');
    expect(html).not.toContain('生产任务');
  });

  it('待定费用不伪装成 0 元，已知合计明确排除待定项', () => {
    const order = {
      ...row(),
      pricingStatus: OrderPricingStatus.AUTO_CONFIRMED,
      pricingAttentionReason: null,
      pendingChangeRequest: null,
      needsAction: false,
    };
    const html = renderToStaticMarkup(
      <SalesOrdersList
        orders={[order]}
        query={query()}
        nowIso="2026-08-27T08:00:00.000Z"
      />,
    );

    expect(html).toContain('不含待定');
    expect(html).not.toContain('¥待定');
    expect(html).not.toContain('NaN');
  });
});

function row(): SalesOrderListRow {
  return {
    id: 'order-1',
    orderNo: 'GD-260827-001',
    customName: '端午定制',
    customerRef: '张三商贸',
    status: OrderStatus.SUBMITTED,
    isUrgent: false,
    revision: 2,
    pricingStatus: OrderPricingStatus.PENDING_ADMIN_CONFIRMATION,
    totalAmount: '404.30',
    promisedDate: '2026-08-30',
    dueAlert: { kind: 'due-soon', days: 3 },
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
    pricingAttentionReason: '价格待管理员确认',
    pendingChangeRequest: {
      id: 'change-1',
      reason: '客户改数量',
      createdAt: '2026-08-27T07:30:00.000Z',
    },
    rejectedChangeRequest: null,
    shipment: {
      carrier: '中通',
      trackingNo: '75312884629891',
      additionalCount: 0,
    },
    needsAction: true,
  };
}

function query(): OrderListQuery {
  return {
    filters: {} as OrderListQuery['filters'],
    page: 1,
    pageSize: 20,
    sort: 'createdAt',
    dir: 'desc',
  };
}
