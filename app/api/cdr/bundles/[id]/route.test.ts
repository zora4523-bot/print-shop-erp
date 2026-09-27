import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  consumeRateLimit: vi.fn(),
  consumeBundle: vi.fn(),
  signBundleDownloadUrl: vi.fn(),
}));

vi.mock('@/lib/cdr/download-rate-limit', () => ({
  consumeCdrDownloadRateLimit: mocks.consumeRateLimit,
}));
vi.mock('@/lib/cdr/bundle', async () => {
  class BundleNotFoundError extends Error {}
  class BundleExpiredError extends Error {}
  class BundleNotReadyError extends Error {
    status = 'PENDING';
  }
  return {
    BundleNotFoundError,
    BundleExpiredError,
    BundleNotReadyError,
    consumeBundle: mocks.consumeBundle,
  };
});
vi.mock('@/lib/cdr/download-url', () => ({
  signBundleDownloadUrl: mocks.signBundleDownloadUrl,
}));

import { GET } from './route';

const token = 'A'.repeat(43);
const params = Promise.resolve({ id: token });

beforeEach(() => {
  mocks.consumeRateLimit.mockReset().mockResolvedValue(true);
  mocks.consumeBundle.mockReset();
  mocks.signBundleDownloadUrl.mockReset().mockReturnValue('https://oss.example/bundle.zip?sig=short');
});

describe('GET /api/cdr/bundles/[token]', () => {
  it('rejects a rate-limited requester before reading the bundle', async () => {
    mocks.consumeRateLimit.mockResolvedValue(false);
    const response = await GET(new Request('https://erp.example/api/cdr/bundles/x'), { params });
    expect(response.status).toBe(429);
    expect(mocks.consumeBundle).not.toHaveBeenCalled();
  });

  it('returns a short signed OSS redirect after token validation', async () => {
    mocks.consumeBundle.mockResolvedValue({
      id: 'bundle-1', zipFileUrl: 'https://stored-long-url', zipObjectKey: 'bundles/bundle-1.zip',
      expiresAt: new Date(Date.now() + 86_400_000), downloadCount: 1,
    });
    const response = await GET(new Request('https://erp.example/api/cdr/bundles/token'), { params });
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('https://oss.example/bundle.zip?sig=short');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('does not expose mock storage or distinguish missing/expired links', async () => {
    mocks.consumeBundle.mockRejectedValue(new Error('missing'));
    const response = await GET(new Request('https://erp.example/api/cdr/bundles/token'), { params });
    expect(response.status).toBe(503);
    mocks.consumeBundle.mockRejectedValue(new (await import('@/lib/cdr/bundle')).BundleNotFoundError());
    const missing = await GET(new Request('https://erp.example/api/cdr/bundles/token'), { params });
    expect(missing.status).toBe(404);
  });
});
