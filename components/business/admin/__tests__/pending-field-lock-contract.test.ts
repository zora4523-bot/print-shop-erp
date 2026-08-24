import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const LOCKED_FORM_FILES = [
  'production/ReportTaskForm.tsx',
  'salary/StartCsPeriodForm.tsx',
  'salary/WorkerMachineRuleForm.tsx',
  'setting/SettingsForm.tsx',
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

  it('prevents the customer-service period form from navigating away while pending', () => {
    const source = parseBusinessFile('salary/StartCsPeriodForm.tsx');
    const links = findOpeningElements(source, 'Link');
    const cancelLink = links.find((opening) =>
      opening.getText(source).includes('/owner/salary/cs'),
    );

    expect(cancelLink).toBeDefined();
    expect(jsxExpressionAttribute(cancelLink!, 'aria-disabled')).toContain(
      'pending',
    );
    expect(jsxExpressionAttribute(cancelLink!, 'tabIndex')).toContain(
      'pending',
    );
    expect(jsxExpressionAttribute(cancelLink!, 'onClick')).toContain(
      'preventDefault',
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
