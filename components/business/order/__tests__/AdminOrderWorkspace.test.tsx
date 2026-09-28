import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('../AdminOrderWorkspaceList', () => ({
  AdminOrderWorkspaceList: () => <div data-testid="rich-list">富行列表</div>,
}));

import {
  AdminOrderWorkspace,
  adminSubmitterFilterParams,
  adminRejectedFilterParams,
} from '../AdminOrderWorkspace';
import {
  parseAdminOrderWorkspaceQuery,
  type AdminOrderWorkspaceQuery,
} from '@/lib/order/admin-workspace-query';

describe('AdminOrderWorkspace', () => {
  it('adds a rejected-order entry without classifying rejection as completed or retaining incompatible queue filters', () => {
    const query = parseAdminOrderWorkspaceQuery({ queue: 'done', signal: 'pending-change', unbilled: 'yes', q: '客户甲', page: '4' }).query;
    const params = adminRejectedFilterParams(query);
    expect(params).toMatchObject({ queue: 'all', status: 'REJECTED', q: '客户甲' });
    expect(params.signal).toBeUndefined();
    expect(params.unbilled).toBeUndefined();
    expect(params.page).toBeUndefined();
    const activeQuery = parseAdminOrderWorkspaceQuery({ queue: 'all', status: 'REJECTED', q: '客户甲' }).query;
    expect(adminRejectedFilterParams(activeQuery).status).toBeUndefined();
  });
  it('filters by the owning salesperson and resets pagination', () => {
    expect(adminSubmitterFilterParams({ id: 'sales-1', name: '业务员甲' })).toEqual({
      submitterId: 'sales-1', page: undefined,
    });
  });

  it('renders decision and receivable cards, six queues and the whole-result summary', () => {
    const query = parseAdminOrderWorkspaceQuery({}).query;
    const html = renderWorkspace(query);

    expect(html).toContain('data-slot="admin-order-workspace"');
    for (const label of [
      '待处理',
      '待核价',
      '待下发生产',
      '变更申请',
      '已暂停',
      '已逾期',
      '今日待发',
      '待办',
      '待打印',
      '生产中',
      '已发货',
      '已结算/取消',
      '全部',
      '已驳回 / 待补正',
    ]) {
      expect(html).toContain(label);
    }
    expect(html).toContain('搜工单号 / 名称 / 运单号');
    expect(html).toContain('按业务员筛选');
    expect(html).not.toContain('产品客户');
    expect(html).not.toContain('name="customerRef"');
    expect(html).toContain('12,345');
    expect(html).toContain('¥ 4,567.80');
    expect(html).toContain('另 1 单待核价未计入');
    expect(html).toContain('另 3 单金额不完整未计入');
    expect(html).toContain('另 2 单历史金额未计入');
    expect(html).toContain('待收款 · 2 张');
    expect(html).toContain('¥ 998.50');
    expect(html).toContain('仅未出账');
    expect(html).toContain('富行列表');
  });

  it('renders an old customer-filter bookmark exactly like the unfiltered workspace', () => {
    const bookmarked = parseAdminOrderWorkspaceQuery({
      queue: 'all',
      customerRef: '客户甲',
      customerPartyId: 'party-1',
      customerRefExact: '旧客户乙',
    });
    const current = parseAdminOrderWorkspaceQuery({ queue: 'all' });

    expect(bookmarked.issues).toEqual([]);
    const html = renderWorkspace(bookmarked.query);
    expect(html).toBe(renderWorkspace(current.query));
    for (const retired of ['customerRef', 'customerPartyId', 'customerRefExact', '客户甲', '旧客户乙', '产品客户']) {
      expect(html).not.toContain(retired);
    }
    // No filter survives the retired params, so there is nothing to clear.
    expect(html).not.toContain('清除筛选');
  });
});

function renderWorkspace(query: AdminOrderWorkspaceQuery) {
  return renderToStaticMarkup(
    <AdminOrderWorkspace
      query={query}
      issues={[]}
      options={{
        submitters: [{ id: 'sales-1', label: '业务员甲' }],
        workers: [],
        crafts: [{ id: 'craft-1', label: '局部烫金' }],
      }}
      billingStats={{
        receivableAmount: '998.50',
        receivableBillCount: 2,
        unbilledOrderCount: 3,
        draftBillCount: 1,
      }}
      exportControls={<span>导出工单</span>}
      selectedExportRequestKey="selected-export-request"
      data={{
        rows: [],
        total: 8,
        page: 1,
        pageSize: 20,
        pageCount: 1,
        counts: {
          queues: {
            todo: 3,
            print: 2,
            production: 4,
            shipped: 1,
            done: 2,
            all: 12,
          },
          signals: {
            'pending-quantity': 0, 'pending-confirmation': 2,
            'pending-pricing': 1,
            'pending-change': 1,
            'pending-release': 0,
            'on-hold': 1,
            overdue: 2,
            'due-today': 3,
          },
        },
        summary: {
          orderCount: 8,
          totalQuantity: 12345,
          effectiveFee: '4567.80',
          manualPricingCount: 1,
          incompleteFeeExcludedCount: 3,
          legacyFeeExcludedCount: 2,
        },
      }}
    />,
  );
}
