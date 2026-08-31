import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const itemsPage = readFileSync(
  'components/business/rules/pricing/CustomerPricingWorkspacePage.tsx',
  'utf8',
);
const versionsPage = readFileSync(
  'components/business/rules/pricing/PriceVersionsPage.tsx',
  'utf8',
);

describe('pricing fault-isolation contract', () => {
  it('isolates the design-native customer pricing section behind one read', () => {
    expect(itemsPage.indexOf("await requirePermission('dict:price:manage')"))
      .toBeLessThan(
        itemsPage.indexOf(
          'const workspacePromise = getCustomerPriceSectionWorkspace',
        ),
      );
    expect(itemsPage).toContain('workspacePromise={workspacePromise}');
    expect(itemsPage).toContain('<DedicatedSectionSkeleton />');
    expect(itemsPage).toContain('价格业务板块暂时无法加载');
    expect(itemsPage).toContain(
      'redirect(`${RULE_CENTER_HREFS.customerPricing}?section=blank`)',
    );
    expect(itemsPage).not.toContain('RulePriceWorkbench');
    expect(itemsPage).not.toContain('getCustomerPriceRuleGroupWorkspacePage');
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
