import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const pricesPage = readFileSync(
  'app/(admin)/owner/prices/page.tsx',
  'utf8',
);
const itemsPage = readFileSync(
  'app/(admin)/owner/prices/external-sales/items/page.tsx',
  'utf8',
);
const versionsPage = readFileSync(
  'app/(admin)/owner/prices/external-sales/versions/page.tsx',
  'utf8',
);

describe('pricing fault-isolation contract', () => {
  it('keeps the price-management header ahead of independent legacy reads', () => {
    expect(pricesPage.indexOf("await requirePermission('dict:price:manage')"))
      .toBeLessThan(pricesPage.indexOf('const tiersPromise = listPriceTiers'));
    expect(pricesPage.indexOf('<PageHeader')).toBeLessThan(
      pricesPage.indexOf('<ErrorBoundary'),
    );
    expect(pricesPage).not.toContain('await Promise.all([');
    expect(pricesPage.match(/<ErrorBoundary/g)).toHaveLength(2);
    expect(pricesPage.match(/<Suspense/g)).toHaveLength(2);
    expect(pricesPage).toContain('价格阶梯暂时无法加载');
    expect(pricesPage).toContain('加价规则暂时无法加载');
  });

  it('shares one workspace read and preserves the list around detail/editor reads', () => {
    expect(itemsPage.indexOf("await requirePermission('dict:price:manage')"))
      .toBeLessThan(
        itemsPage.indexOf(
          'const workspacePromise = getCustomerPriceRuleGroupWorkspacePage',
        ),
      );
    expect(itemsPage).toContain('workspacePromise={workspacePromise}');
    expect(itemsPage).toContain('preservedContent={preservedWorkspace}');
    expect(itemsPage).toContain('preservedContent={editorUnavailableWorkspace}');
    expect(itemsPage).toContain('收费项目详情暂时无法加载');
    expect(itemsPage).toContain('收费项目编辑器暂时无法加载');
    expect(itemsPage).toContain('<ChargeWorkspaceSkeleton />');
  });

  it('keeps version history when a selected draft preview fails', () => {
    expect(versionsPage.indexOf("await requirePermission('dict:price:manage')"))
      .toBeLessThan(
        versionsPage.indexOf(
          'const versionsPromise = listCustomerPriceBookVersionsAndDrafts()',
        ),
      );
    expect(versionsPage.indexOf('<PageHeader')).toBeLessThan(
      versionsPage.indexOf('<ErrorBoundary'),
    );
    expect(versionsPage).toContain('preservedContent={history}');
    expect(versionsPage).toContain('发布预览暂时无法加载');
    expect(versionsPage).toContain('draftPromise={draftPromise}');
    expect(versionsPage).toContain(
      'publishPreviewPromise={publishPreviewPromise}',
    );
  });
});
