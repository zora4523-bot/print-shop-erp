import { expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { NextAuthRequest } from 'next-auth';
import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server';
vi.mock('next-auth', () => ({ default: () => ({ auth: (handler: unknown) => handler }) }));
vi.mock('@/lib/auth/config.edge', () => ({ authConfigEdge: {} }));
import proxy, { config } from '@/proxy';
const invoke = proxy as unknown as (request: NextAuthRequest) => Response;
function request(path: string, authenticated = false) {
  return Object.assign(new NextRequest(`https://erp.example${path}`), { auth: authenticated ? { user: { id: 'actor' } } : null }) as NextAuthRequest;
}
it.each(['/api/orders/order-1/pdf', '/api/salary/piecework-settlements/export', '/api/admin/inventory-count/materials'])('keeps %s protected with JSON 401 rather than login HTML', async (path) => {
  expect(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url: path })).toBe(true);
  const response = invoke(request(path));
  expect(response.status).toBe(401);
  expect(response.headers.get('location')).toBeNull();
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(await response.json()).toEqual({ error: '未登录或登录状态已失效，请重新登录' });
});
it('preserves page login redirects and lets authenticated requests reach final route guards', () => {
  const response = invoke(request('/orders/order-1'));
  expect(response.status).toBe(307);
  expect(response.headers.get('location')).toBe('https://erp.example/login?from=%2Forders%2Forder-1');
  expect(invoke(request('/api/orders/order-1/pdf', true)).headers.get('x-middleware-next')).toBe('1');
});
it.each(['/api/auth/session', '/api/cron/daily-salary', '/api/health', '/api/cdr/bundles/bundle-1'])('does not change public/self-authenticated route %s', (url) => {
  expect(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url })).toBe(false);
});
