import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

function source(relativePath: string): string {
  return readFileSync(join(root, relativePath), 'utf8');
}

describe('custom loading fallback slow-loading contract', () => {
  it.each([
    ['app/(worker)/worker/loading.tsx', '正在加载师傅工作台'],
    [
      'components/business/rules/pricing/CustomerPricingLoading.tsx',
      '正在加载客户计价规则',
    ],
  ])('%s has one delayed hint inside its polite live region', (path, label) => {
    const loading = source(path);

    expect(loading).toContain('aria-live="polite"');
    expect(loading).toContain(label);
    expect(loading.match(/<SlowLoadingHint \/>/g)).toHaveLength(1);
  });

  it('composes order skeletons without nested duplicate announcements', () => {
    const skeletons = source(
      'app/(admin)/orders/_components/OrdersListContentSkeleton.tsx',
    );
    const page = source('app/(admin)/orders/page.tsx');
    const content = source(
      'app/(admin)/orders/_components/OrdersListContent.tsx',
    );

    expect(page).toContain('<SalesOrdersListContentSkeleton />');
    expect(page).toContain('<AdminOrdersWorkspaceSkeleton />');
    expect(page).toContain('<OrdersListContentSkeleton />');
    expect(content).toContain('fallback={<OrdersListFiltersSkeleton />}');
    expect(content).toContain('fallback={<OrdersListTableSkeleton />}');
    expect(content).toContain('fallback={<OrderExportControlsSkeleton />}');
    expect(content).toContain('fallback={<SalesOrdersFiltersSkeleton />}');
    expect(content).toContain('fallback={<SalesOrdersListSkeleton />}');
    expect(skeletons).toContain(
      '<OrdersListFiltersSkeleton announce={false} />',
    );
    expect(skeletons).toContain(
      '<OrdersListTableSkeleton announce={false} />',
    );
    expect(skeletons).toContain(
      '<OrderExportControlsSkeleton announce={false} />',
    );
    expect(skeletons).toContain(
      '<SalesOrdersFiltersSkeleton announce={false} />',
    );
    expect(skeletons).toContain(
      '<SalesOrdersListSkeleton announce={false} />',
    );
    expect(skeletons.match(/<SlowLoadingHint/g)).toHaveLength(8);
    const adminSkeleton = skeletons.split('export function AdminOrdersWorkspaceSkeleton')[1]?.split('\nexport function ')[0];
    expect(adminSkeleton?.match(/<SlowLoadingHint/g)).toHaveLength(1);
    expect(
      skeletons.match(/aria-live=\{announce \? 'polite' : undefined\}/g),
    ).toHaveLength(5);
  });

  it('keeps delayed loading feedback for dashboard and analytics sections', () => {
    const dashboard = source('components/business/dashboard/DashboardSectionLoading.tsx');
    expect(dashboard).toContain('<SlowLoadingHint');
    expect(dashboard).toContain('aria-live="polite"');
    const attention = source('components/business/dashboard/OrderAttentionSection.tsx');
    expect(attention).toContain('<SlowLoadingHint');
    const analytics = source('components/business/dashboard/OwnerAnalytics.tsx');
    expect(analytics).toContain('<SlowLoadingHint');
  });

});
