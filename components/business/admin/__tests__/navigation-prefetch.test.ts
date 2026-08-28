import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const DENSE_LINK_FILES = [
  'components/business/account/AccountsTable.tsx',
  'components/business/admin/AdminDataTable.tsx',
  'components/business/bom/BomsTable.tsx',
  'components/business/craft/CraftsTable.tsx',
  'components/business/material/MaterialsTable.tsx',
  'components/business/order/OrdersTable.tsx',
  'components/business/party/PartiesTable.tsx',
  'components/business/price/PriceTables.tsx',
  'components/business/product/ProductsTable.tsx',
  'components/business/product-category/ProductCategoryNodesTable.tsx',
  'components/business/purchase/PurchaseOrdersTable.tsx',
] as const;

describe('admin navigation prefetch policy', () => {
  it('does not auto-prefetch every link rendered by dense tables', () => {
    const failures: string[] = [];

    for (const relativePath of DENSE_LINK_FILES) {
      const filePath = path.join(ROOT, relativePath);
      const source = ts.createSourceFile(
        filePath,
        readFileSync(filePath, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
      );

      const visit = (node: ts.Node) => {
        if (
          (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
          node.tagName.getText(source) === 'Link' &&
          !hasFalsePrefetch(node)
        ) {
          const line =
            source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
          failures.push(`${relativePath}:${line}`);
        }
        ts.forEachChild(node, visit);
      };

      visit(source);
    }

    expect(
      failures,
      `Dense table links must use prefetch={false} to avoid authenticated RSC request floods:\n${failures.join('\n')}`,
    ).toEqual([]);
  });

  it('prefetches sidebar routes only after sustained user intent', () => {
    const sidebar = readFileSync(
      path.join(ROOT, 'components/business/admin/AppSidebar.tsx'),
      'utf8',
    );

    expect(sidebar).toContain('useLinkStatus');
    expect(sidebar).toContain(
      'prefetch={intentHref === item.href ? true : false}',
    );
    expect(sidebar).toContain('IntentPrefetchScheduler');
    expect(sidebar).toContain('onEnter={scheduleIntentPrefetch}');
    expect(sidebar).toContain('onLeave={cancelIntentPrefetch}');
    expect(sidebar).toContain('onEnter(item.href)');
    expect(sidebar).toContain('onMouseLeave');
    expect(sidebar).not.toContain('onFocus');
    expect(sidebar).not.toContain('onTouchStart');
    expect(sidebar).toContain('<SidebarLinkPendingIndicator />');
  });

  it('does not eagerly prefetch header and breadcrumb navigation', () => {
    const header = readFileSync(
      path.join(ROOT, 'components/business/admin/AdminHeader.tsx'),
      'utf8',
    );
    const breadcrumb = readFileSync(
      path.join(ROOT, 'components/business/admin/AdminBreadcrumb.tsx'),
      'utf8',
    );

    expect(header).toContain('prefetch={false}');
    expect(breadcrumb).toContain('prefetch={false}');
    expect(breadcrumb).toContain('export const BREADCRUMB_PATH_LABELS');
    expect(breadcrumb).toContain('RULE_CENTER_SIDEBAR_ITEMS');
    expect(breadcrumb).toContain('item.breadcrumbLabel');
    expect(breadcrumb).toContain('Object.fromEntries');
    expect(breadcrumb).toContain("prices: '价格管理'");
    expect(breadcrumb).toContain("'external-sales': '客户计价规则'");
    expect(breadcrumb).toContain("quote: '报价查询'");
  });
});

function hasFalsePrefetch(opening: ts.JsxOpeningLikeElement): boolean {
  const attribute = opening.attributes.properties.find(
    (property): property is ts.JsxAttribute =>
      ts.isJsxAttribute(property) &&
      property.name.getText() === 'prefetch',
  );

  return Boolean(
    attribute?.initializer &&
      ts.isJsxExpression(attribute.initializer) &&
      attribute.initializer.expression?.kind === ts.SyntaxKind.FalseKeyword,
  );
}
