import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();

const RETIRED_WRITE_SURFACES = [
  'actions/owner-prices.ts',
  'actions/owner-prices.types.ts',
  'lib/price.ts',
  'lib/price/adjustment-condition.ts',
  'components/business/price/PriceTierForm.tsx',
  'components/business/price/PriceAdjustmentForm.tsx',
  'components/business/price/PriceTables.tsx',
  'components/business/price/TogglePriceAdjustmentActiveButton.tsx',
  'components/business/rules/pricing/InternalPricingPage.tsx',
  'components/business/rules/pricing/NewInternalPriceTierPage.tsx',
  'components/business/rules/pricing/EditInternalPriceTierPage.tsx',
  'components/business/rules/pricing/NewInternalPriceAdjustmentPage.tsx',
  'components/business/rules/pricing/EditInternalPriceAdjustmentPage.tsx',
  'app/(admin)/owner/rules/internal-pricing/page.tsx',
  'app/(admin)/owner/rules/internal-pricing/tiers/new/page.tsx',
  'app/(admin)/owner/rules/internal-pricing/tiers/[id]/page.tsx',
  'app/(admin)/owner/rules/internal-pricing/adjustments/new/page.tsx',
  'app/(admin)/owner/rules/internal-pricing/adjustments/[id]/page.tsx',
] as const;

describe('retired internal pricing write surface', () => {
  it.each(RETIRED_WRITE_SURFACES)('does not restore %s', (relativePath) => {
    expect(existsSync(join(ROOT, relativePath))).toBe(false);
  });

  it('retains historical price tables without restoring their editor', () => {
    const schema = readFileSync(join(ROOT, 'prisma/schema.prisma'), 'utf8');

    expect(schema).toMatch(/model PriceTier\s+\{/);
    expect(schema).toMatch(/model PriceAdjustment\s+\{/);
  });
});
