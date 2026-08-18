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
  createdAt: new Date('2026-08-07T08:00:00.000Z'),
  updatedAt: new Date('2026-08-07T08:00:00.000Z'),
  pieceworkCost: null,
};

describe('OrdersTable commercial visibility', () => {
  it('does not render the amount column or value for WORKER', () => {
    const html = renderToStaticMarkup(
      <OrdersTable
        orders={[order]}
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
  });
});
