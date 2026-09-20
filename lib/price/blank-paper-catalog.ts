import { createHash } from 'node:crypto';
import type { Prisma } from '../../generated/prisma/client';
import { writeAuditLogInTx, type AuditActor } from '../audit-log';
import { findCatalogPaperIdentityMatches } from '../order/catalog-paper-identity';
import { catalogPricingFactChoices } from '../order/catalog-pricing-facts';
import { setProductActiveInTx } from '../product';
import { isRetiredPaper, RETIRED_PAPER_MESSAGE } from '../rules/paper-availability';
import { isRetiredProductCategory } from '../rules/retired-catalog';
import { BLANK_SPECIFICATIONS, blankPaperFact, type AddBlankPaperInput } from './blank-paper';
import { classifyBlankPaperCell } from './blank-paper-cell';
import { canonicalizeCreateOrderPaperFact } from './create-order/canonical-facts';

export class BlankPaperCatalogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BlankPaperCatalogError';
  }
}

/** Call only within the caller's price snapshot write lock. Includes inactive rows. */
export async function readBlankPaperCatalogInTx(tx: Prisma.TransactionClient) {
  const papers = await tx.material.findMany({ where: { category: 'PAPER' } });
  const products = await tx.product.findMany({
    where: { category: 'BLANK_STOCK' }, include: { categoryNode: true },
  });
  const active = products.filter((product) => product.isActive);
  const nodeIds = new Set(active.map((product) => product.categoryNodeId));
  if (nodeIds.size !== 1 || active.some((product) =>
    !product.categoryNode.isActive || isRetiredProductCategory(product.categoryNode))) {
    throw new BlankPaperCatalogError('请先确定新产品的分类归属，再启用空白封规格');
  }
  return { papers, products, categoryNodeId: active[0]!.categoryNodeId };
}

type BlankPaperCatalog = Awaited<ReturnType<typeof readBlankPaperCatalogInTx>>;

/** Only the draft/new-paper path passes mode=new. Enabling specifications never creates paper. */
export async function resolveBlankPaperInTx(
  tx: Prisma.TransactionClient,
  input: AddBlankPaperInput['paper'],
  catalog: BlankPaperCatalog,
  actor: AuditActor,
) {
  const selected = input.mode === 'existing' ? catalog.papers.find((paper) => paper.id === input.id) : null;
  const fact = input.mode === 'new'
    ? canonicalizeCreateOrderPaperFact(input.name, input.weight)
    : selected ? blankPaperFact(selected) : null;
  if (!fact || fact.paperWeightGsm > 2000) {
    throw new BlankPaperCatalogError('纸张名称或克重不完整，请先完善纸张资料');
  }
  const label = `${fact.paperWeightGsm}g${fact.paperType}`;
  const matches = findCatalogPaperIdentityMatches(catalog.papers, {
    name: label, specification: `${fact.paperWeightGsm}g`,
  });
  if (matches.length > 1) {
    throw new BlankPaperCatalogError('同名同克重纸张存在重复记录，请先在纸张管理中处理');
  }
  let paper = selected ?? matches[0];
  if (input.mode === 'existing' && (!selected || matches[0]?.id !== selected.id)) {
    throw new BlankPaperCatalogError('纸张资料已变化，请刷新后重新选择');
  }
  if (catalogPricingFactChoices(paper?.name ?? (input.mode === 'new' ? input.name : '')).length !== 1) {
    throw new BlankPaperCatalogError('纸张名称包含多个纸张，请先在纸张管理中处理');
  }
  if (isRetiredPaper({ weight: fact.paperWeightGsm }) || (paper && isRetiredPaper(paper))) {
    throw new BlankPaperCatalogError(RETIRED_PAPER_MESSAGE);
  }
  if (paper && (!paper.isActive || paper.outOfStock)) {
    throw new BlankPaperCatalogError('纸张已停用或缺货，请先在纸张管理中处理');
  }
  const hash = createHash('sha256').update(label).digest('hex').slice(0, 20);
  if (!paper) {
    paper = await tx.material.create({ data: {
      code: `PAPER-${hash}`, name: label, specification: `${fact.paperWeightGsm}g`, category: 'PAPER', unit: '张',
    } });
    await writeAuditLogInTx(tx, {
      actor, action: 'CREATE', entityType: 'Material', entityId: paper.id, before: null, after: paper,
    });
    catalog.papers.push(paper);
  }
  return { paper, fact, label, hash };
}

type ResolvedBlankPaper = Awaited<ReturnType<typeof resolveBlankPaperInTx>>;

/** Draft preserves its legacy FK fill but cannot reactivate; enable never fills legacy FKs. */
export async function ensureBlankPaperProductInTx(
  tx: Prisma.TransactionClient,
  catalog: BlankPaperCatalog,
  resolved: ResolvedBlankPaper,
  spec: (typeof BLANK_SPECIFICATIONS)[number],
  mode: 'draft' | 'enable',
  actor: AuditActor,
) {
  const { paper, fact, label, hash } = resolved;
  const cell = classifyBlankPaperCell(catalog.products, paper, spec.key);
  if (cell.state === 'retired') throw new BlankPaperCatalogError(RETIRED_PAPER_MESSAGE);
  if (cell.state === 'needs-attention') {
    if (cell.reason === 'identity-conflict') {
      throw new BlankPaperCatalogError(`${spec.label}纸张关联不一致或计价事实冲突，请先检查产品组合`);
    }
    throw new BlankPaperCatalogError(`${spec.label}存在重复或异常产品组合，请先检查产品组合`);
  }
  let product = cell.selected;
  if (product && (!product.categoryNode.isActive || isRetiredProductCategory(product.categoryNode))) {
    throw new BlankPaperCatalogError(`${spec.label}产品分类已停用或退役，请先检查产品组合`);
  }
  if (cell.state === 'inactive') {
    if (mode === 'draft') throw new BlankPaperCatalogError(`${spec.label}产品组合已停用，请先到纸张页启用`);
    await setProductActiveInTx(tx, product!.id, true, { actor, reason: null });
    product = { ...product!, isActive: true };
  }
  if (!product) {
    try {
      product = await tx.product.create({
        data: {
          code: `BLANK-${hash}-${spec.key}`, name: `${label} ${spec.label}`,
          category: 'BLANK_STOCK', categoryNodeId: catalog.categoryNodeId, paperMaterialId: paper.id,
          paperType: label, weight: fact.paperWeightGsm, specification: spec.specification,
        },
        include: { categoryNode: true },
      });
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') {
        throw new BlankPaperCatalogError('产品编码与已有组合冲突，请先到产品组合页检查');
      }
      throw error;
    }
    await writeAuditLogInTx(tx, {
      actor, action: 'CREATE', entityType: 'Product', entityId: product.id, before: null, after: product,
    });
    catalog.products.push(product);
  }
  if (mode === 'draft' && !product.paperMaterialId) {
    const before = product;
    product = await tx.product.update({
      where: { id: product.id }, data: { paperMaterialId: paper.id }, include: { categoryNode: true },
    });
    await writeAuditLogInTx(tx, {
      actor, action: 'LINK_PAPER', entityType: 'Product', entityId: product.id, before, after: product,
    });
  }
  return product;
}
