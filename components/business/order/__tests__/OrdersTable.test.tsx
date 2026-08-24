import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { OrderKind, OrderStatus } from '@/generated/prisma/enums';
import type { OrderListQuery, OrderListRow } from '@/lib/order/list-query';
import { OrdersTable } from '../OrdersTable';

const query: OrderListQuery = {
  filters: {
    statuses: [],
    kinds: [],
    shipmentStatuses: [],
    craftIds: [],
    foilColors: [],
    taskStatuses: [],
    machineTypes: [],
    outsourceStatuses: [],
  },
  page: 1,
  pageSize: 20,
  sort: 'createdAt',
  dir: 'desc',
};

const order: OrderListRow = {
  id: 'order-1',
  orderNo: 'GD-260807-001',
  customName: '中秋礼盒',
  status: OrderStatus.IN_PRODUCTION,
  kind: OrderKind.NORMAL,
  sourceOrderNo: null,
  isUrgent: false,
  isSfCollect: false,
  shipmentCount: 1,
  customerRef: '客户甲',
  receiverName: '张三',
  receiverPhone: '13800000000',
  receiverAddress: '佛山市',
  trackingNo: null,
  expressCode: null,
  totalAmount: '98765.43',
  submitterId: 'sales-1',
  submitterName: '销售甲',
  workerNames: ['张师傅'],
  promisedDate: new Date('2026-08-12T00:00:00.000Z'),
  createdAt: new Date('2026-08-07T08:00:00.000Z'),
  updatedAt: new Date('2026-08-07T08:00:00.000Z'),
  pieceworkCost: null,
};

describe('OrdersTable commercial visibility', () => {
  it('does not render the amount column or value for WORKER', () => {
    const html = renderToStaticMarkup(
      <OrdersTable
        orders={[{ ...order, isUrgent: true }]}
        showCommercialAmounts={false}
        query={query}
        queryParams={{}}
      />,
    );

    expect(html).not.toContain('98765.43');
    expect(html).not.toContain('field=totalAmount');
    expect(html).not.toMatch(/>金额<\//);
    expect(html).toContain('GD-260807-001');
    expect(html).toContain('张师傅');
  });

  it('keeps the amount column for non-WORKER roles', () => {
    const html = renderToStaticMarkup(
      <OrdersTable
        orders={[order]}
        showCommercialAmounts
        query={query}
        queryParams={{}}
      />,
    );

    expect(html).toContain('98765.43');
    expect(html).toMatch(/>金额<\//);
    expect(html).toContain('承诺交期');
    expect(html).toContain('2026/08/12');
  });

  it('marks the URL-selected row in both responsive representations', () => {
    const html = renderToStaticMarkup(
      <OrdersTable
        orders={[{ ...order, isUrgent: true }]}
        showCommercialAmounts
        query={{ ...query, selectedOrderId: order.id, scrollY: 420 }}
        queryParams={{ selected: order.id, scroll: 420 }}
      />,
    );

    expect(html.match(/data-order-id="order-1"/g)).toHaveLength(2);
    expect(html.match(/data-state="selected"/g)).toHaveLength(2);
    expect(html.match(/href="\/orders\/order-1"/g)).toHaveLength(2);
    expect(html).toContain('data-tone="warning"');
    expect(html).not.toContain('bg-destructive text-background');
  });

  it('renders synchronized desktop/mobile selection controls and row menus', () => {
    const html = renderToStaticMarkup(
      <OrdersTable
        orders={[{ ...order, status: OrderStatus.SUBMITTED }]}
        showCommercialAmounts
        canSchedule
        query={query}
        queryParams={{}}
      />,
    );

    expect(html.match(/aria-label="选择本页 1 项工单"/g)).toHaveLength(2);
    expect(html.match(/aria-label="选择工单 GD-260807-001"/g)).toHaveLength(2);
    expect(html.match(/aria-label="更多操作：GD-260807-001"/g)).toHaveLength(2);
    expect(html).toContain('role="status"');
    expect(html).toContain('已选 0 项工单');
  });
});
