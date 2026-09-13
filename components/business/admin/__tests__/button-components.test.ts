import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const BUTTON_ROOTS = [
  path.join(ROOT, 'app', '(admin)'),
  path.join(ROOT, 'components', 'business'),
];

describe('admin and business buttons', () => {
  // Parse every admin/business TSX file; keep the full repository scan and
  // assertions, with a separate budget for slower hosted CI CPUs.
  it('uses the shared Button component instead of one-off native buttons', () => {
    const failures: string[] = [];

    for (const filePath of BUTTON_ROOTS.flatMap(findTsxFiles)) {
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
          node.tagName.getText() === 'button' &&
          !hasDocumentedNativeEscapeHatch(node)
        ) {
          const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
          failures.push(`${path.relative(ROOT, filePath)}:${line}`);
        }
        ts.forEachChild(node, visit);
      };

      visit(source);
    }

    expect(
      failures,
      `Native buttons must use @/components/ui/button (or document a necessary primitive with data-native-button-reason):\n${failures.join('\n')}`,
    ).toEqual([]);
  }, 20_000);
});

function findTsxFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) return findTsxFiles(entryPath);
    return entry.isFile() && entry.name.endsWith('.tsx') ? [entryPath] : [];
  });
}

function hasDocumentedNativeEscapeHatch(
  opening: ts.JsxOpeningLikeElement,
): boolean {
  const attribute = opening.attributes.properties.find(
    (property): property is ts.JsxAttribute =>
      ts.isJsxAttribute(property) &&
      property.name.getText() === 'data-native-button-reason',
  );
  return Boolean(
    attribute?.initializer &&
      ts.isStringLiteral(attribute.initializer) &&
      attribute.initializer.text.trim(),
  );
}
