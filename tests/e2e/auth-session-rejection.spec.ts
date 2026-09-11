import { randomBytes } from 'node:crypto';
import { encode } from '@auth/core/jwt';
import { Client } from 'pg';
import { expect, test, type Page } from '@playwright/test';
import { E2E_PASSWORD, E2E_USERS, login } from './_helpers';

test.beforeEach(() => {
  if (process.env.E2E_APPEND_ONLY_DATABASE_ISOLATED !== '1') {
    throw new Error('会话回归测试必须使用独立 E2E_DATABASE_URL');
  }
});

async function withIsolatedDb<T>(action: (db: Client) => Promise<T>): Promise<T> {
  if (process.env.E2E_APPEND_ONLY_DATABASE_ISOLATED !== '1') {
    throw new Error('会话回归测试必须使用独立 E2E_DATABASE_URL');
  }
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try { return await action(db); } finally { await db.end(); }
}

async function expectUnauthenticated(page: Page): Promise<void> {
  const response = await page.request.get('/api/orders/e2e-session-missing-order/pdf');
  expect(response.status()).toBe(401);
  expect(response.headers()['cache-control']).toBe('private, no-store');
  expect(await response.json()).toEqual({ error: '未登录或登录状态已失效，请重新登录' });
  await page.goto('/owner/agent-bills');
  await expect(page).toHaveURL(/\/login(?:\?|$)/);
  await expect(page.getByRole('heading', { name: '代理商月度账单', exact: true })).toHaveCount(0);
}

test('过期和损坏的 JWT 拒绝受保护 API 和页面', async ({ page }) => {
  await login(page, { username: E2E_USERS.owner!.username, password: E2E_PASSWORD });
  const cookie = (await page.context().cookies()).find((entry) => /^(?:__Secure-)?authjs\.session-token$/.test(entry.name));
  expect(cookie, '真实登录必须生成 Auth.js 会话 cookie').toBeDefined();
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error('会话到期回归需要隔离服务使用的 AUTH_SECRET');
  const sessionResponse = await page.request.get('/api/auth/session');
  const session = await sessionResponse.json() as { user: { id: string } };
  const expiredToken = await encode({
    token: { sub: session.user.id },
    secret,
    salt: cookie!.name,
    maxAge: -3600,
  });
  // Keep the browser cookie alive so rejection exercises JWT expiry, not
  // merely the browser dropping an expired cookie before making the request.
  await page.context().addCookies([{ ...cookie!, value: expiredToken, expires: Math.floor(Date.now() / 1000) + 3600 }]);
  await expectUnauthenticated(page);
  await page.context().addCookies([{ ...cookie!, value: 'malformed-session-token', expires: Math.floor(Date.now() / 1000) + 3600 }]);
  await expectUnauthenticated(page);
});

test('已签发的合法令牌不能让停用账号继续访问财务页面或 API', async ({ page }) => {
  const id = `e2e-session-disabled-${randomBytes(6).toString('hex')}`;
  await withIsolatedDb(async (db) => {
    const inserted = await db.query(
      `INSERT INTO "User" (id, username, password, role, "displayName", "isActive", "createdAt", "updatedAt")
       SELECT $1::text, $1::text::citext, password, 'ADMIN', '会话停用回归账号', TRUE, NOW(), NOW()
       FROM "User" WHERE username=$2::citext AND "isActive"=TRUE`,
      [id, E2E_USERS.owner!.username],
    );
    expect(inserted.rowCount).toBe(1);
  });
  await login(page, { from: '/owner/agent-bills', username: id, password: E2E_PASSWORD });
  await expect(page.getByRole('heading', { name: '代理商月度账单', exact: true })).toBeVisible();
  await withIsolatedDb((db) => db.query('UPDATE "User" SET "isActive"=FALSE, "updatedAt"=NOW() WHERE id=$1', [id]));
  await expectUnauthenticated(page);
});
