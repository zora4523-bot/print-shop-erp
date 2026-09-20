import 'server-only';
import { db } from '@/lib/db';
import { listExternalCreateOrderProductOptions, isRetiredProductCategory } from '@/lib/product';
import { listExternalCreateOrderPaperOptions } from '@/lib/material';
import { readPublishedCreateOrderPriceSnapshot, PublishedCreateOrderPriceAdapterError } from '@/lib/order/create-order-published-rule-adapter';
import { ExternalCreateOrderPriceSnapshotError } from '@/lib/order/create-order-price-snapshot';
import { buildPaperSpecificationView } from './paper-specification-view';
import { acquirePriceRuleSnapshotReadLock } from './rule-snapshot-lock';

export async function readPaperSpecifications(paperId: string) {
  return db.$transaction(async (tx) => {
    await acquirePriceRuleSnapshotReadLock(tx);
    const [papers, products, selectableProducts, selectablePapers] = await Promise.all([
      tx.material.findMany({ where: { category: 'PAPER' } }),
      tx.product.findMany({ where: { category: 'BLANK_STOCK' }, include: { categoryNode: true } }),
      listExternalCreateOrderProductOptions(tx), listExternalCreateOrderPaperOptions(tx),
    ]);
    const paper = papers.find((paper) => paper.id === paperId);
    if (!paper) return null;
    const active = products.filter((product) => product.isActive);
    const nodeReady = new Set(active.map((product) => product.categoryNodeId)).size === 1 &&
      active.every((product) => product.categoryNode.isActive && !isRetiredProductCategory(product.categoryNode));
    const snapshot = await readPublishedCreateOrderPriceSnapshot(tx, { snapshotLockHeld: true }).catch((error: unknown) => {
      if (error instanceof PublishedCreateOrderPriceAdapterError || error instanceof ExternalCreateOrderPriceSnapshotError) return null;
      throw error;
    });
    return buildPaperSpecificationView({ paper, papers, products, selectableProducts, selectablePapers, snapshot, nodeReady });
  });
}
