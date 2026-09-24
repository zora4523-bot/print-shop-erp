import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

function source(relativePath: string): string {
  return readFileSync(join(root, relativePath), 'utf8');
}

describe('custom loading fallback slow-loading contract', () => {
  it('SectionLoading owns the polite live region and exactly one delayed hint', () => {
    const shared = source('components/ui-business/SectionLoading.tsx');
    expect(shared).toContain('aria-live="polite"');
    expect(shared).toContain('正在加载{label}');
    expect(shared.match(/<SlowLoadingHint \/>/g)).toHaveLength(1);
  });

  it.each([
    ['app/(worker)/worker/loading.tsx', '师傅工作台'],
    [
      'components/business/rules/pricing/CustomerPricingLoading.tsx',
      '客户计价规则',
    ],
  ])('%s delegates its live region and delayed hint to SectionLoading exactly once', (path, label) => {
    const loading = source(path);

    expect(loading.match(/<SectionLoading label=/g)).toHaveLength(1);
    expect(loading).toContain(`label="${label}"`);
    expect(loading).not.toContain('<SlowLoadingHint');
    expect(loading).not.toContain('aria-live');
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
    expect(page).not.toContain('<OrdersListContentSkeleton />');
    expect(content).toContain('fallback={<SalesOrdersFiltersSkeleton />}');
    expect(content).toContain('fallback={<SalesOrdersListSkeleton />}');
    expect(skeletons).toContain(
      '<SalesOrdersFiltersSkeleton announce={false} />',
    );
    expect(skeletons).toContain(
      '<SalesOrdersListSkeleton announce={false} />',
    );
    expect(skeletons.match(/<SlowLoadingHint/g)).toHaveLength(4);
    const adminSkeleton = skeletons.split('export function AdminOrdersWorkspaceSkeleton')[1]?.split('\nexport function ')[0];
    expect(adminSkeleton?.match(/<SlowLoadingHint/g)).toHaveLength(1);
    expect(
      skeletons.match(/aria-live=\{announce \? 'polite' : undefined\}/g),
    ).toHaveLength(2);
  });

  it('keeps delayed loading feedback for dashboard and analytics sections', () => {
    const dashboard = source('components/business/dashboard/DashboardSectionLoading.tsx');
    expect(dashboard).toContain('<SectionLoading');
    const attention = source('components/business/dashboard/OrderAttentionSection.tsx');
    expect(attention).toContain('<SectionLoading');
    const analytics = source('components/business/dashboard/OwnerAnalytics.tsx');
    expect(analytics.match(/<SectionLoading label=/g)).toHaveLength(3);
  });

});
