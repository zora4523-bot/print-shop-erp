import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const LOCKED_FORM_FILES = [
  'production/OperationReportForm.tsx',
  'setting/SettingsForm.tsx',
] as const;
const LOCKED_NAVIGATION_FORM_FILES = [
  'bom/BomForm.tsx',
  'craft/CraftForm.tsx',
  'product-category/ProductCategoryForm.tsx',
  'purchase/PurchaseOrderForm.tsx',
] as const;

describe('pending mutation field locks', () => {
  it.each(LOCKED_FORM_FILES)(
    '%s locks its editable snapshot while the action is pending',
    (relativePath) => {
      const source = parseBusinessFile(relativePath);
      const pendingFieldsets = findOpeningElements(source, 'fieldset').filter(
        (opening) => jsxExpressionAttribute(opening, 'disabled') === 'pending',
      );

      expect(
        pendingFieldsets.length,
        `${relativePath} must disable a fieldset from the same pending state exposed by the form`,
      ).toBeGreaterThan(0);
    },
  );

  it.each(LOCKED_NAVIGATION_FORM_FILES)(
    '%s routes every link through the pending navigation guard',
    (relativePath) => {
      const source = parseBusinessFile(relativePath);
      const guardedLinks = findOpeningElements(source, 'PendingLink');

      expect(
        findOpeningElements(source, 'Link'),
        `${relativePath} must not leave an unguarded Next.js Link in the pending form`,
      ).toEqual([]);
      // 表单底部的「返回列表」已删除（与页头 PageHeader back 重复，ui 审查批次 B/C），
      // 表单内若仍有链接，必须全部经 PendingLink 并跟随 pending。
      for (const guardedLink of guardedLinks) {
        expect(jsxExpressionAttribute(guardedLink, 'pending')).toBe('pending');
      }
    },
  );

  it('keeps pending links discoverable while blocking every navigation path', () => {
    const source = readFileSync(
      path.join(ROOT, 'components', 'ui-business', 'PendingLink.tsx'),
      'utf8',
    );

    expect(source).toContain('aria-disabled={pending || undefined}');
    expect(source).toContain('tabIndex={pending ? -1 : tabIndex}');
    expect(source.match(/event\.preventDefault\(\)/g)).toHaveLength(2);
    expect(source).toContain(
      "pending && 'pointer-events-none cursor-not-allowed opacity-50'",
    );
  });
});

function parseBusinessFile(relativePath: string): ts.SourceFile {
  const filePath = path.join(ROOT, 'components', 'business', relativePath);
  return ts.createSourceFile(
    filePath,
    readFileSync(filePath, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
}

function findOpeningElements(
  source: ts.SourceFile,
  tagName: string,
): ts.JsxOpeningLikeElement[] {
  const openings: ts.JsxOpeningLikeElement[] = [];
  const visit = (node: ts.Node) => {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      node.tagName.getText(source) === tagName
    ) {
      openings.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return openings;
}

function jsxExpressionAttribute(
  opening: ts.JsxOpeningLikeElement,
  name: string,
): string | null {
  const attribute = opening.attributes.properties.find(
    (property): property is ts.JsxAttribute =>
      ts.isJsxAttribute(property) && property.name.getText() === name,
  );
  return attribute?.initializer && ts.isJsxExpression(attribute.initializer)
    ? attribute.initializer.expression?.getText() ?? null
    : null;
}
