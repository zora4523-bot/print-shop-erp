import { ProductCategory } from '../../generated/prisma/enums';
import { catalogPaperPricingFacts } from '../order/catalog-paper-identity';
import {
  catalogPricingFactChoices,
  normalizeCatalogPricingText,
  parseCatalogPaperWeight,
} from '../order/catalog-pricing-facts';
import { isRetiredPaper } from '../rules/paper-availability';
import { BLANK_SPECIFICATIONS, blankSpecificationKey } from './blank-paper';
import {
  canonicalizeCreateOrderPaperFact,
  type CanonicalCreateOrderPaperFact,
} from './create-order/canonical-facts';

export type BlankPaperIdentity = {
  id: string;
  name: string;
  specification: string | null;
};

export type BlankCellProduct = {
  id: string;
  category: ProductCategory;
  specification: string | null;
  paperType: string | null;
  paperMaterialId: string | null;
  weight: number | null;
  isActive: boolean;
};

export function paperPricingIdentityKey(fact: CanonicalCreateOrderPaperFact): string {
  return `${normalizeCatalogPricingText(fact.paperType)}:${fact.paperWeightGsm}`;
}

/** Diagnostics retain both sides of a contradictory weight for cell discovery only. */
export function inspectBlankCellProduct(product: BlankCellProduct) {
  const paperChoices = catalogPricingFactChoices(product.paperType);
  const specificationChoices = catalogPricingFactChoices(product.specification);
  const facts = paperChoices.flatMap((choice) => {
    const fact = canonicalizeCreateOrderPaperFact(
      choice, product.weight ?? parseCatalogPaperWeight(choice),
    );
    return fact ? [fact] : [];
  });
  const weightConflict = paperChoices.some((choice) => {
    const embedded = parseCatalogPaperWeight(choice);
    return embedded !== null && product.weight !== null && embedded !== product.weight;
  });
  const discoveryFacts = [...facts, ...paperChoices.flatMap((choice) => {
    const embedded = canonicalizeCreateOrderPaperFact(choice);
    if (!embedded) return [];
    const explicit = canonicalizeCreateOrderPaperFact(embedded.paperType, product.weight);
    return explicit ? [embedded, explicit] : [embedded];
  })];
  const specificationKeys = [...new Set(specificationChoices.flatMap((choice) => {
    const key = blankSpecificationKey(choice);
    return key ? [key] : [];
  }))];
  const standard = BLANK_SPECIFICATIONS.find((spec) => spec.key === specificationKeys[0]);
  return {
    facts, discoveryFacts, specificationKeys, weightConflict,
    multiValue: paperChoices.length > 1 || specificationChoices.length > 1,
    weightUnparseable: paperChoices.length === 0 || paperChoices.some((choice) => {
      const weight = product.weight ?? parseCatalogPaperWeight(choice);
      return weight === null || !Number.isSafeInteger(weight) || weight <= 0;
    }),
    specificationUnparseable: specificationChoices.length === 0 ||
      specificationChoices.some((choice) => blankSpecificationKey(choice) === null),
    exactSpecification: standard !== undefined && product.specification === standard.specification,
    normalizedSpecification: standard !== undefined &&
      normalizeCatalogPricingText(product.specification) === normalizeCatalogPricingText(standard.specification),
    retired: isRetiredPaper(product),
  };
}

export type BlankCellState = 'needs-attention' | 'enabled' | 'inactive' | 'unconfigured' | 'retired';
export type BlankCellReason = 'identity-conflict' | 'active-non-exact' | 'multiple-candidates' | 'retired-paper';

/** PLAN §3 S2: all rows (including inactive) enter discovery; only exact rows are candidates. */
export function classifyBlankPaperCell<T extends BlankCellProduct>(
  products: readonly T[],
  paper: BlankPaperIdentity,
  specificationKey: (typeof BLANK_SPECIFICATIONS)[number]['key'],
) {
  const paperKeys = new Set(catalogPaperPricingFacts(paper).map(paperPricingIdentityKey));
  const rows = products.filter((product) => {
    if (product.category !== ProductCategory.BLANK_STOCK) return false;
    const facts = inspectBlankCellProduct(product);
    return facts.specificationKeys.includes(specificationKey) &&
      (product.paperMaterialId === paper.id || facts.discoveryFacts.some((fact) => paperKeys.has(paperPricingIdentityKey(fact))));
  });
  const conflicts = rows.filter((product) => {
    const facts = inspectBlankCellProduct(product);
    return facts.weightConflict ||
      (product.paperMaterialId !== null && product.paperMaterialId !== paper.id) ||
      (product.paperMaterialId === paper.id &&
        (facts.facts.length === 0 || facts.facts.some((fact) => !paperKeys.has(paperPricingIdentityKey(fact)))));
  });
  const candidates = rows.filter((product) => {
    const facts = inspectBlankCellProduct(product);
    return !conflicts.includes(product) && !facts.multiValue && facts.exactSpecification;
  });
  const active = candidates.filter((product) => product.isActive);
  const inactive = candidates.filter((product) => !product.isActive);
  const result = (state: BlankCellState, reason: BlankCellReason | null, selected: T | null = null) =>
    ({ state, reason, rows, candidates, active, inactive, conflicts, selected });
  if (conflicts.length) return result('needs-attention', 'identity-conflict');
  if (isRetiredPaper(paper) || rows.some((product) => inspectBlankCellProduct(product).retired)) {
    return result('retired', 'retired-paper');
  }
  if (rows.some((product) => {
    const facts = inspectBlankCellProduct(product);
    return product.isActive && (facts.multiValue || !facts.exactSpecification);
  })) return result('needs-attention', 'active-non-exact');
  if (active.length === 1) return result('enabled', null, active[0]!);
  if (active.length > 1 || inactive.length > 1) return result('needs-attention', 'multiple-candidates');
  if (inactive.length === 1) return result('inactive', null, inactive[0]!);
  return result('unconfigured', null);
}
