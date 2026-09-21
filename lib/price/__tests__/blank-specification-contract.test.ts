import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { BLANK_SPECIFICATIONS, blankSpecificationKey } from '../blank-paper';
import { canonicalizeCreateOrderPaperFact, canonicalizeCreateOrderSpecification } from '../create-order/canonical-facts';
import { resolveOrderChangeCatalogIdentity } from '../../order/change-request-catalog-identity';
import { OrderItemPricingRoute } from '../../../generated/prisma/enums';

// These are deliberately private production declarations. Execute their actual AST text
// without importing the database/UI trees or adding production exports just for tests.
function privateDeclaration(file: string, name: string): unknown {
  const source = ts.createSourceFile(file, readFileSync(resolve(file), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let declaration: ts.Node | undefined;
  const visit = (node: ts.Node) => {
    if ((ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node)) && node.name?.getText(source) === name) declaration = node;
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (!declaration) throw new Error(`Missing contract declaration ${file}:${name}`);
  const node = declaration as ts.FunctionDeclaration | ts.VariableDeclaration;
  const code = ts.isFunctionDeclaration(node) ? node.getText(source) : `const ${node.getText(source)};`;
  return runInNewContext(ts.transpileModule(`${code}\n${name};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText, {
    fail: () => { throw new Error('unsupported'); },
    invalidRule: () => { throw new Error('unsupported'); },
  });
}

const specifications = [
  ['mini', '迷你封50×80', '迷你封', 'MID'],
  ['square', '方形88×88', '方形封', 'MID'],
  ['mid', '中号封80×115', '中号封', 'MID'],
  ['large', '大号封90×165', '大号封', 'LARGE'],
  ['west-mid', '西封中号80×120', '西封中号', 'MID'],
  ['west-large', '西封大号85×165', '西封大号', 'LARGE'],
] as const;

describe('PLAN S6 seven specification definitions', () => {
  it.each([
    ['迷你', '迷你封'], ['迷你封', '迷你封'], ['方形', '方形封'], ['方形封', '方形封'],
    ['中号', '中号封'], ['中号封', '中号封'], ['大号', '大号封'], ['大号封', '大号封'],
    ['西封中号', '西封中号'], ['西封大号', '西封大号'], ['万元封', '万元封'],
  ])('locks canonical alias %s (definition 1)', (alias, expected) => {
    expect(canonicalizeCreateOrderSpecification(alias)).toBe(expected);
  });
  it('locks the six exact catalog strings and the customer price matrix keys (definitions 5, 7)', () => {
    expect(BLANK_SPECIFICATIONS.map(({ key, specification }) => [key, specification]))
      .toEqual(specifications.map(([key, specification]) => [key, specification]));
    const columns = privateDeclaration('components/business/rules/pricing/CustomerPricingDedicatedSection.tsx', 'BLANK_COLUMNS') as { key: string }[];
    expect(columns.map((column) => column.key)).toEqual(BLANK_SPECIFICATIONS.map((spec) => spec.key));
  });
  it.each([...specifications, ['money', '万元封90×165', '万元封', 'MID']] as const)(
    '%s canonical text, item group and change-request group agree (definitions 1, 2, 6)', (key, raw, canonical, group) => {
      expect(canonicalizeCreateOrderSpecification(raw)).toBe(canonical);
      if (key !== 'money') expect(blankSpecificationKey(raw)).toBe(key);
      const itemGroup = privateDeclaration('lib/order/create-order-quote-facts-adapter.ts', 'pricingGroup') as (spec: string, key: string) => string;
      expect(itemGroup(canonical, 'item')).toBe(group);
      const result = resolveOrderChangeCatalogIdentity({
        sourceItem: { pricingRoute: OrderItemPricingRoute.STOCK_BLANK, paperType: '160g红卡', paperWeightGsm: 160 },
        targetProductId: 'product', targetSpecification: raw,
        products: [{ id: 'product', category: 'BLANK_STOCK', specification: raw, paperType: '160g红卡',
          weight: 160, paperMaterialId: null, linkedPaper: null, isActive: true }],
      });
      expect(result).toMatchObject({ canonicalSpecification: canonical, pricingGroup: group });
    },
  );
  it('published custom rules accept exactly five specs; mini and money remain item-side only (definitions 3, 4)', () => {
    const file = 'lib/order/create-order-published-rule-adapter.ts';
    const required = privateDeclaration(file, 'REQUIRED_FULL_SPECIFICATIONS') as Set<string>;
    expect([...required].sort()).toEqual(specifications.filter(([key]) => key !== 'mini').map(([, , canonical]) => canonical).sort());
    const ruleGroup = privateDeclaration(file, 'pricingGroupForSpecification') as (spec: string, rule: object) => string;
    for (const [key, , canonical, group] of specifications) {
      if (key !== 'mini') expect(ruleGroup(canonical, {})).toBe(group);
    }
    for (const unsupported of ['迷你封', '万元封', '未定义']) expect(() => ruleGroup(unsupported, {})).toThrow('unsupported');
  });
  it.each(specifications)('%s product facts and triggerCondition canonical keys agree', (_, raw, canonical) => {
    const product = { paperType: '160g 红卡', weight: 160, specification: raw };
    const triggerCondition = { paperTypes: ['160g红卡'], specifications: [canonical] };
    expect(canonicalizeCreateOrderPaperFact(product.paperType, product.weight))
      .toEqual(canonicalizeCreateOrderPaperFact(triggerCondition.paperTypes[0]!));
    expect(canonicalizeCreateOrderSpecification(product.specification))
      .toBe(canonicalizeCreateOrderSpecification(triggerCondition.specifications[0]!));
  });
  it('keeps route dimensions in catalog strings while aliases share text keys', () => {
    for (const [color, blank] of [['中号封80×120', '中号封80×115'], ['大号封88×165', '大号封90×165']]) {
      expect(canonicalizeCreateOrderSpecification(color!)).toBe(canonicalizeCreateOrderSpecification(blank!));
      expect(color).not.toBe(blank);
    }
  });
});
