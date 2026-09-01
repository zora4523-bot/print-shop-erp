import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { OrderStatus } from '@/generated/prisma/enums';
import type { AdminOrderWorkspaceRow } from '@/lib/order/admin-workspace';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock('@/actions/order-workspace', () => ({
  setOrderStarredAction: vi.fn(),
}));
vi.mock('@/actions/order-export', () => ({
  requestOrderExportAction: vi.fn(),
}));
vi.mock('@/actions/admin-order-workflow', () => ({
  runAdminOrderBatchAction: vi.fn(),
  confirmFactoryOrderAction: vi.fn(),
  holdFactoryOrderAction: vi.fn(),
  rejectFactoryOrderAction: vi.fn(),
  releaseFactoryOrderAction: vi.fn(),
  resumeFactoryOrderAction: vi.fn(),
  settleFactoryOrderAction: vi.fn(),
}));
vi.mock('@/actions/order', () => ({
  previewOrderCancellationSettlementAction: vi.fn(),
  reviewOrderChangeRequestAction: vi.fn(),
}));

import { AdminOrderWorkspaceList } from '../AdminOrderWorkspaceList';

describe('AdminOrderWorkspaceList', () => {
  it('renders the rich row and the two persisted work-order progress bars', () => {
    const html = renderToStaticMarkup(
      <AdminOrderWorkspaceList
        orders={[row()]}
        selectedExportRequestKey="selected-export-request-1"
        customerFilterHrefs={{
          'order-1': '/orders?customerRef=%E5%AE%A2%E6%88%B7%E7%94%B2',
        }}
        footer={<p>分页</p>}
      />,
    );

    expect(html).toContain('data-slot="admin-order-workspace-list"');
    expect(html).toContain('GD-260902-001');
    expect(html).toContain('/orders?customerRef=%E5%AE%A2%E6%88%B7%E7%94%B2');
    expect(html).toContain('v2');
    expect(html).toContain('端午定制');
    expect(html).toContain('客户甲');
    expect(html).toContain('业务员甲');
    expect(html).toContain('局部烫金');
    expect(html).toContain('2 款 · 2,000');
    expect(html).toContain('烫金');
    expect(html).toContain('1,200 / 2,000');
    expect(html).toContain('打包');
    expect(html).toContain('800 / 2,000');
    expect(html).toContain('¥1,234.50');
    expect(html).toContain('确认');
    expect(html).toContain('分页');
    expect(html).not.toContain('进度超过工单数量');
  });

  it('把设置阈值推导的当前版本停滞前置显示', () => {
    const stagnant = row();
    stagnant.status = OrderStatus.RELEASED;
    stagnant.progress = {
      ...stagnant.progress,
      firstClaimedAt: null,
      stagnant: true,
      stagnationDays: 3,
    };
    const html = renderToStaticMarkup(
      <AdminOrderWorkspaceList
        orders={[stagnant]}
        selectedExportRequestKey="selected-export-request-2"
        customerFilterHrefs={{ 'order-1': '/orders?customerRef=customer' }}
      />,
    );

    expect(html).toContain('下发满 3 天仍无有效扫码认领');
  });
});

function row(): AdminOrderWorkspaceRow {
  return {
    id: 'order-1',
    orderNo: 'GD-260902-001',
    revision: 4,
    workOrderVersion: 2,
    customName: '端午定制',
    customer: { id: 'party-1', name: '客户甲', filterValue: '客户甲' },
    submitter: { id: 'sales-1', name: '业务员甲' },
    status: OrderStatus.CONFIRMED,
    statusSummary: null,
    isUrgent: false,
    isStarred: true,
    createdAt: '2026-09-02T01:00:00.000Z',
    submittedAt: '2026-09-02T01:00:00.000Z',
    promisedDate: '2026-09-05',
    dueAlert: { kind: 'due-soon', days: 3 },
    itemCount: 2,
    totalQuantity: 2000,
    craftSummary: '局部烫金',
    thumbnail: null,
    items: [
      {
        id: 'item-1',
        sequence: 1,
        fig: 1,
        name: '图一',
        quantity: 2000,
        specification: '中号封',
        paper: '珠光纸 160g',
        crafts: ['局部烫金'],
        thumbnail: null,
      },
    ],
    fee: { amount: '1234.50', source: 'CONFIRMED', estimated: false },
    feeStages: {
      quoted: '1200.00',
      confirmed: '1234.50',
      settled: null,
      active: 'CONFIRMED',
    },
    priceComparison: null,
    priceComparisonError: null,
    confirmationPreflight: { ok: false, issues: ['当前不是待工厂确认状态'] },
    capabilities: {
      confirm: false,
      reject: false,
      hold: true,
      resume: false,
      release: true,
      ship: false,
      settle: false,
      createPrint: false,
      markPrinted: false,
      reviewChange: false,
    },
    billing: null,
    pendingChangeRequest: null,
    printPending: false,
    pendingPrintJobId: null,
    trackingNo: null,
    progress: {
      orderTotal: '2000',
      foilingProgress: '1200',
      packingProgress: '800',
      foilingOverLimit: false,
      packingOverLimit: false,
      packingAhead: false,
      stagnant: false,
      stagnationDays: 2,
      firstClaimedAt: '2026-09-02T01:30:00.000Z',
    },
    logs: [],
  };
}
