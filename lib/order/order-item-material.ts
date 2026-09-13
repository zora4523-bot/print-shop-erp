/** Shared business identity for the supported coated-paper catalog labels. */
export function isCoatedOrderPaper(label: string | null | undefined): boolean {
  const name = (label ?? '')
    .replace(/^\s*\d+(?:\.\d+)?\s*(?:g|克)\s*/iu, '')
    .trim();
  return (
    name.includes('铜版') ||
    /(?:^|[^a-z])(?:coated|tbz)(?:$|[^a-z])/iu.test(name)
  );
}
