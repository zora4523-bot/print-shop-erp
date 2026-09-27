import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const BUSINESS_COMPONENT_ROOT = path.join(ROOT, 'components', 'business');

const PENDING_FORM_CONTRACTS: ReadonlyArray<
  readonly [relativePath: string, busyExpression: string]
> = [
  ['admin/BackgroundJobActionButton.tsx', 'pending'],
  ['auth/ChangePasswordForm.tsx', 'pending'],
  ['auth/LoginForm.tsx', 'pending'],
  ['bill/GenerateBillsForm.tsx', 'pending'],
  ['bill/OrderCostEntryForm.tsx', 'pending'],
  ['bom/BomForm.tsx', 'pending'],
  ['craft/CraftForm.tsx', 'pending'],
  ['order/EditOrderForm.tsx', 'pending'],
  ['order/OrderChangeRequestForm.tsx', 'pending'],
  ['order/OrderExportControls.tsx', 'pending'],
  ['order/OrderForm.tsx', 'pendingState.busy'],
  ['order/ReworkOrderForm.tsx', 'pending'],
  ['order/SfCollectToggleForm.tsx', 'pending'],
  ['order/SubmitOrderButton.tsx', 'pending'],
  ['order/UrgentToggleForm.tsx', 'pending'],
  ['outsource/CreateOutsourceForm.tsx', 'pending'],
  ['outsource/OutsourceAmountForm.tsx', 'pending'],
  ['product-category/ProductCategoryForm.tsx', 'pending'],
  ['production/OperationReportForm.tsx', 'pending'],
  ['purchase/PurchaseOrderForm.tsx', 'pending'],
  ['salary/SalaryRuleSettingsForm.tsx', 'pending'],
  ['setting/SettingsForm.tsx', 'pending'],
];

describe('business pending form accessibility contract', () => {
  it.each(PENDING_FORM_CONTRACTS)(
    '%s binds its form busy state to %s',
    (relativePath, busyExpression) => {
      const source = readFileSync(
        path.join(BUSINESS_COMPONENT_ROOT, relativePath),
        'utf8',
      );
      const escapedExpression = busyExpression.replaceAll('.', '\\.');

      expect(source, relativePath).toMatch(
        new RegExp(
          `<form[\\s\\S]{0,600}?aria-busy=\\{${escapedExpression}\\}`,
        ),
      );
    },
  );

  it('discovers new action-state forms and requires pending feedback', () => {
    const failures: string[] = [];

    for (const filePath of findProductionTsxFiles(BUSINESS_COMPONENT_ROOT)) {
      const sourceText = readFileSync(filePath, 'utf8');
      if (!sourceText.includes('<form')) continue;

      const source = ts.createSourceFile(
        filePath,
        sourceText,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
      );
      if (!usesPendingReactHook(source)) continue;

      const visit = (node: ts.Node) => {
        if (
          ts.isJsxElement(node) &&
          node.openingElement.tagName.getText() === 'form' &&
          !formExposesPendingState(node)
        ) {
          const line =
            source.getLineAndCharacterOfPosition(
              node.openingElement.getStart(source),
            ).line + 1;
          failures.push(`${path.relative(ROOT, filePath)}:${line}`);
        }
        ts.forEachChild(node, visit);
      };

      visit(source);
    }

    expect(
      failures,
      `Action-state forms must expose pending state through aria-busy or PendingButton:\n${failures.join('\n')}`,
    ).toEqual([]);
  });
});

function findProductionTsxFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      return entry.name === '__tests__' ? [] : findProductionTsxFiles(entryPath);
    }
    return entry.isFile() &&
      entry.name.endsWith('.tsx') &&
      !entry.name.includes('.test.')
      ? [entryPath]
      : [];
  });
}

function usesPendingReactHook(source: ts.SourceFile): boolean {
  let found = false;
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      (node.expression.text === 'useActionState' ||
        node.expression.text === 'useTransition')
    ) {
      found = true;
      return;
    }
    if (!found) ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

function formExposesPendingState(form: ts.JsxElement): boolean {
  const hasBusyAttribute = form.openingElement.attributes.properties.some(
    (property) =>
      ts.isJsxAttribute(property) && property.name.getText() === 'aria-busy',
  );
  if (hasBusyAttribute) return true;

  let hasPendingButton = false;
  const visit = (node: ts.Node) => {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      node.tagName.getText() === 'PendingButton'
    ) {
      hasPendingButton = true;
      return;
    }
    if (!hasPendingButton) ts.forEachChild(node, visit);
  };
  form.children.forEach(visit);
  return hasPendingButton;
}
