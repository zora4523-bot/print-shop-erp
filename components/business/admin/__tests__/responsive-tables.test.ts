import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const TABLE_ROOTS = [path.join(ROOT, 'app', '(admin)'), path.join(ROOT, 'components', 'business')];

describe('admin native tables', () => {
  it('keeps every table inside a labelled, keyboard-focusable horizontal scroller', () => {
    const failures: string[] = [];

    for (const filePath of TABLE_ROOTS.flatMap(findTsxFiles)) {
      if (filePath.endsWith('OrderPrintLayout.tsx')) continue;
      const sourceText = readFileSync(filePath, 'utf8');
      // Avoid building a TypeScript AST for the hundreds of business TSX
      // files that cannot contain the native-table contract under test.
      if (!sourceText.includes('<table')) continue;
      const source = ts.createSourceFile(
        filePath,
        sourceText,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
      );

      const visit = (node: ts.Node) => {
        if (ts.isJsxElement(node) && jsxTagName(node.openingElement) === 'table') {
          const wrapper = findScrollWrapper(node.parent);
          if (!wrapper) {
            const line = source.getLineAndCharacterOfPosition(
              node.openingElement.getStart(source),
            ).line + 1;
            failures.push(`${path.relative(ROOT, filePath)}:${line}`);
          }
        }
        ts.forEachChild(node, visit);
      };

      visit(source);
    }

    expect(failures, `Tables missing a labelled scroll region:\n${failures.join('\n')}`).toEqual([]);
  });
});

function findTsxFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) return findTsxFiles(entryPath);
    return entry.isFile() && entry.name.endsWith('.tsx') ? [entryPath] : [];
  });
}

function findScrollWrapper(node: ts.Node): ts.JsxElement | null {
  let current: ts.Node | undefined = node;
  while (current && !ts.isSourceFile(current)) {
    if (ts.isJsxElement(current)) {
      const opening = current.openingElement;
      if (jsxTagName(opening) === 'TableScrollArea') return current;
      if (
        jsxAttribute(opening, 'role') === 'region' &&
        jsxAttribute(opening, 'aria-label') !== null &&
        jsxExpressionAttribute(opening, 'tabIndex') === '0' &&
        jsxAttribute(opening, 'className')?.includes('overflow-x-auto')
      ) {
        return current;
      }
    }
    current = current.parent;
  }
  return null;
}

function jsxTagName(opening: ts.JsxOpeningLikeElement): string {
  return opening.tagName.getText();
}

function jsxAttribute(
  opening: ts.JsxOpeningLikeElement,
  name: string,
): string | null {
  const attribute = opening.attributes.properties.find(
    (property): property is ts.JsxAttribute =>
      ts.isJsxAttribute(property) && property.name.getText() === name,
  );
  return attribute?.initializer && ts.isStringLiteral(attribute.initializer)
    ? attribute.initializer.text
    : null;
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
