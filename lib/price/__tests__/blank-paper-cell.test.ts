import { describe, expect, it } from 'vitest';
import { ProductCategory } from '../../../generated/prisma/enums';
import { classifyBlankPaperCell, inspectBlankCellProduct, type BlankCellProduct } from '../blank-paper-cell';

const paper = { id: 'paper', name: '红卡', specification: '160g' };
function product(id: string, changes: Partial<BlankCellProduct> = {}): BlankCellProduct {
  return { id, category: ProductCategory.BLANK_STOCK, specification: '中号封80×115',
    paperType: '160g红卡', weight: 160, paperMaterialId: null, isActive: true, ...changes };
}
const classify = (rows: BlankCellProduct[]) => classifyBlankPaperCell(rows, paper, 'mid');

describe('PLAN S2 two-stage cell classification', () => {
  it.each([
    ['wrong foreign key', { paperMaterialId: 'other' }],
    ['weight conflict', { weight: 180 }],
    ['foreign key/text mismatch', { paperMaterialId: 'paper', paperType: '160g冰白纸' }],
    ['missing linked text', { paperMaterialId: 'paper', paperType: null }],
  ] as const)('row 1: %s blocks even when inactive and alongside a legal active row', (_, changes) => {
    for (const isActive of [true, false]) {
      const result = classify([product('good'), product('bad', { ...changes, isActive })]);
      expect(result).toMatchObject({ state: 'needs-attention', reason: 'identity-conflict', selected: null });
      expect(result.conflicts.map((row) => row.id)).toEqual(['bad']);
    }
  });
  it.each(['中号封', '中号封80x115', '中号封80×120', ' 中号封80×115 ', '中号封80×115 / 大号封90×165'])(
    'row 2: active non-exact %s beats legal candidates', (specification) => {
      expect(classify([product('good'), product('bad', { specification })])).toMatchObject({
        state: 'needs-attention', reason: 'active-non-exact', selected: null,
      });
    },
  );
  it('multi-value paper text touches each paper cell but is never a candidate', () => {
    const row = product('multi', { paperType: '160g红卡 ／ 160g冰白纸' });
    for (const name of ['红卡', '冰白纸']) {
      expect(classifyBlankPaperCell([row], { ...paper, name }, 'mid')).toMatchObject({
        state: 'needs-attention', reason: 'active-non-exact', candidates: [],
      });
    }
    expect(classify([{ ...row, isActive: false }]).state).toBe('unconfigured');
  });
  it('row 3: one active wins over multiple inactive candidates independent of order', () => {
    const rows = [product('off1', { isActive: false }), product('on'), product('off2', { isActive: false })];
    for (const ordered of [rows, [...rows].reverse()]) {
      expect(classify(ordered)).toMatchObject({ state: 'enabled', selected: { id: 'on' } });
      expect(classify(ordered).inactive).toHaveLength(2);
    }
  });
  it.each([true, false])('row 4: multiple legal candidates, active=%s', (isActive) => {
    expect(classify([product('a', { isActive }), product('b', { isActive })])).toMatchObject({
      state: 'needs-attention', reason: 'multiple-candidates', selected: null,
    });
  });
  it('row 5: exactly one inactive legal candidate may be re-enabled', () => {
    expect(classify([product('off', { isActive: false })])).toMatchObject({ state: 'inactive', selected: { id: 'off' } });
  });
  it('row 6: empty or unrelated rows leave the cell unconfigured', () => {
    expect(classify([]).state).toBe('unconfigured');
    expect(classify([product('color', { category: ProductCategory.COLOR_PRINT }),
      product('large', { specification: '大号封90×165' }),
      product('paper', { paperType: '160g冰白纸' })]).rows).toEqual([]);
  });
  it.each(['中号封', '中号封80x115', '中号封80×120', '中号封80×115 / 大号封90×165'])(
    'inactive non-exact %s never becomes an inactive candidate or blocks creation', (specification) => {
      const row = product('old', { specification, isActive: false });
      expect(classify([row])).toMatchObject({ state: 'unconfigured', candidates: [] });
      expect(classify([row, product('on')]).state).toBe('enabled');
      expect(classify([row, product('off', { isActive: false })]).state).toBe('inactive');
    },
  );
  it('conflict priority beats active non-exact and duplicate candidates', () => {
    expect(classify([product('a'), product('b'), product('alias', { specification: '中号封' }),
      product('conflict', { paperMaterialId: 'elsewhere', isActive: false })]).reason).toBe('identity-conflict');
  });
  it('120g is separate even with no product; retained 120g products cannot be enabled', () => {
    const retiredPaper = { ...paper, specification: '120g' };
    expect(classifyBlankPaperCell([], retiredPaper, 'mid').state).toBe('retired');
    const row = product('retired', { paperType: '120g红卡', weight: 120 });
    expect(classifyBlankPaperCell([row], retiredPaper, 'mid').state).toBe('retired');
    expect(inspectBlankCellProduct(row).retired).toBe(true);
    expect(classify([product('mismatch', { paperMaterialId: paper.id, weight: 120 })]).reason).toBe('identity-conflict');
  });
  it('distinguishes normalization-only aliases from wrong dimensions and reports parse failures', () => {
    expect(inspectBlankCellProduct(product('x', { specification: ' 中号封 80x115 ' })))
      .toMatchObject({ exactSpecification: false, normalizedSpecification: true });
    expect(inspectBlankCellProduct(product('x', { specification: '中号封80×120' })))
      .toMatchObject({ exactSpecification: false, normalizedSpecification: false });
    expect(inspectBlankCellProduct(product('x', { paperType: '红卡', weight: null, specification: '未知' })))
      .toMatchObject({ weightUnparseable: true, specificationUnparseable: true });
  });
});
