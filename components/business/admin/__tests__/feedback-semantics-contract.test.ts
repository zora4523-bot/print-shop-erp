import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();

const STATIC_PREREQUISITES: ReadonlyArray<
  readonly [relativePath: string, copy: string]
> = [
  ['bom/BomForm.tsx', '暂无可用报价 SKU，请先创建并启用。'],
  ['bom/BomForm.tsx', '暂无可用物料，请先创建并启用至少一种物料。'],
  [
    'purchase/PurchaseOrderForm.tsx',
    '只有启用的“供应商”或“客户/供应商”主数据可用于采购。',
  ],
  ['purchase/PurchaseOrderForm.tsx', '请先创建并启用至少一种物料。'],
  ['price/PriceTierForm.tsx', '请先创建并启用报价 SKU。'],
  [
    'salary/StartCsPeriodForm.tsx',
    '暂无启用的客服账号，请先在用户管理中创建或启用客服。',
  ],
];

const SUCCESS_FEEDBACK: ReadonlyArray<
  readonly [relativePath: string, copy: string]
> = [
  ['salary/AddSalaryAdjustmentForm.tsx', '调整已记账。'],
  ['salary/SalaryRuleSettingsForm.tsx', '工资规则新版本已保存。'],
  ['salary/WorkerMachineRuleForm.tsx', '规则版本已生效。'],
];

describe('business feedback semantics', () => {
  it.each(STATIC_PREREQUISITES)(
    '%s does not assertively announce the static prerequisite “%s”',
    (relativePath, copy) => {
      const { source, opening } = findFeedbackContainer(relativePath, copy);

      expect(
        jsxAttribute(opening, 'role'),
        `${relativePath}:${lineOf(source, opening)} is present on initial render`,
      ).not.toBe('alert');
    },
  );

  it.each(SUCCESS_FEEDBACK)(
    '%s exposes “%s” through a polite live region',
    (relativePath, copy) => {
      const { source, opening } = findFeedbackContainer(relativePath, copy);
      const isSharedSuccessMessage =
        opening.tagName.getText() === 'FormMessage' &&
        jsxAttribute(opening, 'tone') === 'success';
      const isNativeStatus = jsxAttribute(opening, 'role') === 'status';

      expect(
        isSharedSuccessMessage || isNativeStatus,
        `${relativePath}:${lineOf(source, opening)} must announce successful completion`,
      ).toBe(true);
    },
  );
});

function findFeedbackContainer(relativePath: string, copy: string) {
  const filePath = path.join(ROOT, 'components', 'business', relativePath);
  const source = ts.createSourceFile(
    filePath,
    readFileSync(filePath, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let opening: ts.JsxOpeningLikeElement | undefined;

  const visit = (node: ts.Node) => {
    const containsCopy =
      (ts.isJsxText(node) && node.getText(source).includes(copy)) ||
      ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
        node.text.includes(copy));
    if (containsCopy) {
      let container: ts.Node | undefined = node.parent;
      while (container && !ts.isJsxElement(container)) {
        container = container.parent;
      }
      if (container) opening = container.openingElement;
    }
    if (!opening) ts.forEachChild(node, visit);
  };
  visit(source);

  expect(opening, `${relativePath} must render “${copy}”`).toBeDefined();
  return { source, opening: opening! };
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

function lineOf(source: ts.SourceFile, node: ts.Node): number {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}
