import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  OrderChangeModifyKind,
  OrderChangeRequestStatus,
  OrderChangeRequestType,
  OrderStatus,
} from '@/generated/prisma/enums';

const { listPendingMock, requirePermissionMock } = vi.hoisted(() => ({
  listPendingMock: vi.fn(),
  requirePermissionMock: vi.fn(),
}));

vi.mock('@/lib/auth/permissions', () => ({
  requirePermission: requirePermissionMock,
}));

vi.mock('@/lib/order/change-request-list', () => ({
  listPendingOrderChangeRequests: listPendingMock,
  PENDING_ORDER_CHANGE_REQUEST_PAGE_SIZE: 20,
}));

import OrderChangesPage from './page';

const pendingRows = [
  {
    id: 'modify-1',
    baseRevision: 2,
    baseWorkOrderVersion: 4,
    type: OrderChangeRequestType.MODIFY,
    modifyKind: OrderChangeModifyKind.QTY,
    status: OrderChangeRequestStatus.PENDING,
    reason: '客户要求追加',
    proposedChanges: {
      items: [{ operation: 'UPDATE', name: '红包 A', quantity: 1200 }],
    },
    workOrderVersionAfter: null,
    createdAt: new Date('2026-09-02T02:00:00.000Z'),
    requester: { displayName: '销售甲' },
    order: {
      id: 'order-1',
      orderNo: 'GD-260902-001',
      customName: '中秋红包',
      status: OrderStatus.RELEASED,
      revision: 2,
      workOrderVersion: 4,
    },
  },
  {
    id: 'cancel-1',
    baseRevision: 5,
    baseWorkOrderVersion: null,
    type: OrderChangeRequestType.CANCEL,
    modifyKind: null,
    status: OrderChangeRequestStatus.PENDING,
    reason: '客户取消订单',
    proposedChanges: { items: [] },
    workOrderVersionAfter: null,
    createdAt: new Date('2026-09-02T03:00:00.000Z'),
    requester: { displayName: '客服乙' },
    order: {
      id: 'order-2',
      orderNo: 'GD 260902/002',
      customName: null,
      status: OrderStatus.CONFIRMED,
      revision: 5,
      workOrderVersion: 1,
    },
  },
];

beforeEach(() => {
  requirePermissionMock.mockReset().mockResolvedValue({ id: 'admin-1' });
  listPendingMock.mockReset().mockResolvedValue({
    rows: pendingRows,
    total: 22,
    page: 2,
    pageSize: 20,
    pageCount: 2,
  });
});

describe('OrderChangesPage', () => {
  it('awaits search params and renders the exact pending total and safe page', async () => {
    const element = await OrderChangesPage({
      searchParams: Promise.resolve({ page: ['999', '1'] }),
    });
    const html = renderToStaticMarkup(element).replaceAll('<!-- -->', '');

    expect(requirePermissionMock).toHaveBeenCalledWith('order:change:review');
    expect(listPendingMock).toHaveBeenCalledWith({ page: 999, pageSize: 20 });
    expect(html).toContain('待审核 22');
    expect(html).toContain('第 2 / 2 页');
  });

  it('distinguishes modify and cancel summaries without treating cancel as item data', async () => {
    const element = await OrderChangesPage({
      searchParams: Promise.resolve({}),
    });
    const html = renderToStaticMarkup(element).replaceAll('<!-- -->', '');

    expect(html).toContain('修改申请');
    expect(html).toContain('修改「红包 A」数量 1200');
    expect(html).toContain('取消申请');
    expect(html).toContain('申请取消整张工单');
    expect(html).not.toContain('申请数据无法显示');
  });

  it('keeps matching and legacy versions out of the normal review summary', async () => {
    const element = await OrderChangesPage({
      searchParams: Promise.resolve({}),
    });
    const html = renderToStaticMarkup(element).replaceAll('<!-- -->', '');

    expect(html).not.toContain('版本关联');
    expect(html).not.toContain('业务修订：');
    expect(html).not.toContain('生产工单：');
    expect(html).not.toContain('审批后');
    expect(html).not.toContain('工单已更新，申请需重新提交');
  });

  it('warns when either captured version no longer matches the order', async () => {
    listPendingMock.mockResolvedValue({
      rows: [
        {
          ...pendingRows[0],
          id: 'stale-revision',
          baseRevision: 1,
        },
        {
          ...pendingRows[0],
          id: 'stale-work-order-version',
          baseWorkOrderVersion: 3,
        },
      ],
      total: 2,
      page: 1,
      pageSize: 20,
      pageCount: 1,
    });

    const element = await OrderChangesPage({
      searchParams: Promise.resolve({}),
    });
    const html = renderToStaticMarkup(element).replaceAll('<!-- -->', '');

    expect(html.match(/工单已更新，申请需重新提交/g)).toHaveLength(4);
  });

  it('renders a card list for narrow screens and a table for large screens', async () => {
    const element = await OrderChangesPage({
      searchParams: Promise.resolve({}),
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain('aria-label="待审核工单申请卡片列表"');
    expect(html).toContain('class="grid gap-3 lg:hidden"');
    expect(html).toContain('role="region" aria-label="待审核工单申请列表"');
    expect(html).toContain(
      'class="hidden min-w-0 rounded-xl border bg-card shadow-sm lg:block"',
    );
  });

  it('links every row to the type-aware pending-change workspace', async () => {
    const element = await OrderChangesPage({
      searchParams: Promise.resolve({}),
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain(
      'href="/orders?queue=all&amp;signal=pending-change#wo=GD-260902-001"',
    );
    expect(html).toContain(
      'href="/orders?queue=all&amp;signal=pending-change#wo=GD%20260902%2F002"',
    );
    expect(html).not.toContain('进入新版审核');
    expect(html.match(/查看并审核/g)).toHaveLength(4);
    expect(html).not.toContain('/orders/order-1');
  });
});
