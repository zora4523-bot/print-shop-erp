import { describe, expect, it } from 'vitest';
import nextConfig from '../../../next.config';

describe('legacy rule management redirects', () => {
  it('keeps one canonical rule-center URL for every legacy editor', async () => {
    const redirects = await nextConfig.redirects?.();

    expect(redirects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: '/owner/rules/pricing-routes',
          destination: '/owner/rules',
        }),
        expect.objectContaining({
          source: '/owner/products',
          destination: '/owner/rules/stock-skus',
        }),
        expect.objectContaining({
          source: '/owner/products/:id',
          destination: '/owner/rules/stock-skus/:id',
        }),
        expect.objectContaining({
          source: '/owner/crafts',
          destination: '/owner/rules/crafts',
        }),
        expect.objectContaining({
          source: '/owner/crafts/:id',
          destination: '/owner/rules/crafts/:id',
        }),
        expect.objectContaining({
          source: '/owner/product-categories',
          destination: '/owner/rules/product-categories',
        }),
        expect.objectContaining({
          source: '/owner/product-categories/new',
          destination: '/owner/rules/product-categories/new',
        }),
        expect.objectContaining({
          source: '/owner/product-categories/:id',
          destination: '/owner/rules/product-categories/:id',
        }),
        expect.objectContaining({
          source: '/owner/prices/external-sales/items',
          destination: '/owner/rules/customer-pricing',
        }),
        expect.objectContaining({
          source: '/owner/prices/external-sales/versions',
          destination: '/owner/rules/price-versions',
        }),
        expect.objectContaining({
          source: '/owner/prices',
          destination: '/owner/rules/internal-pricing',
        }),
        expect.objectContaining({
          source: '/owner/prices/tiers/:id',
          destination: '/owner/rules/internal-pricing/tiers/:id',
        }),
        expect.objectContaining({
          source: '/owner/prices/adjustments/:id',
          destination: '/owner/rules/internal-pricing/adjustments/:id',
        }),
        expect.objectContaining({
          source: '/owner/salary/piecework-rules',
          destination: '/owner/rules/worker-piecework',
        }),
        expect.objectContaining({
          source: '/owner/salary/rules',
          destination: '/owner/rules/employee-pay',
        }),
      ]),
    );
    expect(redirects?.every((entry) => entry.permanent === false)).toBe(true);
    expect(redirects).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: '/owner/prices/external-sales' }),
      ]),
    );
  });
});
