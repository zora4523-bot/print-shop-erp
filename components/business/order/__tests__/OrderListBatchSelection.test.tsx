import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { Button } from '@/components/ui/button';
import { OrderStatus } from '@/generated/prisma/enums';
import {
  OrderListBatchBar,
  OrderListBatchFeedback,
  reduceOrderListSelection,
} from '../OrderListBatchSelection';

describe('order-list page selection contract', () => {
  it('can omit the copy control and feedback while preserving batch actions', () => {
    const html = renderToStaticMarkup(<OrderListBatchBar selectedItems={[{ id: 'order-1', orderNo: 'HIDDEN-ID', status: OrderStatus.CONFIRMED, canSchedule: false }]} onClear={() => {}} showCopyOrderNumbers={false} renderBatchActions={() => <Button>下发生产</Button>} />);
    expect(html).not.toContain('复制工单号');
    expect(html).not.toContain('order-list-batch-feedback');
    expect(html).toContain('下发生产');
    expect(html).toContain('取消选择');
  });

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

  it('renders a named bulk region and preserves copy/selection utilities', () => {
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
    expect(html).not.toContain('排产');
    expect(html).toContain('复制工单号');
    expect(html).toContain('取消选择');
    expect(html).not.toContain('批量取消');
    expect(html).not.toContain('批量发货');
    expect(html).not.toContain('批量付款');
    expect(html).not.toContain('导出所选');
  });

  it.each([
    {
      tone: 'success' as const,
      message: '已复制 2 个工单号',
    },
    {
      tone: 'error' as const,
      message: '工单号复制失败，请手动选择复制或检查浏览器剪贴板权限',
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
