import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const req = createRequire(import.meta.url);
const target = new URL(process.env.DATABASE_URL ?? '');
const base = process.env.HISTORY_TEST_BASE_URL ?? 'http://127.0.0.1:3167';
assert.equal(target.hostname, '127.0.0.1');
assert.equal(target.pathname, '/erp_history_auth_test');
assert.equal(new URL(base).hostname, '127.0.0.1');
assert.notEqual(new URL(base).port, '3000');
assert.ok(process.env.AUTH_SECRET?.startsWith('isolated-history-finance-test-'));
const { db } = req('../lib/db.ts');
const { encode } = req('next-auth/jwt');
const bcrypt = req('bcryptjs');
let assertions = 0;
async function check(file, token, status) {
  const response = await fetch(`${base}/historical-finance/${file}`, {
    headers: token ? { Cookie: `authjs.session-token=${token}` } : {}, redirect: 'manual',
  });
  assert.equal(response.status, status, file);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assertions += 1;
  return response;
}
try {
  const password = await bcrypt.hash('history-test-only-20261007', 10);
  const accounts = {};
  for (const role of ['ADMIN', 'SALES', 'WORKER']) {
    const username = `history_test_${role.toLowerCase()}`;
    accounts[role] = await db.user.upsert({ where: { username }, create: { username, password, role, displayName: `历史看板验证${role}` }, update: { isActive: true, role, password } });
  }
  async function tokenFor(account) {
    return encode({ secret: process.env.AUTH_SECRET, salt: 'authjs.session-token', maxAge: 1800,
      token: { sub: account.id, username: account.username, displayName: account.displayName, role: account.role, workerType: account.workerType, machineType: account.machineType } });
  }
  const token = await tokenFor(accounts.ADMIN);
  const filenames = await readdir(process.env.HISTORICAL_FINANCE_DIR);
  for (const filename of filenames) {
    const anonymous = await check(filename, null, filename === 'index.html' ? 307 : 401);
    if (filename === 'index.html') {
      const login = new URL(anonymous.headers.get('location'));
      assert.equal(login.origin, base);
      assert.equal(login.pathname, '/login');
      assert.equal(login.searchParams.get('from'), '/historical-finance/index.html');
    }
    const response = await check(filename, token, 200);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), await readFile(path.join(process.env.HISTORICAL_FINANCE_DIR, filename)));
  }
  for (const role of ['SALES', 'WORKER']) {
    const otherToken = await tokenFor(accounts[role]);
    for (const filename of ['index.html', 'data.js', 'expense-summary.csv']) await check(filename, otherToken, filename === 'index.html' ? 403 : 401);
  }
  await db.user.update({ where: { id: accounts.ADMIN.id }, data: { isActive: false } });
  await check('data.js', token, 401);
  await check('index.html', token, 307);
  await db.user.update({ where: { id: accounts.ADMIN.id }, data: { isActive: true, role: 'SALES' } });
  await check('data.js', token, 401);
  await check('index.html', token, 403);
  await db.user.update({ where: { id: accounts.ADMIN.id }, data: { role: 'ADMIN' } });
  await check('missing.js', token, 404);
  await check('data.js', `${token.slice(0, -8)}modified`, 401);
  await check('index.html', `${token.slice(0, -8)}modified`, 307);
  const returnPath = await check('index.html?view=materials', null, 307);
  assert.equal(new URL(returnPath.headers.get('location')).searchParams.get('from'), '/historical-finance/index.html?view=materials');
  const landing = await fetch(`${base}/owner/historical-finance`, { headers: { Cookie: `authjs.session-token=${token}` } });
  assert.equal(landing.status, 200);
  assert.match(await landing.text(), /打开看板/);
  await mkdir('output/playwright', { recursive: true });
  await writeFile('output/playwright/history-local-state.json', JSON.stringify({ cookies: [{ name: 'authjs.session-token', value: token, domain: '127.0.0.1', path: '/', expires: Date.now() / 1000 + 1800, httpOnly: true, secure: false, sameSite: 'Lax' }], origins: [] }), { mode: 0o600 });
  console.log(JSON.stringify({ assertions, sourceFiles: filenames.length, byteMatches: filenames.length, frameworkAuthVerified: true, disabledAndChangedRoleRejected: true, landing: 200 }));
} finally {
  await db.$disconnect();
}
