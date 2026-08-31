import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Codex and local browser previews open the dev server through 127.0.0.1.
  // Next 16 otherwise blocks the dev-only client bootstrap/HMR endpoints.
  allowedDevOrigins: ['127.0.0.1'],
  async redirects() {
    return [
      {
        source: '/owner/rules/pricing-routes',
        destination: '/owner/rules',
        permanent: false,
      },
      {
        source: '/owner/products',
        destination: '/owner/rules/stock-skus',
        permanent: false,
      },
      {
        source: '/owner/products/new',
        destination: '/owner/rules/stock-skus/new',
        permanent: false,
      },
      {
        source: '/owner/products/:id',
        destination: '/owner/rules/stock-skus/:id',
        permanent: false,
      },
      {
        source: '/owner/crafts',
        destination: '/owner/rules/crafts',
        permanent: false,
      },
      {
        source: '/owner/crafts/new',
        destination: '/owner/rules/crafts/new',
        permanent: false,
      },
      {
        source: '/owner/crafts/:id',
        destination: '/owner/rules/crafts/:id',
        permanent: false,
      },
      {
        source: '/owner/product-categories',
        destination: '/owner/rules/product-categories',
        permanent: false,
      },
      {
        source: '/owner/product-categories/new',
        destination: '/owner/rules/product-categories/new',
        permanent: false,
      },
      {
        source: '/owner/product-categories/:id',
        destination: '/owner/rules/product-categories/:id',
        permanent: false,
      },
      {
        source: '/owner/prices/external-sales/items',
        destination: '/owner/rules/customer-pricing?section=blank',
        permanent: false,
      },
      {
        source: '/owner/prices/external-sales/logistics',
        destination:
          '/owner/rules/customer-pricing?purpose=logistics&section=ship',
        permanent: false,
      },
      {
        source: '/owner/prices/external-sales/versions',
        destination: '/owner/rules/price-versions',
        permanent: false,
      },
      {
        source: '/owner/prices',
        destination: '/owner/rules/customer-pricing?section=blank',
        permanent: false,
      },
      {
        source: '/owner/prices/tiers/:path*',
        destination: '/owner/rules/customer-pricing?section=tiers',
        permanent: false,
      },
      {
        source: '/owner/prices/adjustments/:path*',
        destination: '/owner/rules/customer-pricing?section=adds',
        permanent: false,
      },
      {
        source: '/owner/rules/internal-pricing/:path*',
        destination: '/owner/rules/customer-pricing?section=blank',
        permanent: false,
      },
      {
        source: '/owner/salary/rules',
        destination: '/owner/rules/employee-pay',
        permanent: false,
      },
    ];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), payment=()',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
