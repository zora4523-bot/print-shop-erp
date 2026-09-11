import type { NextConfig } from 'next';

const durableE2e = process.env.E2E_DURABLE_MODE === '1';
const releaseE2e = process.env.E2E_RELEASE_MODE === '1';

const nextConfig: NextConfig = {
  // Release browser tests must not share build artifacts with a developer server.
  distDir: durableE2e ? '.next-durable' : releaseE2e ? '.next-release' : '.next',
  ...(durableE2e || releaseE2e
    ? { typescript: { tsconfigPath: durableE2e ? 'tsconfig.durable.json' : 'tsconfig.release.json' } }
    : {}),
  // ali-oss uses Node-only loading with urllib's optional proxy-agent peer.
  // Keep native resolution instead of bundling an unused optional proxy path.
  serverExternalPackages: ['ali-oss'],
  poweredByHeader: false,
  // Preserve Flight headers so authenticated prefetches can avoid renewing
  // the session cookie after logout. The proxy still authenticates them.
  skipProxyUrlNormalize: true,
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
