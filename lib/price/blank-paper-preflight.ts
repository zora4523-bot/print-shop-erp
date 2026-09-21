import { ProductCategory } from '../../generated/prisma/enums';
import { catalogPaperPricingFacts } from '../order/catalog-paper-identity';
import { isRetiredPaper } from '../rules/paper-availability';
import { isRetiredProductCategory } from '../rules/retired-catalog';
import { BLANK_SPECIFICATIONS, blankSpecificationKey } from './blank-paper';
import {
  classifyBlankPaperCell, inspectBlankCellProduct, paperPricingIdentityKey,
  type BlankCellProduct, type BlankPaperIdentity,
} from './blank-paper-cell';
import { canonicalizeCreateOrderPaperFact } from './create-order/canonical-facts';
import { customerRuleConditionV1Schema } from './customer-rule-condition';

export type PreflightProduct = BlankCellProduct & { categoryNodeId: string };
export type PreflightNode = { id: string; path: string; legacyCategory: ProductCategory; isActive: boolean };
export type PreflightRule = { id: string; priceBookId: string; productId: string | null; triggerCondition: unknown };

function groupBy<T>(rows: readonly T[], keys: (row: T) => string[]) {
  const groups = new Map<string, T[]>();
  for (const row of rows) for (const key of new Set(keys(row))) {
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups].map(([key, members]) => ({ key, members }));
}

function auditProducts(products: readonly PreflightProduct[], papers: readonly BlankPaperIdentity[]) {
  const inspected = products.map((product) => ({ product, ...inspectBlankCellProduct(product) }));
  const nonExact = inspected.filter((row) => row.specificationKeys.length > 0 && !row.exactSpecification);
  const groups = new Map(groupBy(inspected, (row) => row.discoveryFacts.flatMap((fact) =>
    row.specificationKeys.map((key) => `${row.product.category}:${paperPricingIdentityKey(fact)}:${key}`)))
    .map(({ key, members }) => [key, new Set(members.map((row) => row.product.id))]));
  // FK-only and contradictory linked rows must participate in the same-cell count too.
  for (const paper of papers) for (const spec of BLANK_SPECIFICATIONS) {
    const cell = classifyBlankPaperCell(products, paper, spec.key);
    for (const fact of catalogPaperPricingFacts(paper)) {
      const key = `${ProductCategory.BLANK_STOCK}:${paperPricingIdentityKey(fact)}:${spec.key}`;
      const members = groups.get(key) ?? new Set<string>();
      for (const row of cell.rows) members.add(row.id);
      if (members.size) groups.set(key, members);
    }
  }
  return {
    sameCellMultipleRows: [...groups].filter(([, members]) => members.size > 1)
      .map(([key, members]) => ({ key, productIds: [...members] })),
    specificationUnparseable: inspected.filter((row) => row.specificationUnparseable),
    weightUnparseable: inspected.filter((row) => row.weightUnparseable),
    multiValue: inspected.filter((row) => row.multiValue),
    weightConflict: inspected.filter((row) => row.weightConflict),
    nonExactSpecification: {
      active: nonExact.filter((row) => row.product.isActive),
      inactive: nonExact.filter((row) => !row.product.isActive),
      normalizedEquivalent: nonExact.filter((row) => row.normalizedSpecification),
    },
  };
}

/** Read-only diagnostics, not a saleability policy or a quote. Rules are current STOCK_BASE rows. */
export function buildBlankPaperPreflight(input: {
  papers: readonly BlankPaperIdentity[];
  products: readonly PreflightProduct[];
  nodes: readonly PreflightNode[];
  rules: readonly PreflightRule[];
}) {
  const retiredProducts = input.products.filter((row) => isRetiredPaper(row));
  const retiredPapers = input.papers.filter(isRetiredPaper);
  const cells = input.papers.flatMap((paper) => BLANK_SPECIFICATIONS.map((spec) => {
    const result = classifyBlankPaperCell(input.products, paper, spec.key);
    return { paperId: paper.id, specificationKey: spec.key, ...result };
  }));
  const paperById = new Map(input.papers.map((paper) => [paper.id, paper]));
  const foreignKeyConflicts = input.products.flatMap((product) => {
    if (!product.paperMaterialId) return [];
    const paper = paperById.get(product.paperMaterialId);
    const facts = inspectBlankCellProduct(product);
    const identities = new Set(paper ? catalogPaperPricingFacts(paper).map(paperPricingIdentityKey) : []);
    return !paper || !facts.facts.length || facts.weightConflict || facts.facts.some((fact) => !identities.has(paperPricingIdentityKey(fact)))
      ? [{ product, linkedPaper: paper ?? null }] : [];
  });
  const enabledNodeDistribution = groupBy(
    input.products.filter((row) => row.category === ProductCategory.BLANK_STOCK && row.isActive),
    (row) => [row.categoryNodeId],
  ).map(({ key, members }) => {
    const node = input.nodes.find((node) => node.id === key);
    return { nodeId: key, node: node ?? null, valid: Boolean(node?.isActive && !isRetiredProductCategory(node)),
      productIds: members.map((row) => row.id) };
  });
  const ruleFacts = input.rules.map((rule) => {
    const parsed = customerRuleConditionV1Schema.safeParse(rule.triggerCondition);
    const condition = parsed.success ? parsed.data : null;
    const paper = condition?.paperTypes?.length === 1
      ? canonicalizeCreateOrderPaperFact(condition.paperTypes[0]!) : null;
    const specificationKey = condition?.specifications?.length === 1
      ? blankSpecificationKey(condition.specifications[0]) : null;
    const valid = condition?.target === 'ITEM' && condition.pricingRoutes?.length === 1 &&
      condition.pricingRoutes[0] === 'STOCK_BLANK' && paper !== null && specificationKey !== null;
    return { rule, paper, specificationKey, valid };
  });
  const noEnabledProductWithTextRules = cells.flatMap((cell) => {
    // Use discovered active rows, not legal candidates: malformed active products are reported above.
    if (cell.rows.some((row) => row.isActive)) return [];
    const paper = paperById.get(cell.paperId)!;
    const identities = catalogPaperPricingFacts(paper);
    const matching = ruleFacts.filter((row) => row.valid && row.paper &&
      identities.some((identity) => identity.paperType === row.paper!.paperType &&
        identity.paperWeightGsm === row.paper!.paperWeightGsm) && row.specificationKey === cell.specificationKey);
    return matching.length ? [{ paperId: cell.paperId, specificationKey: cell.specificationKey,
      retired: isRetiredPaper(paper), ruleIds: matching.map((row) => row.rule.id) }] : [];
  });
  return {
    diagnostics: auditProducts(input.products.filter((row) => !isRetiredPaper(row)), input.papers.filter((paper) => !isRetiredPaper(paper))),
    retired120g: { papers: retiredPapers, products: retiredProducts, diagnostics: auditProducts(retiredProducts, retiredPapers) },
    foreignKeyConflicts,
    duplicatePaperIdentities: groupBy(input.papers, (paper) => catalogPaperPricingFacts(paper).map(paperPricingIdentityKey))
      .filter((group) => group.members.length > 1),
    enabledNodeDistribution,
    nodeAssignmentReady: enabledNodeDistribution.length === 1 && enabledNodeDistribution[0]!.valid,
    noEnabledProductWithTextRules,
    invalidCurrentRuleConditions: ruleFacts.filter((row) => !row.valid).map((row) => row.rule),
    cells,
  };
}
