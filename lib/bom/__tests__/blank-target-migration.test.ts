import { describe, expect, it } from 'vitest';
import { planBlankBomMigration, type BlankBomMigrationInput, type MigrationBom } from '../blank-target-migration';
const source: MigrationBom = { id: 'bom', productId: 'product', categoryNodeId: null,
  blankPaperMaterialId: null, blankSpecificationKey: null, name: '用料', version: 3, baseQuantity: 1000, isActive: true,
  items: [{ materialId: 'consumable', quantity: '12.3456', sortOrder: 10, remark: '保留备注' }] };
function fixture(): BlankBomMigrationInput {
  return { papers: [{ id: 'paper', name: '红卡', specification: '180g' }],
    products: [{ id: 'product', paperMaterialId: 'paper', paperType: '180g红卡', weight: 180, specification: '中号封80×115', categoryNodeId: 'node' }],
    boms: [source], nodes: [{ id: 'node', isActive: true, legacyCategory: 'BLANK_STOCK' }], existingSetting: undefined, migratedTargetIds: [] };
}
describe('blank BOM deterministic migration', () => {
  it('copies a unique product source preserving version, base, quantity and original source', () => {
    const input = fixture();
    const plan = planBlankBomMigration(input);
    expect(plan.ready).toBe(true);
    expect(plan.copies).toHaveLength(1);
    expect(plan.copies[0]).toMatchObject({ paperId: 'paper', specificationKey: 'mid', source });
    expect(plan.defaultCategoryId).toBeNull();
    expect(planBlankBomMigration(input)).toEqual(plan);
  });
  it('is repeatable and never overwrites migrated target changes', () => {
    const input = fixture();
    const copy = planBlankBomMigration(input).copies[0]!;
    input.boms.push({ ...source, id: copy.id, productId: null, blankPaperMaterialId: 'paper', blankSpecificationKey: 'mid', baseQuantity: 2000 });
    input.migratedTargetIds = [copy.id];
    const plan = planBlankBomMigration(input);
    expect(plan.ready).toBe(true);
    expect(plan.copies).toEqual([]);
    expect(plan.preserved).toEqual([copy.id]);
  });
  it('rejects duplicate source products even when numeric usage happens to agree', () => {
    const input = fixture();
    input.products.push({ ...input.products[0]!, id: 'other' });
    input.boms.push({ ...source, id: 'other-bom', productId: 'other' });
    expect(planBlankBomMigration(input).issues).toEqual([expect.stringContaining('旧用料来源不唯一')]);
  });
  it('rejects target conflict without migration audit evidence', () => {
    const input = fixture();
    input.boms.push({ ...source, id: 'conflict', productId: null, blankPaperMaterialId: 'paper', blankSpecificationKey: 'mid' });
    expect(planBlankBomMigration(input).ready).toBe(false);
  });
  it('rejects missing paper, duplicate identity and conflicting FK', () => {
    const missing = fixture(); missing.papers = [];
    expect(planBlankBomMigration(missing).ready).toBe(false);
    const duplicate = fixture(); duplicate.papers.push({ ...duplicate.papers[0]!, id: 'other' });
    expect(planBlankBomMigration(duplicate).ready).toBe(false);
    const conflict = fixture(); conflict.products[0]!.paperMaterialId = 'other';
    expect(planBlankBomMigration(conflict).ready).toBe(false);
  });
  it('migrates a unique shared category through the setting without cloning the category BOM', () => {
    const input = fixture(); input.boms = [{ ...source, productId: null, categoryNodeId: 'node' }];
    const plan = planBlankBomMigration(input);
    expect(plan.ready).toBe(true);
    expect(plan.defaultCategoryId).toBe('node');
    expect(plan.copies).toEqual([]);
  });
  it('requires an explicit default with multiple category sources and copies nondefault identity', () => {
    const input = fixture();
    input.boms = [{ ...source, productId: null, categoryNodeId: 'node' }, { ...source, id: 'second-bom', productId: null, categoryNodeId: 'second' }];
    input.nodes.push({ id: 'second', isActive: true, legacyCategory: 'BLANK_STOCK' });
    input.products.push({ ...input.products[0]!, id: 'large', specification: '大号封', categoryNodeId: 'second' });
    expect(planBlankBomMigration(input).ready).toBe(false);
    input.selectedDefaultCategoryId = 'node';
    const plan = planBlankBomMigration(input);
    expect(plan.ready).toBe(true);
    expect(plan.copies).toHaveLength(1);
    expect(plan.copies[0]).toMatchObject({ specificationKey: 'large', source: { id: 'second-bom' } });
  });
  it('rejects invalid existing defaults rather than silently forgetting them', () => {
    const input = fixture(); input.existingSetting = 'missing';
    expect(planBlankBomMigration(input).ready).toBe(false);
  });
});
