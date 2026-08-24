import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

function source(relativePath: string): string {
  return readFileSync(join(root, relativePath), 'utf8');
}

describe('heavy admin page streaming boundaries', () => {
  it('authenticates before the orders shell and isolates filter, export, and list reads', () => {
    const page = source('app/(admin)/orders/page.tsx');
    const content = source(
      'app/(admin)/orders/_components/OrdersListContent.tsx',
    );

    expect(page.indexOf('await requireSession()')).toBeLessThan(
      page.indexOf('<PageHeader'),
    );
    expect(page.indexOf('<PageHeader')).toBeLessThan(page.indexOf('<Suspense'));
    expect(page.indexOf('<PageHeader')).toBeLessThan(
      page.indexOf('<ErrorBoundary'),
    );
    expect(page).not.toContain('listOrdersPage(');
    expect(content.match(/listOrdersPage\(actor, query\)/g)).toHaveLength(1);
    expect(content.match(/getOrderListFilterOptions\(actor\)/g)).toHaveLength(1);
    expect(content.match(/listRecentOrderExports\(user\.id\)/g)).toHaveLength(1);
    expect(content).toContain(
      'const orderPagePromise = listOrdersPage(actor, query)',
    );
    expect(content).toContain(
      'const filterOptionsPromise = getOrderListFilterOptions(actor)',
    );
    expect(content.match(/<ErrorBoundary/g)).toHaveLength(3);
    expect(content.match(/<Suspense/g)).toHaveLength(3);
    expect(content).toContain('orderPagePromise={orderPagePromise}');
    expect(content).toContain('recentExportsPromise={recentExportsPromise}');
    expect(content).toContain('工单筛选暂时无法加载');
    expect(content).toContain('导出记录暂时无法加载');
    expect(content).toContain('工单数据暂时无法加载');
    expect(content).not.toMatch(/\bcatch\s*\(/);
  });

  it('checks warehouse permission, starts each read once, and isolates warehouse regions', () => {
    const page = source('app/(admin)/owner/warehouses/page.tsx');
    const skeleton = source('components/ui-business/ContentSkeleton.tsx');

    expect(page.indexOf("await requirePermission('warehouse:manage')")).toBeLessThan(
      page.indexOf('<PageHeader'),
    );
    expect(page.indexOf('<PageHeader')).toBeLessThan(page.indexOf('<Suspense'));
    expect(page.match(/getWarehouseDashboard\(\)/g)).toHaveLength(1);
    expect(page.match(/listRecentStockTransfers\(8\)/g)).toHaveLength(1);
    expect(page.match(/listRecentInventoryCounts\(8\)/g)).toHaveLength(1);
    expect(page).toContain(
      'const dashboardPromise = getWarehouseDashboard()',
    );
    expect(page).toContain(
      'const recentTransfersPromise = listRecentStockTransfers(8)',
    );
    expect(page).toContain(
      'const recentCountsPromise = listRecentInventoryCounts(8)',
    );
    expect(page.match(/<ErrorBoundary/g)).toHaveLength(4);
    expect(page.match(/<Suspense/g)).toHaveLength(4);
    expect(page.match(/dashboardPromise=\{dashboardPromise\}/g)).toHaveLength(2);
    expect(page).toContain(
      'recentTransfersPromise={recentTransfersPromise}',
    );
    expect(page).toContain('recentCountsPromise={recentCountsPromise}');
    expect(page).toContain('最近调拨单暂时无法加载');
    expect(page).toContain('最近盘点单暂时无法加载');
    expect(page).toContain('仓库与库位设置暂时无法加载');
    expect(page.match(/<SlowLoadingHint \/>/g)).toHaveLength(3);
    expect(skeleton).toContain('const SLOW_HINT_MS = 8_000');
    expect(page).not.toContain('await Promise.all([');
    expect(page).not.toMatch(/\bcatch\s*\(/);
  });
});
