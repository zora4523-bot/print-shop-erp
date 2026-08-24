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
        footer={<div data-slot="orders-pagination">分页</div>}
      />,
    );

    expect(html.match(/aria-label="选择本页 1 项工单"/g)).toHaveLength(2);
    expect(html.match(/aria-label="选择工单 GD-260807-001"/g)).toHaveLength(2);
    expect(html.match(/aria-label="更多操作：GD-260807-001"/g)).toHaveLength(2);
    expect(html).toContain('role="status"');
    expect(html).toContain('已选 0 项工单');
    expect(html.indexOf('data-slot="orders-pagination"')).toBeLessThan(
      html.indexOf('已选 0 项工单'),
    );
  });

  it('distinguishes an empty dataset from an empty filtered result', () => {
    const emptyHtml = renderToStaticMarkup(
      <OrdersTable
        orders={[]}
        query={query}
        queryParams={{}}
      />,
    );
    const filteredHtml = renderToStaticMarkup(
      <OrdersTable
        orders={[]}
        query={{
          ...query,
          filters: { ...query.filters, q: '不存在的工单' },
        }}
        queryParams={{ q: '不存在的工单' }}
      />,
    );

    expect(emptyHtml).toContain('data-kind="no-data"');
    expect(emptyHtml).not.toContain('清除全部筛选');
    expect(filteredHtml).toContain('data-kind="no-result"');
    expect(filteredHtml).toContain('没有符合条件的工单');
    expect(filteredHtml).toContain('清除全部筛选');
  });

  it('clears filters while retaining table display preferences', () => {
    const html = renderToStaticMarkup(
      <OrdersTable
        orders={[]}
        query={{
          ...query,
          filters: { ...query.filters, isSfCollect: false },
          page: 4,
          pageSize: 50,
          sort: 'orderNo',
          dir: 'asc',
          view: 'saved',
          selectedOrderId: 'order-1',
          scrollY: 420,
        }}
        queryParams={{ isSfCollect: 'no' }}
      />,
    );
    const href = html
      .match(/href="([^"]+)"[^>]*>\s*清除全部筛选\s*<\/a>/)?.[1]
      ?.replaceAll('&amp;', '&');

    expect(href).toBeDefined();
    const url = new URL(href!, 'https://erp.example.test');
    expect([...url.searchParams.entries()]).toEqual([
      ['pageSize', '50'],
      ['sort', 'orderNo'],
      ['dir', 'asc'],
    ]);
  });
});
