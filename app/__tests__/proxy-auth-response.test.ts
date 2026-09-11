import { expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { NextAuthRequest } from 'next-auth';
import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server';
vi.mock('next-auth', () => ({ default: () => ({
  auth: (handler: (request: NextAuthRequest) => Response) => async (request: NextAuthRequest) => {
    const response = handler(request);
    // Auth.js beta.32 appends these only after the user callback returns.
    response.headers.append('set-cookie', 'authjs.session-token=rotated; HttpOnly; Path=/');
    return response;
  },
}) }));
vi.mock('@/lib/auth/config.edge', () => ({ authConfigEdge: {} }));
import proxy, { config } from '@/proxy';
import nextConfig from '@/next.config';
const invoke = proxy as unknown as (request: NextAuthRequest) => Promise<Response>;
const validSession = { user: { id: 'actor' }, expires: '2099-01-01T00:00:00.000Z' };
function request(path: string, auth: unknown = null) {
  return Object.assign(new NextRequest(`https://erp.example${path}`), { auth }) as NextAuthRequest;
}
it.each(['/api/orders/order-1/pdf', '/api/salary/piecework-settlements/export', '/api/admin/inventory-count/materials'])('keeps %s protected with JSON 401 rather than login HTML', async (path) => {
  expect(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url: path })).toBe(true);
  const response = await invoke(request(path));
  expect(response.status).toBe(401);
  expect(response.headers.get('location')).toBeNull();
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(await response.json()).toEqual({ error: '未登录或登录状态已失效，请重新登录' });
});
it('preserves page login redirects and lets authenticated requests reach final route guards', async () => {
  const response = await invoke(request('/orders/order-1'));
  expect(response.status).toBe(307);
  expect(response.headers.get('location')).toBe('https://erp.example/login?from=%2Forders%2Forder-1');
  expect((await invoke(request('/api/orders/order-1/pdf', validSession))).headers.get('x-middleware-next')).toBe('1');
});
it.each([
  ['configuration error', { message: '配置错误' }],
  ['empty object', {}],
  ['primitive', 'authenticated'],
  ['array', []],
  ['missing user', { expires: validSession.expires }],
  ['missing id', { user: {}, expires: validSession.expires }],
  ['empty id', { user: { id: '' }, expires: validSession.expires }],
  ['blank id', { user: { id: '  ' }, expires: validSession.expires }],
  ['numeric id', { user: { id: 123 }, expires: validSession.expires }],
  ['array user', { user: [], expires: validSession.expires }],
  ['missing expiry', { user: { id: 'actor' } }],
  ['invalid expiry', { user: { id: 'actor' }, expires: 'invalid' }],
  ['expired session', { user: { id: 'actor' }, expires: '2000-01-01T00:00:00.000Z' }],
])('rejects %s at both API and page boundaries', async (_name, auth) => {
  const api = await invoke(request('/api/orders/order-1/pdf', auth));
  expect(api.status).toBe(401);
  expect(api.headers.get('x-middleware-next')).toBeNull();
  expect(await api.json()).toEqual({ error: '未登录或登录状态已失效，请重新登录' });
  const page = await invoke(request('/orders/order-1', auth));
  expect(page.status).toBe(307);
  expect(page.headers.get('location')).toBe('https://erp.example/login?from=%2Forders%2Forder-1');
});
it('lets a valid session reach the page account and role checks', async () => {
  expect((await invoke(request('/owner/agent-bills', validSession))).headers.get('x-middleware-next')).toBe('1');
});
it.each(['/api/auth/session', '/api/cron/daily-salary', '/api/health', '/api/cdr/bundles/bundle-1'])('does not change public/self-authenticated route %s', (url) => {
  expect(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url })).toBe(false);
});

it.each([['next-router-prefetch', '1'], ['purpose', 'prefetch']])('authenticates %s requests without issuing rolling cookies', async (header, value) => {
  const authenticated = request('/orders', validSession);
  authenticated.headers.set(header, value);
  const response = await invoke(authenticated);
  expect(response.headers.get('x-middleware-next')).toBe('1');
  expect(response.headers.getSetCookie()).toEqual([]);
  const anonymous = request('/api/orders/order-1/pdf');
  anonymous.headers.set(header, value);
  expect((await invoke(anonymous)).status).toBe(401);
});
it('preserves rolling cookies for ordinary navigation', async () => {
  expect((await invoke(request('/orders', validSession))).headers.getSetCookie()).toEqual([
    'authjs.session-token=rotated; HttpOnly; Path=/',
  ]);
});

it('preserves the Flight headers needed for authenticated prefetch handling', () => {
  expect(nextConfig.skipProxyUrlNormalize).toBe(true);
});
it.each([['HEAD', false], ['POST', true]])('keeps the prefetch cookie rule scoped for %s', async (method, renews) => {
  const req = Object.assign(new NextRequest('https://erp.example/orders', {
    method,
    headers: { 'next-router-prefetch': '1' },
  }), { auth: validSession }) as NextAuthRequest;
  const response = await invoke(req);
  expect(response.headers.has('set-cookie')).toBe(renews);
});
