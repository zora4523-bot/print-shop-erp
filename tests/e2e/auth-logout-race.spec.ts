import { expect, test } from '@playwright/test';
import { E2E_PASSWORD, E2E_USERS, login, logout } from './_helpers';

test('退出登录后才到达的预取响应不能重新写入会话', async ({ page }) => {
  await page.route('**/*', async (route) => {
    const headers = route.request().headers();
    if (headers['next-router-prefetch'] === '1' || headers.purpose === 'prefetch') {
      await route.abort();
    } else {
      await route.continue();
    }
  });
  await login(page, { from: '/orders', username: E2E_USERS.customerService.username, password: E2E_PASSWORD });
  const sessionCookies = async () => (await page.context().cookies()).filter((cookie) => /^(?:__Secure-)?authjs\.session-token(?:\.\d+)?$/.test(cookie.name)).map((cookie) => cookie.name);
  expect(await sessionCookies()).toHaveLength(1);

  let responseReady!: () => void;
  const ready = new Promise<void>((resolve) => { responseReady = resolve; });
  let releaseResponse!: () => void;
  const release = new Promise<void>((resolve) => { releaseResponse = resolve; });
  await page.route('**/account/password?logout-race=1', async (route) => {
    // Fetch the authenticated response before logout, then deliver its real
    // body and headers after the logout response cleared the browser cookie.
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    responseReady();
    await release;
    await route.fulfill({ response });
  });
  const delayedRequest = page.evaluate(async () => {
    const response = await fetch('/account/password?logout-race=1', {
      headers: { 'next-router-prefetch': '1', rsc: '1' },
    });
    await response.text();
    return response.status;
  });
  try {
    await ready;
    await logout(page);
    expect(await sessionCookies()).toHaveLength(0);
  } finally {
    releaseResponse();
  }
  expect(await delayedRequest).toBe(200);
  expect(await sessionCookies()).toHaveLength(0);
  const protectedResponse = await page.request.get('/api/orders/e2e-logout-race/pdf');
  expect(protectedResponse.status()).toBe(401);
  await page.goto('/orders');
  await expect(page).toHaveURL(/\/login(?:\?|$)/);
  await expect(page.locator('#username')).toBeVisible();
});

test('保留 Flight 头后公共资源、普通续期和预取认证边界不变', async ({ page }) => {
  const loginResponse = await page.goto('/login');
  expect(loginResponse?.status()).toBe(200);
  const asset = await page.locator('script[src^="/_next/static/"]').first().getAttribute('src');
  expect(asset).toBeTruthy();
  expect((await page.request.get(asset!)).status()).toBe(200);
  expect((await page.request.get('/api/health')).status()).toBe(200);
  expect((await page.request.get('/api/auth/session')).status()).toBe(200);
  const headers = { 'next-router-prefetch': '1', rsc: '1' };
  const api = await page.request.get('/api/orders/e2e-prefetch-unauthorized/pdf?_rsc=gate', { headers });
  expect(api.status()).toBe(401);
  expect(await api.json()).toEqual({ error: '未登录或登录状态已失效，请重新登录' });
  const redirect = await page.request.get('/account/password?_rsc=gate', { headers, maxRedirects: 0 });
  expect(redirect.status()).toBe(307);
  const location = new URL(redirect.headers().location!, page.url());
  expect(location.pathname).toBe('/login');
  expect(location.searchParams.get('from')).toBe('/account/password');

  await login(page, { from: '/orders', username: E2E_USERS.customerService.username, password: E2E_PASSWORD });
  const normal = await page.request.get('/orders');
  expect(normal.status()).toBe(200);
  expect((normal.headers()['set-cookie'] ?? '').includes('authjs.session-token=')).toBe(true);
  const prefetch = await page.request.get('/account/password?_rsc=gate', { headers });
  expect(prefetch.status()).toBe(200);
  expect(prefetch.headers()['set-cookie']).toBeUndefined();
});
