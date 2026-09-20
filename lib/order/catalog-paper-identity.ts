import {
  canonicalizeCreateOrderPaperFact,
  type CanonicalCreateOrderPaperFact,
} from '../price/create-order/canonical-facts';
import {
  catalogPricingFactChoices,
  normalizeCatalogPricingText,
  parseCatalogPaperWeight,
} from './catalog-pricing-facts';

export function catalogPaperPricingFacts(paper: {
  name: string;
  specification: string | null;
}): CanonicalCreateOrderPaperFact[] {
  const configuredWeight =
    parseCatalogPaperWeight(paper.specification) ??
    parseCatalogPaperWeight(paper.name);
  if (configuredWeight === null) return [];
  const facts = [paper.name, paper.specification]
    .filter((value): value is string => Boolean(value?.trim()))
    .flatMap(catalogPricingFactChoices)
    .flatMap((choice) => {
      const fact = canonicalizeCreateOrderPaperFact(choice, configuredWeight);
      return fact ? [fact] : [];
    });
  const byIdentity = new Map(
    facts.map((fact) => [
      `${normalizeCatalogPricingText(fact.paperType)}:${fact.paperWeightGsm}`,
      fact,
    ]),
  );
  return [...byIdentity.values()];
}

export function catalogPaperIdentityKeys(paper: {
  name: string;
  specification: string | null;
}): Set<string> {
  return new Set(catalogPaperPricingFacts(paper).map((fact) =>
    `${normalizeCatalogPricingText(fact.paperType)}:${fact.paperWeightGsm}`,
  ));
}

export function findCatalogPaperIdentityMatches<T extends { name: string; specification: string | null }>(
  papers: readonly T[],
  identity: { name: string; specification: string | null },
): T[] {
  const keys = catalogPaperIdentityKeys(identity);
  return papers.filter((paper) => [...catalogPaperIdentityKeys(paper)].some((key) => keys.has(key)));
}
