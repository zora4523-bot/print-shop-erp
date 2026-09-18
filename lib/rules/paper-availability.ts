import { parseCatalogPaperWeight } from '../order/catalog-pricing-facts';

export const RETIRED_PAPER_MESSAGE = '120g 纸张已停用，请选择其他克重';

/**
 * New-business entry gate (create, quote preview, proof submit, workbench).
 * Never call this from the shared quote adapter: change requests and
 * cancellation settlement must keep repricing orders created before the
 * retirement.
 */
export function hasRetiredPaperItem(
  items: readonly { paperType?: string | null; paperWeightGsm?: number | null }[],
): boolean {
  return items.some((item) => isRetiredPaper({ weight: item.paperWeightGsm, paperType: item.paperType }));
}

/** New business availability only; never use this to rewrite historical prices. */
export function isRetiredPaper(paper: {
  weight?: number | null;
  paperType?: string | null;
  name?: string | null;
  specification?: string | null;
}): boolean {
  return paper.weight === 120 || [paper.paperType, paper.name, paper.specification]
    .some((label) => parseCatalogPaperWeight(label) === 120);
}
