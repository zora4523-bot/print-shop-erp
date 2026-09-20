import 'server-only';
import { db } from '../db';
import type { AuditActor } from '../audit-log';
import { BLANK_SPECIFICATIONS, enableBlankSpecificationsSchema, type EnableBlankSpecificationsInput } from './blank-paper';
import { ensureBlankPaperProductInTx, readBlankPaperCatalogInTx, resolveBlankPaperInTx } from './blank-paper-catalog';
import { acquirePriceRuleSnapshotWriteLock } from './rule-snapshot-lock';

/** Incremental enablement only. No price-book or rule mutation, even when a cell has no price. */
export async function enableBlankSpecifications(raw: EnableBlankSpecificationsInput, actor: AuditActor) {
  const input = enableBlankSpecificationsSchema.parse(raw);
  return db.$transaction(async (tx) => {
    await acquirePriceRuleSnapshotWriteLock(tx);
    const catalog = await readBlankPaperCatalogInTx(tx);
    const resolved = await resolveBlankPaperInTx(tx, { mode: 'existing', id: input.paperId }, catalog, actor);
    const productIds: string[] = [];
    for (const key of input.specifications) {
      const spec = BLANK_SPECIFICATIONS.find((spec) => spec.key === key)!;
      const product = await ensureBlankPaperProductInTx(tx, catalog, resolved, spec, 'enable', actor);
      productIds.push(product.id);
    }
    return { paperId: resolved.paper.id, productIds };
  });
}
