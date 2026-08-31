import { OrderProductStructure } from '@/generated/prisma/enums';

export function normalizeCatalogPricingText(
  value: string | null | undefined,
): string {
  return (value ?? '')
    .trim()
    .replaceAll('*', '×')
    .replaceAll('x', '×')
    .replaceAll('X', '×')
    .replace(/\s+/g, '');
}

export function catalogPricingFactChoices(
  fact: string | null | undefined,
): string[] {
  return [
    ...new Set(
      (fact ?? '')
        .split(/\s+\/\s+|／+/)
        .map((choice) => choice.trim())
        .filter(Boolean),
    ),
  ];
}

export function parseCatalogDimensions(
  specification: string | null | undefined,
): { widthMm: number; heightMm: number } | null {
  const dimensions = [
    ...new Map(
      [
        ...normalizeCatalogPricingText(specification).matchAll(
          /(\d+(?:\.\d+)?)×(\d+(?:\.\d+)?)/g,
        ),
      ]
        .map((match) => {
          const widthMm = Number(match[1]);
          const heightMm = Number(match[2]);
          return Number.isFinite(widthMm) && Number.isFinite(heightMm)
            ? ({ widthMm, heightMm } as const)
            : null;
        })
        .filter((value): value is { widthMm: number; heightMm: number } =>
          Boolean(value),
        )
        .map((value) => [`${value.widthMm}×${value.heightMm}`, value]),
    ).values(),
  ];
  return dimensions.length === 1 ? dimensions[0] : null;
}

export function parseCatalogPaperWeight(
  paperType: string | null | undefined,
): number | null {
  const match = (paperType ?? '').match(/(\d+)\s*(?:g|克)/i);
  if (!match) return null;
  const weight = Number(match[1]);
  return Number.isSafeInteger(weight) && weight > 0 ? weight : null;
}

export function inferCatalogProductStructure(
  specification: string | null | undefined,
): (typeof OrderProductStructure)[keyof typeof OrderProductStructure] {
  const structures = new Set(
    catalogPricingFactChoices(specification).map((choice) => {
      const normalized = normalizeCatalogPricingText(choice);
      if (normalized.includes('万元封')) {
        return OrderProductStructure.TEN_THOUSAND_ENVELOPE;
      }
      if (normalized.includes('西封')) {
        return OrderProductStructure.WESTERN_ENVELOPE;
      }
      return OrderProductStructure.STANDARD_ENVELOPE;
    }),
  );
  return structures.size === 1
    ? ([...structures][0] ?? OrderProductStructure.UNSPECIFIED)
    : OrderProductStructure.UNSPECIFIED;
}
