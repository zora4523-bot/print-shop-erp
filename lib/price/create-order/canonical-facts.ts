const PAPER_WEIGHT_PREFIX = /^\s*(\d+)\s*(?:g|\u514b)\s*/iu;
const TRAILING_DIMENSIONS =
  /\s*(\d+(?:\.\d+)?)\s*[\u00d7xX*]\s*(\d+(?:\.\d+)?)\s*(?:mm|\u6beb\u7c73)?\s*$/iu;

const SPECIFICATION_ALIASES = new Map<string, string>([
  ['\u8ff7\u4f60', '\u8ff7\u4f60\u5c01'],
  ['\u8ff7\u4f60\u5c01', '\u8ff7\u4f60\u5c01'],
  ['\u65b9\u5f62', '\u65b9\u5f62\u5c01'],
  ['\u65b9\u5f62\u5c01', '\u65b9\u5f62\u5c01'],
  ['\u4e2d\u53f7', '\u4e2d\u53f7\u5c01'],
  ['\u4e2d\u53f7\u5c01', '\u4e2d\u53f7\u5c01'],
  ['\u5927\u53f7', '\u5927\u53f7\u5c01'],
  ['\u5927\u53f7\u5c01', '\u5927\u53f7\u5c01'],
  ['\u897f\u5c01\u4e2d\u53f7', '\u897f\u5c01\u4e2d\u53f7'],
  ['\u897f\u5c01\u5927\u53f7', '\u897f\u5c01\u5927\u53f7'],
  ['\u4e07\u5143\u5c01', '\u4e07\u5143\u5c01'],
]);

function compactText(value: string): string {
  return value.trim().replace(/\s+/gu, '');
}

export type CanonicalCreateOrderPaperFact = {
  paperType: string;
  paperWeightGsm: number;
};

/**
 * Canonicalize a catalog or published-rule paper label without guessing a
 * missing weight. A weight embedded in the label must agree with the separate
 * server-owned weight fact.
 */
export function canonicalizeCreateOrderPaperFact(
  paperLabel: string,
  paperWeightGsm?: number | null,
): CanonicalCreateOrderPaperFact | null {
  const compact = compactText(paperLabel);
  if (!compact) return null;

  const match = PAPER_WEIGHT_PREFIX.exec(compact);
  const embeddedWeight = match ? Number(match[1]) : null;
  const explicitWeight = paperWeightGsm ?? null;
  if (
    (embeddedWeight !== null &&
      (!Number.isSafeInteger(embeddedWeight) || embeddedWeight <= 0)) ||
    (explicitWeight !== null &&
      (!Number.isSafeInteger(explicitWeight) || explicitWeight <= 0)) ||
    (embeddedWeight !== null &&
      explicitWeight !== null &&
      embeddedWeight !== explicitWeight)
  ) {
    return null;
  }

  const resolvedWeight = explicitWeight ?? embeddedWeight;
  if (resolvedWeight === null) return null;
  const paperType = match ? compact.slice(match[0].length) : compact;
  if (!paperType) return null;
  return { paperType, paperWeightGsm: resolvedWeight };
}

/**
 * Strip only a terminal, unambiguous dimension pair, then normalize the small
 * set of persisted size aliases used by the create-order contract. Unknown
 * semantic labels are retained verbatim so they cannot collide with a known
 * price key; malformed or dimension-only values fail closed.
 */
export function canonicalizeCreateOrderSpecification(
  specification: string,
): string | null {
  const compact = compactText(specification).replaceAll('*', '\u00d7');
  if (!compact) return null;

  const matches = [...compact.matchAll(new RegExp(TRAILING_DIMENSIONS, 'giu'))];
  if (matches.length > 1) return null;
  const withoutDimensions = compact.replace(TRAILING_DIMENSIONS, '');
  if (!withoutDimensions || /[\u00d7xX*]/u.test(withoutDimensions)) {
    return null;
  }
  return SPECIFICATION_ALIASES.get(withoutDimensions) ?? withoutDimensions;
}
