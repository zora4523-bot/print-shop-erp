const TRAILING_SOURCE_RANGE =
  /\s*[（(]\s*[A-Z]{1,3}\d+(?::[A-Z]{1,3}\d+)?\s*[)）]\s*$/i;

/**
 * Imported rule names may carry workbook cell coordinates for server-side
 * provenance. Those coordinates are not part of the business-facing name.
 */
export function externalPriceRuleDisplayName(name: string): string {
  const withoutRange = name.replace(TRAILING_SOURCE_RANGE, '').trim();
  const withoutImportTerms = withoutRange
    .replace(/(\d+)\s*个锚点/g, '$1 个')
    .replace(/\s{2,}/g, ' ')
    .trim();

  return withoutImportTerms || '未命名收费项目';
}
