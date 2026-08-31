import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { OrderStatus } from '@/generated/prisma/enums';
import {
  buildBatchSchedulingHref,
  OrderListBatchBar,
  OrderListBatchFeedback,
  reduceOrderListSelection,
} from '../OrderListBatchSelection';
import { orderRowSecondaryActions } from '../OrderRowActions';

describe('order-list page selection contract', () => {
  it('toggles one row, the current page, and clear without retaining stale IDs', () => {
    expect(
      reduceOrderListSelection([], { type: 'toggle', orderId: 'order-1' }),
    ).toEqual(['order-1']);
    expect(
      reduceOrderListSelection(['order-1'], {
        type: 'toggle-page',
        orderIds: ['order-1', 'order-2', 'order-2'],
      }),
    ).toEqual(['order-1', 'order-2']);
    expect(
      reduceOrderListSelection(['order-1', 'order-2', 'other-page'], {
        type: 'toggle-page',
        orderIds: ['order-1', 'order-2'],
      }),
    ).toEqual(['other-page']);
    expect(
      reduceOrderListSelection(['order-1'], { type: 'clear' }),
    ).toEqual([]);
  });

  it('renders a named bulk region, reserves its height and scopes scheduling handoff', () => {
    const html = renderToStaticMarkup(
      <OrderListBatchBar
        selectedItems={[
          {
            id: 'order-1',
            orderNo: 'GD-001',
            status: OrderStatus.SUBMITTED,
            canSchedule: true,
          },
          {
            id: 'order-2',
            orderNo: 'GD-002',
            status: OrderStatus.IN_PRODUCTION,
            canSchedule: true,
          },
        ]}
        onClear={vi.fn()}
      />,
    );

    expect(html).toContain('aria-label="工单批量操作"');
    expect(html).toContain('已选 2 项');
    expect(html).toContain('data-slot="order-list-batch-placeholder"');
    expect(html).toContain('data-slot="order-list-batch-placeholder-height"');
    expect(html.indexOf('order-list-batch-placeholder')).toBeLessThan(
      html.indexOf('aria-label="工单批量操作"'),
    );
    expect(html).toContain('去批量排产（1）');
    const schedulingHref = html.match(/href="([^"]+)"/)?.[1]?.replaceAll(
      '&amp;',
      '&',
    );
    expect(
      new URL(schedulingHref!, 'https://erp.example.test').searchParams.getAll(
        'orderIds',
      ),
    ).toEqual(['order-1']);
    expect(html).toContain('复制工单号');
    expect(html).toContain('取消选择');
    expect(html).not.toContain('批量取消');
    expect(html).not.toContain('批量发货');
    expect(html).not.toContain('批量付款');
    expect(html).not.toContain('导出所选');
  });

  it('uses repeated orderIds and excludes unauthorized or non-submitted rows', () => {
    const href = buildBatchSchedulingHref([
      {
        id: 'submitted-1',
        orderNo: 'GD-001',
        status: OrderStatus.SUBMITTED,
        canSchedule: true,
      },
      {
        id: 'submitted-2',
        orderNo: 'GD-002',
        status: OrderStatus.SUBMITTED,
        canSchedule: true,
      },
      {
        id: 'role-denied',
        orderNo: 'GD-003',
        status: OrderStatus.SUBMITTED,
        canSchedule: false,
      },
      {
        id: 'already-producing',
        orderNo: 'GD-004',
        status: OrderStatus.IN_PRODUCTION,
        canSchedule: true,
      },
    ]);

    const url = new URL(href!, 'https://erp.example.test');
    expect(url.pathname).toBe('/foreman/scheduling');
    expect(url.searchParams.getAll('orderIds')).toEqual([
      'submitted-1',
      'submitted-2',
    ]);
    expect(
      buildBatchSchedulingHref([
        {
          id: 'role-denied',
          orderNo: 'GD-003',
          status: OrderStatus.SUBMITTED,
          canSchedule: false,
        },
      ]),
    ).toBeNull();
  });

  it.each([
    {
      tone: 'success' as const,
      message: '已复制 2 个工单号',
    },
    {
      tone: 'error' as const,
      message: '复制失败，请检查浏览器的剪贴板权限后重试',
    },
  ])('keeps $tone feedback visible in the live region', (feedback) => {
    const html = renderToStaticMarkup(
      <OrderListBatchFeedback feedback={feedback} />,
    );

    expect(html).toContain('data-slot="order-list-batch-feedback"');
    expect(html).toContain(`data-tone="${feedback.tone}"`);
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-atomic="true"');
    expect(html).toContain(feedback.message);
    expect(html).toContain('truncate');
    expect(html).not.toContain('sr-only');
  });
});

describe('order row secondary action contract', () => {
  it('shows scheduling only to an authorized actor on a submitted order', () => {
    const allowed = orderRowSecondaryActions({
      orderId: 'order-1',
      status: OrderStatus.SUBMITTED,
      canSchedule: true,
    });
    const roleDenied = orderRowSecondaryActions({
      orderId: 'order-1',
      status: OrderStatus.SUBMITTED,
      canSchedule: false,
    });
    const terminal = orderRowSecondaryActions({
      orderId: 'order-1',
      status: OrderStatus.FINISHED,
      canSchedule: true,
    });

    expect(allowed.map((action) => action.id)).toEqual([
      'schedule',
      'print',
      'pdf',
    ]);
    expect(roleDenied.map((action) => action.id)).toEqual(['print', 'pdf']);
    expect(terminal.map((action) => action.id)).toEqual(['print', 'pdf']);
    expect(allowed[0]?.href).toBe('/foreman/scheduling/order-1');
  });

  it('uses the existing scoped print and PDF destinations', () => {
    const actions = orderRowSecondaryActions({
      orderId: 'order-1',
      status: OrderStatus.CANCELLED,
      canSchedule: false,
    });

    expect(actions).toEqual([
      {
        id: 'print',
        label: '打印工单',
        href: '/print/orders/order-1?autoprint=1',
        newTab: true,
      },
      {
        id: 'pdf',
        label: '下载 PDF',
        href: '/api/orders/order-1/pdf',
      },
    ]);
  });
});
