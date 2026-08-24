import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

function source(relativePath: string): string {
  return readFileSync(join(root, relativePath), 'utf8');
}

function functionBlock(
  contents: string,
  functionName: string,
  nextFunctionName?: string,
): string {
  const start = contents.indexOf(`function ${functionName}`);
  const end = nextFunctionName
    ? contents.indexOf(`function ${nextFunctionName}`, start + 1)
    : contents.length;

  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return contents.slice(start, end);
}

describe('custom loading fallback slow-loading contract', () => {
  it.each([
    ['app/(worker)/worker/loading.tsx', '正在加载师傅工作台'],
    [
      'app/(admin)/owner/prices/external-sales/loading.tsx',
      '正在加载外部销售收费项目',
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

    expect(page).toContain('fallback={<OrdersListContentSkeleton />}');
    expect(content).toContain('fallback={<OrdersListFiltersSkeleton />}');
    expect(content).toContain('fallback={<OrdersListTableSkeleton />}');
    expect(content).toContain('fallback={<OrderExportControlsSkeleton />}');
    expect(skeletons).toContain(
      '<OrdersListFiltersSkeleton announce={false} />',
    );
    expect(skeletons).toContain(
      '<OrdersListTableSkeleton announce={false} />',
    );
    expect(skeletons).toContain(
      '<OrderExportControlsSkeleton announce={false} />',
    );
    expect(skeletons.match(/<SlowLoadingHint/g)).toHaveLength(4);
    expect(
      skeletons.match(/aria-live=\{announce \? 'polite' : undefined\}/g),
    ).toHaveLength(3);
  });

  it('keeps one delayed hint in every independent Dashboard fallback', () => {
    const dashboard = source('app/(admin)/owner/page.tsx');
    const fallbacks = [
      ['DashboardHeaderLoading', 'DashboardQueueLoading'],
      ['DashboardQueueLoading', 'DashboardStatsLoading'],
      ['DashboardStatsLoading', 'DashboardWatchlistLoading'],
      ['DashboardWatchlistLoading', 'DashboardChartsSection'],
      ['DashboardChartsLoading', undefined],
    ] as const;

    for (const [name, nextName] of fallbacks) {
      const block = functionBlock(dashboard, name, nextName);
      expect(block.match(/<SlowLoadingHint/g)).toHaveLength(1);
      expect(block).toContain('aria-live=');
      expect(block).not.toContain('className="contents"');
    }
  });
});
