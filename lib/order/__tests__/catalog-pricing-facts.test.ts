import { describe, expect, it } from 'vitest';
import { OrderProductStructure } from '@/generated/prisma/enums';
import {
  catalogPricingFactChoices,
  inferCatalogProductStructure,
  normalizeCatalogPricingText,
  parseCatalogDimensions,
  parseCatalogPaperWeight,
} from '../catalog-pricing-facts';

describe('catalog pricing facts', () => {
  it('normalizes catalog dimensions without changing their meaning', () => {
    expect(normalizeCatalogPricingText(' 西封中号 80 x 120 ')).toBe(
      '西封中号80×120',
    );
    expect(parseCatalogDimensions('西封中号80×120')).toEqual({
      widthMm: 80,
      heightMm: 120,
    });
  });

  it('keeps combined SKU facts unresolved until one specification is selected', () => {
    const specification = '大号90×165 / 西封中号80×120';

    expect(catalogPricingFactChoices(specification)).toEqual([
      '大号90×165',
      '西封中号80×120',
    ]);
    expect(catalogPricingFactChoices('大号（规格表!A2/A3）')).toEqual([
      '大号（规格表!A2/A3）',
    ]);
    expect(catalogPricingFactChoices('160g艳闪 / 闪红 / 红卡')).toEqual([
      '160g艳闪',
      '闪红',
      '红卡',
    ]);
    expect(parseCatalogDimensions(specification)).toBeNull();
    expect(inferCatalogProductStructure(specification)).toBe(
      OrderProductStructure.UNSPECIFIED,
    );
  });

  it('accepts one repeated dimension but does not infer structure from missing facts', () => {
    expect(parseCatalogDimensions('大号90×165 / 普通封90×165')).toEqual({
      widthMm: 90,
      heightMm: 165,
    });
    expect(inferCatalogProductStructure(null)).toBe(
      OrderProductStructure.UNSPECIFIED,
    );
  });

  it.each([
    ['200g触感纸', 200],
    ['160 克 冰白纸', 160],
    ['自定义纸张', null],
  ])('parses paper weight from %s', (paperType, expected) => {
    expect(parseCatalogPaperWeight(paperType)).toBe(expected);
  });

  it('infers the envelope structure from a catalog specification', () => {
    expect(inferCatalogProductStructure('西封大号85×165')).toBe(
      OrderProductStructure.WESTERN_ENVELOPE,
    );
    expect(inferCatalogProductStructure('万元封120×220')).toBe(
      OrderProductStructure.TEN_THOUSAND_ENVELOPE,
    );
    expect(inferCatalogProductStructure('大号封90×165')).toBe(
      OrderProductStructure.STANDARD_ENVELOPE,
    );
  });
});
