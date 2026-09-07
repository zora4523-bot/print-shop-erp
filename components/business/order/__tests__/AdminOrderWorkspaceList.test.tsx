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
  previewOrderChangeRequestPricingAction: vi.fn(),
  previewOrderCancellationSettlementAction: vi.fn(),
  reviewOrderChangeRequestAction: vi.fn(),
}));

import { AdminOrderWorkspaceList } from '../AdminOrderWorkspaceList';
import {
  AdminOrderDecisionPanel,
  parseStrictNonNegativeInteger,
  parseStrictPositiveIntegerList,
} from '../AdminOrderDecisionPanel';
import { shouldShowOrderEditLink } from '../AdminOrderDrawer';
import { resultMessage } from '../AdminOrderBatchActions';

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
    expect(html).toContain('选择本页');
    expect(html).not.toContain('进度超过工单数量');
  });

  it('labels both legacy and current confirmation states as review work', () => {
    const submitted = row();
    submitted.status = OrderStatus.SUBMITTED;
    submitted.capabilities = {
      ...submitted.capabilities,
      hold: false,
      release: false,
    };
    const html = renderToStaticMarkup(
      <AdminOrderWorkspaceList
        orders={[submitted]}
        selectedExportRequestKey="selected-export-request-review"
        customerFilterHrefs={{ 'order-1': '/orders?customerRef=customer' }}
      />,
    );

    expect(html).toContain('>审核</button>');
  });

  it('shows rejected incomplete fees as excluded without exposing pricing actions', () => {
    const rejected = row();
    rejected.status = OrderStatus.REJECTED;
    rejected.fee = {
      amount: null,
      source: 'INCOMPLETE',
      estimated: false,
    };
    rejected.feeStages = {
      ...rejected.feeStages,
      active: 'INCOMPLETE',
    };
    rejected.capabilities = Object.fromEntries(
      Object.keys(rejected.capabilities).map((key) => [key, false]),
    ) as typeof rejected.capabilities;

    const listHtml = renderToStaticMarkup(
      <AdminOrderWorkspaceList
        orders={[rejected]}
        selectedExportRequestKey="selected-export-request-incomplete"
        customerFilterHrefs={{ 'order-1': '/orders?customerPartyId=party-1' }}
      />,
    );
    const actionsHtml = renderToStaticMarkup(
      <AdminOrderDecisionPanel order={rejected} />,
    );

    expect(listHtml).toContain('金额不完整');
    expect(listHtml).toContain('未计入合计');
    expect(listHtml).toContain('>详情</button>');
    expect(listHtml).not.toContain('查看待核价');
    expect(actionsHtml).not.toContain('录入人工核价');
  });

  it('keeps failed confirmation visible but disabled and provides a pricing recovery path', () => {
    const submitted = row();
    submitted.status = OrderStatus.SUBMITTED;
    submitted.priceComparisonError = '历史人工金额缺少可重算参数';
    submitted.confirmationPreflight = { ok: true, issues: [] };
    submitted.capabilities = {
      ...submitted.capabilities,
      confirm: true,
      hold: false,
      release: false,
    };
    const html = renderToStaticMarkup(
      <AdminOrderDecisionPanel order={submitted} />,
    );

    expect(html).toContain('确认工单');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>确认工单<\/button>/);
    expect(html).toContain('当前价预检失败：历史人工金额缺少可重算参数');
    expect(html).toContain('/orders/order-1#pricing-review');
    expect(html).toContain('处理核价');
  });

  it('只有加载到当前价凭证后才允许点击确认工单', () => {
    const submitted = row();
    submitted.status = OrderStatus.SUBMITTED;
    submitted.confirmationPreflight = { ok: true, issues: [] };
    submitted.capabilities = {
      ...submitted.capabilities,
      confirm: true,
      hold: false,
      release: false,
    };

    const withoutPreview = renderToStaticMarkup(
      <AdminOrderDecisionPanel order={submitted} />,
    );
    expect(withoutPreview).toMatch(
      /<button[^>]*disabled=""[^>]*>确认工单<\/button>/,
    );

    submitted.priceComparison = {
      quoted: {
        amount: '1200.00',
        versions: { processing: null, logistics: null },
      },
      current: {
        amount: '1234.50',
        versions: { processing: null, logistics: null },
      },
      quoteToken: `create-order-quote-v2:${'a'.repeat(64)}`,
      hasVersionDiff: false,
    };
    const withPreview = renderToStaticMarkup(
      <AdminOrderDecisionPanel order={submitted} />,
    );
    expect(withPreview).toContain('>确认工单</button>');
    expect(withPreview).not.toMatch(/<button[^>]*\sdisabled=""/);
  });

  it('explains how to unblock settlement when a shipped order has no confirmed fee', () => {
    const shipped = row();
    shipped.status = OrderStatus.SHIPPED;
    shipped.feeStages = { ...shipped.feeStages, confirmed: null };
    shipped.capabilities = Object.fromEntries(
      Object.keys(shipped.capabilities).map((key) => [key, false]),
    ) as typeof shipped.capabilities;
    const html = renderToStaticMarkup(
      <AdminOrderDecisionPanel order={shipped} />,
    );

    expect(html).toContain('暂不能结算：工单缺少确认金额');
    expect(html).toContain('前往工单核对物流费用与确认依据');
    expect(html).toContain('/orders/order-1#pricing-review');
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

describe('AdminOrderDecisionPanel strict integer parsing', () => {
  it('accepts only canonical non-negative integer text', () => {
    expect(parseStrictNonNegativeInteger('0')).toBe(0);
    expect(parseStrictNonNegativeInteger(' 120 ')).toBe(120);
    for (const value of ['1.5', '1e2', '1x', '-1', '', '9007199254740992']) {
      expect(parseStrictNonNegativeInteger(value), value).toBeNull();
    }
  });

  it('rejects the whole figs input instead of silently truncating invalid tokens', () => {
    expect(parseStrictPositiveIntegerList('1, 3，3')).toEqual({
      ok: true,
      values: [1, 3],
    });
    expect(parseStrictPositiveIntegerList('')).toEqual({ ok: true, values: [] });
    for (const value of ['1.5', '1e2', '1x', '0', '-1']) {
      expect(parseStrictPositiveIntegerList(value), value).toEqual({ ok: false });
    }
  });
});

describe('AdminOrderDecisionPanel change request integration', () => {
  it('mounts automatic pricing review for MODIFY instead of direct approve buttons', () => {
    const pendingModify = row();
    pendingModify.capabilities = {
      ...pendingModify.capabilities,
      reviewChange: true,
    };
    pendingModify.pendingChangeRequest = {
      id: 'change-request-1',
      type: 'MODIFY',
      reason: '修改数量',
      createdAt: '2026-09-03T02:00:00.000Z',
    };

    const html = renderToStaticMarkup(
      <AdminOrderDecisionPanel order={pendingModify} />,
    );

    expect(html).toContain('管理员确认的是是否接受变更');
    expect(html).toContain('款式与费用由服务端按最新规则自动合并和重算');
    expect(html).toContain('审核备注 / 拒绝原因');
    expect(html).not.toContain('批准修改');
  });

  it('keeps the existing produced-quantity settlement flow for CANCEL', () => {
    const pendingCancel = row();
    pendingCancel.capabilities = {
      ...pendingCancel.capabilities,
      reviewChange: true,
    };
    pendingCancel.pendingChangeRequest = {
      id: 'cancel-request-1',
      type: 'CANCEL',
      reason: '客户取消',
      createdAt: '2026-09-03T02:00:00.000Z',
    };

    const html = renderToStaticMarkup(
      <AdminOrderDecisionPanel order={pendingCancel} />,
    );

    expect(html).toContain('批准取消');
    expect(html).toContain('拒绝申请');
    expect(html).not.toContain('审核备注 / 拒绝原因');
  });
});

describe('AdminOrderDrawer edit entry', () => {
  it('hides the dead edit route for every non-editable terminal state', () => {
    for (const status of [
      OrderStatus.COMPLETED,
      OrderStatus.SHIPPED,
      OrderStatus.SETTLED,
      OrderStatus.FINISHED,
      OrderStatus.CANCELLED,
    ]) {
      expect(shouldShowOrderEditLink(status), status).toBe(false);
    }
    expect(shouldShowOrderEditLink(OrderStatus.SUBMITTED)).toBe(true);
    expect(shouldShowOrderEditLink(OrderStatus.IN_PRODUCTION)).toBe(true);
  });
});

describe('AdminOrderBatchActions partial failure feedback', () => {
  it('distinguishes committed, unknown and unattempted rows', () => {
    expect(
      resultMessage({
        status: 'partial_failure',
        message: '批量操作发生系统异常，已刷新列表；请核对每张工单后再重试',
        result: {
          command: 'CREATE_PRINT',
          successCount: 2,
          skippedCount: 1,
          failedCount: 1,
          notAttemptedCount: 3,
          items: [],
        },
      }),
    ).toContain('成功 2 张，业务跳过 1 张，结果未知 1 张，未执行 3 张');
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
