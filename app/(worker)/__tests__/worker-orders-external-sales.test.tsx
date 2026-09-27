import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrderStatus, Role } from '@/generated/prisma/enums';

// 业主 2026-09-27：师傅端工单卡片与详情页头部不再显示「客户名称/简称」与单独的
// 「接单人」，合成一行「外部销售」。归属（免费重做取原单销售）由 lib/worker-portal
// 算好交给页面，页面只负责措辞与“未填”兜底。
const mocks = vi.hoisted(() => ({
  permission: vi.fn(),
  list: vi.fn(),
  detail: vi.fn(),
}));
vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('@/lib/auth/permissions', () => ({ requirePermission: mocks.permission }));
vi.mock('@/lib/auth/session', () => ({ getSession: vi.fn() }));
vi.mock('@/lib/worker-portal', () => ({
  listWorkerOrders: mocks.list,
  getWorkerOrderDetail: mocks.detail,
}));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
}));
vi.mock('@/components/business/production/WorkerOrderTaskList', () => ({
  WorkerOrderTaskList: () => null,
}));
vi.mock('@/components/business/order/DesignImageGallery', () => ({
  DesignImageGallery: () => null,
}));
vi.mock('@/lib/oss/read-url', () => ({ signDesignReadUrl: (url: string) => url }));

import WorkerOrdersPage from '../worker/orders/page';
import WorkerOrderDetailPage from '../worker/orders/[id]/page';

function listRow(id: string, externalSalesName: string | null) {
  return {
    id,
    orderNo: `GD-260927-${id}`,
    customName: `工单 ${id}`,
    status: OrderStatus.IN_PRODUCTION,
    isUrgent: false,
    promisedDate: null,
    createdAt: new Date('2026-09-27T01:00:00.000Z'),
    externalSalesName,
    operationCount: 1,
    completedOperationCount: 0,
    pieceworkAmount: '0.00',
  };
}

function detail(externalSalesName: string | null) {
  return {
    id: 'order-1',
    orderNo: 'GD-260927-001',
    customName: '七夕红包',
    status: OrderStatus.IN_PRODUCTION,
    isUrgent: false,
    promisedDate: new Date('2026-10-01T00:00:00.000Z'),
    packageRequirement: null,
    remark: null,
    createdAt: new Date('2026-09-27T01:00:00.000Z'),
    workOrderVersion: 1,
    externalSalesName,
    items: [],
    productionOperations: [],
    productionProgressSteps: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.permission.mockResolvedValue({
    id: 'worker-1',
    role: Role.WORKER,
    displayName: '张师傅',
  });
});

describe('worker order list card', () => {
  it('shows one external-salesperson line per card instead of customer and submitter', async () => {
    mocks.list.mockResolvedValue({
      rows: [listRow('charged', '桂林'), listRow('unknown', null)],
      total: 2,
      page: 1,
      pageCount: 1,
      pageSize: 20,
    });

    const html = renderToStaticMarkup(
      await WorkerOrdersPage({ searchParams: Promise.resolve({}) }),
    );

    expect(mocks.permission).toHaveBeenCalledWith('order:view:self');
    expect(html).toContain('外部销售：桂林');
    expect(html).toContain('外部销售：未填');
    expect(html.match(/外部销售：/g)).toHaveLength(2);
    expect(html).not.toContain('客户名称');
    expect(html).not.toContain('接单人');
  });
});

describe('worker order detail header', () => {
  it('replaces the customer and submitter with the attributed salesperson', async () => {
    mocks.detail.mockResolvedValue(detail('桂林'));

    const html = renderToStaticMarkup(
      await WorkerOrderDetailPage({ params: Promise.resolve({ id: 'order-1' }) }),
    );

    expect(mocks.detail).toHaveBeenCalledWith('order-1', {
      id: 'worker-1',
      role: Role.WORKER,
    });
    expect(html).toContain('外部销售：桂林 · 交期 2026/10/01');
    expect(html).not.toContain('客户名称');
    expect(html).not.toContain('接单人');
  });

  it('says 未填 when no salesperson can be attributed', async () => {
    mocks.detail.mockResolvedValue(detail(null));

    const html = renderToStaticMarkup(
      await WorkerOrderDetailPage({ params: Promise.resolve({ id: 'order-1' }) }),
    );

    expect(html).toContain('外部销售：未填');
  });
});
