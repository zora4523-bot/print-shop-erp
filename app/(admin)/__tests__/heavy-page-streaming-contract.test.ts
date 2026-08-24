import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

function source(relativePath: string): string {
  return readFileSync(join(root, relativePath), 'utf8');
}

describe('heavy admin page streaming boundaries', () => {
  it('authenticates the orders page before exposing its shell and keeps reads inside one Suspense child', () => {
    const page = source('app/(admin)/orders/page.tsx');
    const content = source(
      'app/(admin)/orders/_components/OrdersListContent.tsx',
    );

    expect(page.indexOf('await requireSession()')).toBeLessThan(
      page.indexOf('<PageHeader'),
    );
    expect(page.indexOf('<PageHeader')).toBeLessThan(page.indexOf('<Suspense'));
    expect(page).not.toContain('listOrdersPage(');
    expect(content.match(/listOrdersPage\(actor, query\)/g)).toHaveLength(1);
    expect(content.match(/getOrderListFilterOptions\(actor\)/g)).toHaveLength(1);
    expect(content.match(/listRecentOrderExports\(user\.id\)/g)).toHaveLength(1);
    expect(content).toContain('await Promise.all([');
    expect(content).not.toMatch(/\bcatch\s*\(/);
  });

  it('checks warehouse permission before its shell and starts each fresh read once', () => {
    const page = source('app/(admin)/owner/warehouses/page.tsx');

    expect(page.indexOf("await requirePermission('warehouse:manage')")).toBeLessThan(
      page.indexOf('<PageHeader'),
    );
    expect(page.indexOf('<PageHeader')).toBeLessThan(page.indexOf('<Suspense'));
    expect(page.match(/getWarehouseDashboard\(\)/g)).toHaveLength(1);
    expect(page.match(/listRecentStockTransfers\(8\)/g)).toHaveLength(1);
    expect(page.match(/listRecentInventoryCounts\(8\)/g)).toHaveLength(1);
    expect(page).toContain('await Promise.all([');
    expect(page).not.toMatch(/\bcatch\s*\(/);
  });
});
