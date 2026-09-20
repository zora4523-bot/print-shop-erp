import { createHash } from 'node:crypto';
import type { Material, Prisma } from '../../generated/prisma/client';
import { writeAuditLogInTx, type AuditActor } from '../audit-log';
import { findCatalogPaperIdentityMatches } from '../order/catalog-paper-identity';
import { catalogPricingFactChoices } from '../order/catalog-pricing-facts';
import { isRetiredPaper, RETIRED_PAPER_MESSAGE } from '../rules/paper-availability';
import { blankPaperFact, type AddBlankPaperInput } from './blank-paper';
import { canonicalizeCreateOrderPaperFact } from './create-order/canonical-facts';

export class BlankPaperCatalogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BlankPaperCatalogError';
  }
}

/** Resolve or create paper metadata within the caller’s price write lock. */
export async function resolveBlankPaperInTx(
  tx: Prisma.TransactionClient,
  input: AddBlankPaperInput['paper'],
  catalog: { papers: Material[] },
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
  if (paper) {
    const existingFact = blankPaperFact(paper);
    if (!existingFact || existingFact.paperType !== fact.paperType || existingFact.paperWeightGsm !== fact.paperWeightGsm) {
      throw new BlankPaperCatalogError('纸张身份存在歧义，请先在纸张管理中处理');
    }
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
