import 'server-only';
import { listExternalCreateOrderOptions } from './create-order-options';
import type { OrderChangeCatalogProduct } from './change-request-catalog-identity';

export async function listActiveOrderChangeCatalogProducts(): Promise<
  OrderChangeCatalogProduct[]
> {
  const { products, papers } = await listExternalCreateOrderOptions();
  const paperById = new Map(papers.map((paper) => [paper.id, paper]));
  return products.map((product) => {
    const paper = product.paperMaterialId
      ? paperById.get(product.paperMaterialId)
      : null;
    return {
      id: product.id,
      selectionKey: product.selectionKey,
      source: product.source,
      category: product.category,
      specification: product.specification,
      paperType: product.paperType,
      weight: product.weight,
      // The source query includes only active products whose category node is
      // active. Keep the explicit bit in the client DTO so the shared resolver
      // remains fail-closed for every other caller.
      isActive: true,
      paperMaterialId: product.paperMaterialId,
      linkedPaper: paper
        ? { isActive: true, outOfStock: paper.outOfStock }
        : null,
    };
  });
}
