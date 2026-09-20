import { catalogPaperIdentityKeys } from '@/lib/order/catalog-paper-identity';
import { inspectBlankCellProduct, paperPricingIdentityKey, type BlankCellProduct, type BlankPaperIdentity } from './blank-paper-cell';

export function unassignedPaperProducts<T extends BlankCellProduct>(products: readonly T[], papers: readonly BlankPaperIdentity[]): T[] {
  const identities = new Set(papers.flatMap((paper) => [...catalogPaperIdentityKeys(paper)]));
  return products.filter((product) => product.isActive &&
    (product.category === 'BLANK_STOCK' || product.category === 'COLOR_PRINT') &&
    !inspectBlankCellProduct(product).facts.some((fact) => identities.has(paperPricingIdentityKey(fact))));
}
