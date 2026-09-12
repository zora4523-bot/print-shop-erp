import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function readProjectFile(...segments: string[]): string {
  return readFileSync(path.join(process.cwd(), ...segments), 'utf8');
}

function readAdminPage(...segments: string[]): string {
  return readProjectFile('app', '(admin)', ...segments, 'page.tsx');
}

function between(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);

  if (start < 0 || end < 0) {
    throw new Error(`无法定位空态区域：${startMarker} → ${endMarker}`);
  }

  return source.slice(start, end);
}

function expectSingleSharedEmptyState(source: string): void {
  expect(source.match(/<TableEmptyState\b/g)).toHaveLength(1);
}

describe('detail no-data empty-state ownership', () => {
  it('monthly bill detail omits obsolete legacy payment history and empty optional deductions', () => {
    const source = readAdminPage('sales', 'bills', '[id]');
    expect(source).not.toContain('payments.map');
    expect(source).toContain('bill.adjustments.length ?');
  });
  it.each([
    {
      group: '(billing)',
      file: ['owner', 'bills', 'archive', '[id]'],
      start: '历史收款记录</h2>',
      end: '<Link href="/owner/bills/archive"',
      title: '暂无收款流水',
    },
    {
      group: '(admin)',
      file: ['foreman', 'outsource', '[id]'],
      start: '付款明细（',
      // 状态操作区在终态也保留，以便 Server Action 成功
      // 回执不会因整个组件卸载而丢失。因此用新的稳定组件边界。
      end: '<OutsourceActions',
      title: '暂无外协付款记录',
    },
  ])('uses one compact shared empty state for $title', ({ group, file, start, end, title }) => {
    const region = between(readProjectFile('app', group, ...file, 'page.tsx'), start, end);

    expectSingleSharedEmptyState(region);
    expect(region).toContain('variant="compact"');
    expect(region).toContain(`title="${title}"`);
  });

  it.each([
    {
      role: 'owner',
      file: [
        'components',
        'business',
        'rules',
        'catalog',
        'MaterialCatalogPages.tsx',
      ],
    },
    {
      role: 'foreman',
      file: ['app', '(admin)', 'foreman', 'materials', '[id]', 'page.tsx'],
    },
  ])(
    'keeps one semantic table-row empty state for $role material location stock',
    ({ file }) => {
      const region = between(
        readProjectFile(...file),
        '库位库存</h2>',
        '<ToggleMaterialActiveButton',
      );

      expectSingleSharedEmptyState(region);
      expect(region).toContain('<tbody>');
      expect(region).toContain('colSpan={3}');
      expect(region).toContain('title="暂无库位库存记录"');
      expect(region).toContain('locationStocks.length === 0');
    },
  );

  it('keeps one semantic table-row empty state for BOM material rows', () => {
    const region = between(
      readAdminPage('owner', 'boms', '[id]'),
      '物料清单</h2>',
      '<ToggleBomActiveButton',
    );

    expectSingleSharedEmptyState(region);
    expect(region).toContain('<tbody>');
    expect(region).toContain('colSpan={3}');
    expect(region).toContain('title="暂无物料行"');
    expect(region).toContain('bom.items.length === 0');
  });

  it('uses one compact empty state for purchase receipt history', () => {
    const region = between(
      readAdminPage('owner', 'purchases', '[id]'),
      '收货记录</h2>',
      'order.status === PurchaseOrderStatus.ORDERED',
    );

    expectSingleSharedEmptyState(region);
    expect(region).toContain('variant="compact"');
    expect(region).toContain('title="暂无收货记录"');
    expect(region).toContain('order.receipts.length === 0');
  });

  it('does not misclassify outsource payment blockers as no-data states', () => {
    const source = readAdminPage('foreman', 'outsource', '[id]');

    expect(source).toContain('paymentLedgerInvalid ? (');
    expect(source).toContain('role="alert"');
    expect(source).toContain('row.status !== OutsourceStatus.RECEIVED');
    expect(source).toContain('请先确认外协应付金额，再记录付款');
    expect(source).toContain('该外协单已结清');
    expect(source.match(/<TableEmptyState\b/g)).toHaveLength(1);
  });
});
