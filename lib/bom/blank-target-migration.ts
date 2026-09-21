import { createHash } from 'node:crypto';
import { blankSpecificationKey } from '@/lib/price/blank-paper';
import { catalogPaperIdentityKeys, findCatalogPaperIdentityMatches } from '@/lib/order/catalog-paper-identity';

export const BLANK_BOM_CATEGORY_SETTING_KEY = 'blank_stock_bom_category_node_id';
export type MigrationPaper = { id: string; name: string; specification: string | null };
export type MigrationProduct = {
  id: string; paperMaterialId: string | null; paperType: string | null; weight: number | null;
  specification: string | null; categoryNodeId: string;
};
export type MigrationBom = {
  id: string; productId: string | null; categoryNodeId: string | null;
  blankPaperMaterialId: string | null; blankSpecificationKey: string | null;
  name: string; version: number; baseQuantity: number; isActive: boolean;
  items: Array<{ materialId: string; quantity: string; sortOrder: number; remark: string | null }>;
};
export type MigrationNode = { id: string; isActive: boolean; legacyCategory: string | null };
export type BlankBomMigrationInput = {
  papers: MigrationPaper[]; products: MigrationProduct[]; boms: MigrationBom[]; nodes: MigrationNode[];
  existingSetting: unknown; selectedDefaultCategoryId?: string;
  migratedTargetIds: string[];
};
function targetId(paperId: string, specificationKey: string, sourceId: string): string {
  return `blank_bom_${createHash('sha256').update(JSON.stringify([paperId, specificationKey, sourceId])).digest('hex').slice(0, 32)}`;
}
function contents(bom: MigrationBom | undefined): string {
  return JSON.stringify(bom ? { baseQuantity: bom.baseQuantity, items: bom.items.map((item) => ({
    materialId: item.materialId, quantity: item.quantity,
  })).sort((a, b) => a.materialId.localeCompare(b.materialId)) } : null);
}

/** Deterministic copy plan only; no database and no silent winner for ambiguity. */
export function planBlankBomMigration(input: BlankBomMigrationInput) {
  const issues: string[] = [];
  const groups = new Map<string, { paperId: string; specificationKey: string; products: MigrationProduct[] }>();
  const active = input.boms.filter((bom) => bom.isActive);
  const effectiveSource = (product: MigrationProduct) => {
    const direct = active.filter((bom) => bom.productId === product.id);
    const category = active.filter((bom) => bom.categoryNodeId === product.categoryNodeId);
    if (direct.length > 1 || category.length > 1) issues.push(`产品 ${product.id} 的启用用料来源不唯一`);
    return direct[0] ?? category[0];
  };
  const categoryIds = new Set<string>();
  for (const product of input.products) {
    const source = effectiveSource(product);
    if (!source) continue;
    if (source.categoryNodeId) categoryIds.add(source.categoryNodeId);
    const identity = { name: product.paperType ?? '', specification: product.weight === null ? null : `${product.weight}g` };
    const matches = findCatalogPaperIdentityMatches(input.papers, identity);
    const spec = blankSpecificationKey(product.specification);
    if (matches.length !== 1 || !spec || catalogPaperIdentityKeys(identity).size !== 1 ||
        catalogPaperIdentityKeys(matches[0]!).size !== 1 ||
        (product.paperMaterialId !== null && product.paperMaterialId !== matches[0]!.id)) {
      issues.push(`产品 ${product.id} 的用料无法唯一映射到纸张和标准规格`);
      continue;
    }
    const paperId = matches[0]!.id;
    const key = `${paperId}:${spec}`;
    const group = groups.get(key) ?? { paperId, specificationKey: spec, products: [] };
    group.products.push(product);
    groups.set(key, group);
  }
  let defaultCategoryId: string | null = input.selectedDefaultCategoryId ?? null;
  if (input.existingSetting !== undefined && input.existingSetting !== null) {
    if (typeof input.existingSetting !== 'string') issues.push('默认用料分类配置格式无效');
    else if (defaultCategoryId && defaultCategoryId !== input.existingSetting) issues.push('显式默认分类与已有配置冲突，不能自动覆盖');
    else defaultCategoryId = input.existingSetting;
  }
  if (!defaultCategoryId && categoryIds.size === 1) defaultCategoryId = [...categoryIds][0]!;
  if (!defaultCategoryId && categoryIds.size > 1) issues.push('存在多个分类用料来源，请显式选择未来新增纸张规格的默认用料分类');
  if (defaultCategoryId && !input.nodes.some((node) => node.id === defaultCategoryId && node.isActive && node.legacyCategory === 'BLANK_STOCK')) {
    issues.push('默认用料分类不存在、已停用或不是空白封分类');
  }
  if (defaultCategoryId && active.some((bom) => bom.categoryNodeId === defaultCategoryId)) {
    for (const product of input.products) {
      if (!effectiveSource(product) && blankSpecificationKey(product.specification) &&
          findCatalogPaperIdentityMatches(input.papers, { name: product.paperType ?? '', specification: product.weight === null ? null : `${product.weight}g` }).length === 1) {
        issues.push(`产品 ${product.id} 原未配置用料，默认分类会引入新增用量，不能自动迁移`);
      }
    }
  }
  const copies: Array<{ id: string; paperId: string; specificationKey: string; source: MigrationBom; productIds: string[] }> = [];
  const preserved: string[] = [];
  for (const group of [...groups.values()].sort((a, b) => `${a.paperId}:${a.specificationKey}`.localeCompare(`${b.paperId}:${b.specificationKey}`))) {
    // Include products without effective BOM for this same identity: inheriting a
    // different product's BOM would otherwise silently introduce material use.
    const equivalentProducts = input.products.filter((product) =>
      blankSpecificationKey(product.specification) === group.specificationKey &&
      findCatalogPaperIdentityMatches(input.papers, { name: product.paperType ?? '', specification: product.weight === null ? null : `${product.weight}g` })
        .some((paper) => paper.id === group.paperId));
    const sources = equivalentProducts.map(effectiveSource);
    const sourceIds = new Set(sources.map((source) => source?.id ?? null));
    if (sourceIds.size !== 1 || !sources[0]) {
      issues.push(`纸张 ${group.paperId} / ${group.specificationKey} 的旧用料来源不唯一`);
      continue;
    }
    const source = sources[0];
    if (!source.items.length || source.baseQuantity <= 0) {
      issues.push(`用料清单 ${source.id} 缺有效明细或基数`);
      continue;
    }
    // Category fallback remains shared when it is the selected global default.
    if (source.categoryNodeId === defaultCategoryId && source.productId === null) continue;
    const id = targetId(group.paperId, group.specificationKey, source.id);
    const existing = input.boms.filter((bom) => bom.blankPaperMaterialId === group.paperId && bom.blankSpecificationKey === group.specificationKey);
    const alreadyMigrated = existing.find((bom) => bom.id === id && input.migratedTargetIds.includes(id));
    if (alreadyMigrated) { preserved.push(id); continue; }
    if (existing.some((bom) => bom.isActive || bom.version === source.version)) {
      issues.push(`纸张 ${group.paperId} / ${group.specificationKey} 已有目标用料，不能覆盖`);
      continue;
    }
    copies.push({ id, paperId: group.paperId, specificationKey: group.specificationKey, source,
      productIds: equivalentProducts.map((product) => product.id).sort() });
  }
  return {
    ready: issues.length === 0, issues, defaultCategoryId,
    categorySourceIds: [...categoryIds].sort(), copies, preserved,
    equivalence: copies.map((copy) => ({ targetId: copy.id, sourceId: copy.source.id, fingerprint: contents(copy.source) })),
  };
}
