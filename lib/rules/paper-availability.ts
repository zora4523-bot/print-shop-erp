import { parseCatalogPaperWeight } from '../order/catalog-pricing-facts';

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
