import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

function hrefTags(file: string, includes: (expression: string) => boolean): string[] {
  const source = ts.createSourceFile(file, readFileSync(path.resolve(file), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const tags: string[] = [];
  function visit(node: ts.Node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const href = node.attributes.properties.find((attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText(source) === 'href');
      if (href && ts.isJsxAttribute(href) && href.initializer && includes(href.initializer.getText(source))) tags.push(node.tagName.getText(source));
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return tags;
}

describe('PDF download navigation', () => {
  it.each([
    'components/business/order/AdminOrderDetailView.tsx',
    'app/(admin)/orders/[id]/page.tsx',
  ])('%s must not route or prefetch a download through next/link', (file) => {
    expect(hrefTags(file, (href) => href.includes('/api/orders/') && href.includes('/pdf'))).toEqual(['a', 'a']);
  });

  it('uses a native PDF link in batch results', () => {
    expect(hrefTags('components/business/order/AdminOrderBatchResultProvider.tsx', (href) => href.includes('/pdf'))).toEqual(['a']);
  });

  it('renders row menu download destinations as native anchors', () => {
    expect(hrefTags('components/business/order/OrderRowActions.tsx', (href) => href === '{action.href}')).toEqual(['a']);
  });
});
