import { isRetiredProductCategory } from '@/lib/rules/retired-catalog';
import { OrderItemPricingRoute } from '@/generated/prisma/enums';
import { buildExternalOrderPapers, externalOrderWeightOptionsForSelection, type ExternalOrderCatalogProduct, type ExternalOrderPaperMaterial } from '@/lib/order/order-item-catalog';
import { catalogPricingFactChoices, normalizeCatalogPricingText } from '@/lib/order/catalog-pricing-facts';
import { findCatalogPaperIdentityMatches } from '@/lib/order/catalog-paper-identity';
import { isRetiredPaper } from '@/lib/rules/paper-availability';
import { BLANK_SPECIFICATIONS, blankPaperFact } from './blank-paper';
import { classifyBlankPaperCell, type BlankCellProduct, type BlankPaperIdentity } from './blank-paper-cell';
import { selectPartialUnitPrice } from './create-order/selectors';
import { canonicalizeCreateOrderSpecification } from './create-order/canonical-facts';
import type { CreateOrderPriceSnapshot } from './create-order/types';

type Paper = BlankPaperIdentity & { isActive: boolean; outOfStock: boolean };
export function buildPaperSpecificationView(input: {
  paper: Paper; papers: readonly Paper[]; products: readonly (BlankCellProduct & { categoryNode: { isActive: boolean; path: string; legacyCategory: BlankCellProduct['category'] } })[];
  selectableProducts: readonly ExternalOrderCatalogProduct[];
  selectablePapers: readonly ExternalOrderPaperMaterial[];
  snapshot: CreateOrderPriceSnapshot | null; nodeReady: boolean;
}) {
  const { paper, snapshot } = input;
  const fact = blankPaperFact(paper);
  const blocked = !fact || fact.paperWeightGsm > 2000 ? '请先完善纸张名称与克重'
    : isRetiredPaper(paper) ? '该纸张已退役'
    : findCatalogPaperIdentityMatches(input.papers, paper).length !== 1 ? '纸张身份重复，请先检查纸张资料'
    : catalogPricingFactChoices(paper.name).length !== 1 ? '纸张名称包含多个纸张，请先处理'
    : !paper.isActive || paper.outOfStock ? '纸张已停用或缺货'
    : !input.nodeReady ? '请先确定新产品的分类归属' : null;
  const catalog = buildExternalOrderPapers(input.selectableProducts, input.selectablePapers);
  const catalogPaper = fact ? catalog.find((paper) => paper.key === normalizeCatalogPricingText(fact.paperType)) : null;
  const policy = snapshot?.orderCharges.logisticsPolicy;
  const logisticsConfigured = fact && policy?.billableWeightInput === 'SERVER_ESTIMATE_WITH_ACTUAL_OVERRIDE'
    ? policy.gramsPerItemByPaperWeightGsm[String(fact.paperWeightGsm)] !== undefined : false;
  const cells = BLANK_SPECIFICATIONS.map((spec) => {
    const cell = classifyBlankPaperCell(input.products, paper, spec.key);
    const invalidNode = cell.selected && (!cell.selected.categoryNode.isActive || isRetiredProductCategory(cell.selected.categoryNode));
    const option = catalogPaper && fact ? externalOrderWeightOptionsForSelection(
      catalogPaper, OrderItemPricingRoute.STOCK_BLANK, spec.specification,
    ).find((option) => option.value === fact.paperWeightGsm) : undefined;
    const selectedInCatalog = cell.selected && input.selectableProducts.some((product) => product.id === cell.selected?.id);
    const rate = snapshot && fact ? selectPartialUnitPrice({
      itemKey: 'preview', fig: 1, craft: 'PARTIAL', ...fact,
      specification: canonicalizeCreateOrderSpecification(spec.specification)!,
      quantity: 1, pricingGroup: 'MID', productStructure: 'STANDARD_ENVELOPE',
      frontColors: [], backColors: [],
      configuration: { paper: 'CATALOG', paperWeight: 'CATALOG', specification: 'CATALOG', craft: 'CATALOG' },
    }, snapshot.partial) : null;
    return {
      ...spec, state: cell.state, reason: cell.reason,
      blockedReason: invalidNode ? '产品分类已停用或退役，请检查相关组合' : null,
      canEnable: !blocked && !invalidNode && (cell.state === 'inactive' || cell.state === 'unconfigured'),
      availability: selectedInCatalog && option ? option.disabled ? '暂不可选' : '建单可选' : '未进入建单选项',
      price: rate?.unitPrice ?? null,
      relatedProducts: cell.rows.map((product) => ({ id: product.id, isActive: product.isActive })),
    };
  });
  return { paperId: paper.id, paperName: paper.name, blocked, cells, logisticsConfigured: Boolean(logisticsConfigured), priceReadable: snapshot !== null };
}
export type PaperSpecificationView = ReturnType<typeof buildPaperSpecificationView>;
