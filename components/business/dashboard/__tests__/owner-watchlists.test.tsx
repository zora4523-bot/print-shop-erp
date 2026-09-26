import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { OrderStatus, OutsourceStatus } from '@/generated/prisma/enums';
import type {
  DueOrderRow,
  OverdueOutsourceRow,
  OverReportRow,
  PendingShipmentRow,
} from '@/lib/dashboard/owner-watchlist';
import {
  DueOrdersWatchlist,
  OverdueOutsourcingWatchlist,
  OverReportsWatchlist,
  PendingShipmentsWatchlist,
  dueOrderColumns,
  overReportColumns,
  pendingShipmentColumns,
} from '../OwnerWatchlists';

const NOW = new Date('2026-09-07T16:01:00Z');
const pagination = { page: 1, pageSize: 10, pageCount: 2 };

function pendingRow(index: number): PendingShipmentRow {
  return {
    id: `shipment-${index}`,
    orderNo: `待发编号-${index}`,
    customName: `待发名称-${index}`,
    isUrgent: index === 1,
    completedAt: new Date('2026-09-07T15:59:00Z'),
    promisedDate: new Date('2026-09-08T00:00:00Z'),
    externalSalesName: '外部销售小王',
  };
}

function dueRow(index: number): DueOrderRow {
  return {
    id: `due-${index}`,
    orderNo: `交期编号-${index}`,
    customName: `交期名称-${index}`,
    externalSalesName: '外部销售小李',
    status: OrderStatus.FOILING,
    isUrgent: false,
    promisedDate: new Date('2026-09-07T00:00:00Z'),
    daysLeft: -1,
  };
}

function outsourceRow(index: number): OverdueOutsourceRow {
  return {
    id: `outsource-${index}`,
    supplierName: `外协供应商-${index}`,
    expectedDate: new Date('2026-09-07T00:00:00Z'),
    status: OutsourceStatus.IN_PROGRESS,
    orderNo: `外协工单-${index}`,
    daysOverdue: 1,
  };
}

function overReportRow(index: number): OverReportRow {
  return {
    id: `report-${index}`,
    orderId: `order-${index}`,
    orderNo: `报工编号-${index}`,
    operatorDisplayName: '报工人小张',
    remark: '历史备注：计划 999 / 合计 888；该文本不得用于推导数量',
    createdAt: new Date('2026-09-07T08:00:00Z'),
    quantities: { completedQty: 120, defectQty: 4, reworkQty: 6, totalQty: 130 },
  };
}

const indices = [1, 2, 3, 4, 5];
const scenarios: Array<{
  kind: string;
  label: string;
  count: number;
  emptyText: string;
  render: (empty: boolean) => Promise<ReactNode>;
}> = [
  {
    kind: 'shipments', label: '待发名称', count: 12, emptyText: '暂无待发货工单',
    render: (empty) => PendingShipmentsWatchlist({
      now: NOW,
      resultPromise: Promise.resolve({
        ...pagination, rows: empty ? [] : indices.map(pendingRow),
        total: empty ? 0 : 12, hasMore: !empty,
      }),
    }),
  },
  {
    kind: 'due', label: '交期名称', count: 12, emptyText: '暂无交期风险工单',
    render: (empty) => DueOrdersWatchlist({
      resultPromise: Promise.resolve({
        ...pagination, rows: empty ? [] : indices.map(dueRow),
        total: empty ? 0 : 12, promisedThroughYmd: '2026-09-11',
      }),
    }),
  },
  {
    kind: 'outsource', label: '外协供应商', count: 5, emptyText: '暂无超期外协',
    render: (empty) => OverdueOutsourcingWatchlist({
      resultPromise: Promise.resolve(empty ? [] : indices.map(outsourceRow)),
    }),
  },
  {
    kind: 'over-reports', label: '报工编号', count: 12, emptyText: '近 7 天无超计划报工记录',
    render: (empty) => OverReportsWatchlist({
      resultPromise: Promise.resolve({
        ...pagination, rows: empty ? [] : indices.map(overReportRow),
        total: empty ? 0 : 12, sinceYmd: '2026-09-02',
      }),
    }),
  },
];

describe('工作台关注列表预览', () => {
  it.each(scenarios)('$kind 最多展示 3 条，完整入口保留相同类别与真实总数', async (scenario) => {
    const html = renderToStaticMarkup(await scenario.render(false));
    expect(html.match(/<li\b/g)).toHaveLength(3);
    for (const index of [1, 2, 3]) expect(html).toContain(`${scenario.label}-${index}`);
    for (const index of [4, 5]) expect(html).not.toContain(`${scenario.label}-${index}`);
    expect(html).toContain(`${scenario.count} 条`);
    expect(html).toContain(`href="/owner/attention?kind=${scenario.kind}"`);
    expect(html).toContain('查看全部');
  });

  it.each(scenarios)('$kind 无数据展示对应空态，无空列表和无意义的查看全部入口', async (scenario) => {
    const html = renderToStaticMarkup(await scenario.render(true));
    expect(html).toContain(scenario.emptyText);
    expect(html).toContain('0 条');
    expect(html).not.toMatch(/<ul\b/);
    expect(html).not.toContain('查看全部');
  });

  it('待发货突出上海跨日等待、工单名称与承诺交期，外部销售保留在完整列表', async () => {
    const html = renderToStaticMarkup(await scenarios[0].render(false));
    expect(html).toContain('完工后待发 1 天');
    expect(html).toContain('今日到期');
    expect(html).toContain('2026/09/08');
    expect(html).toContain('href="/orders/shipment-1"');
    expect(html).toContain('待发名称-1');
    expect(html).toContain('待发编号-1');
    expect(html).not.toContain('外部销售小王');
    const columns = pendingShipmentColumns(NOW);
    expect(columns.map(column => column.header)).toEqual(['工单', '承诺交期', '待发时长', '外部销售']);
    const salesCell = columns.find(column => column.header === '外部销售');
    if (!salesCell) throw new Error('完整列表缺少外部销售列');
    expect(renderToStaticMarkup(<>{salesCell.cell(pendingRow(1))}</>)).toBe('外部销售小王');
    expect(renderToStaticMarkup(<>{salesCell.cell({ ...pendingRow(1), externalSalesName: null })}</>)).toBe('未填');
  });

  it('交期完整列表同样按工单名称指认，并列出外部销售', () => {
    expect(dueOrderColumns.map(column => column.header)).toEqual(['工单', '当前阶段', '承诺交期', '外部销售']);
    const salesCell = dueOrderColumns.find(column => column.header === '外部销售');
    if (!salesCell) throw new Error('完整列表缺少外部销售列');
    expect(renderToStaticMarkup(<>{salesCell.cell(dueRow(1))}</>)).toBe('外部销售小李');
    const identity = renderToStaticMarkup(<>{dueOrderColumns[0].cell(dueRow(1))}</>);
    expect(identity).toContain('交期名称-1');
    expect(identity).toContain('交期编号-1');
  });

  it('未填工单名称时只显示一次工单号，不留空的次行', () => {
    const identity = pendingShipmentColumns(NOW)[0];
    const html = renderToStaticMarkup(<>{identity.cell({ ...pendingRow(1), customName: '  ' })}</>);
    expect(html.match(/待发编号-1/g)).toHaveLength(1);
    expect(html).not.toContain('待发名称');
    expect(html).not.toContain('text-muted-foreground');
  });

  it('未设置交期明确展示缺失，不生成日期', async () => {
    const row = { ...pendingRow(1), promisedDate: null };
    const html = renderToStaticMarkup(await PendingShipmentsWatchlist({
      now: NOW,
      resultPromise: Promise.resolve({ ...pagination, rows: [row], total: 1, hasMore: false }),
    }));
    expect(html).toContain('未设交期');
    expect(html).not.toContain('今日到期');
  });

  it('读取失败继续抛给区域错误边界，不能伪装成空态', async () => {
    await expect(PendingShipmentsWatchlist({
      now: NOW,
      resultPromise: Promise.reject(new Error('watchlist unavailable')),
    })).rejects.toThrow('watchlist unavailable');
  });
});

describe('超计划报工数量呈现', () => {
  it('预览展示审计数量和报工人，不从冲突备注生成计划或超出量', async () => {
    const html = renderToStaticMarkup(await scenarios[3].render(false));
    expect(html).toContain('实际合计 130');
    expect(html).toContain('合格 120 · 不良 4 · 返工 6');
    expect(html).toContain('报工人小张');
    expect(html).not.toContain('999');
    expect(html).not.toContain('888');
    expect(html).not.toContain('超出量');
    expect(html).not.toContain('历史备注');
  });

  it('缺少结构化快照时明确引导原始记录，不将缺失值渲染成零或从备注提取', async () => {
    const row = { ...overReportRow(1), quantities: null };
    const html = renderToStaticMarkup(await OverReportsWatchlist({
      resultPromise: Promise.resolve({ ...pagination, rows: [row], total: 1, sinceYmd: '2026-09-02' }),
    }));
    expect(html).toContain('数量见原始记录');
    expect(html).not.toContain('实际合计');
    expect(html).not.toContain('合格 0');
    expect(html).not.toContain('999');
    expect(html).not.toContain('888');
    expect(html).toContain('href="/owner/attention?kind=over-reports"');
  });

  it('完整列表保留原始备注并默认折叠，以便核查缺失快照', () => {
    const row = { ...overReportRow(1), quantities: null };
    const quantityColumn = overReportColumns.find(column => column.header === '报工数量');
    if (!quantityColumn) throw new Error('完整列表缺少报工数量列');
    const html = renderToStaticMarkup(<>{quantityColumn.cell(row)}</>);
    expect(html).toContain('数量见原始记录');
    expect(html).toContain('原始记录');
    expect(html).toContain(row.remark);
    expect(html).toMatch(/<details\b/);
    expect(html).not.toMatch(/<details[^>]*\bopen(?:=|\s|>)/);
    expect(html).not.toContain('实际合计');
  });

  it('数量和备注均缺失时不承诺有原始记录可查看', async () => {
    const row = { ...overReportRow(1), quantities: null, remark: null };
    const html = renderToStaticMarkup(await OverReportsWatchlist({
      resultPromise: Promise.resolve({ ...pagination, rows: [row], total: 1, sinceYmd: '2026-09-02' }),
    }));
    expect(html).toContain('未记录数量');
    expect(html).not.toContain('数量见原始记录');
    expect(html).not.toContain('实际合计');
  });
});
