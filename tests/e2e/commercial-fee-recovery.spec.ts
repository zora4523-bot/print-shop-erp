import { expect, test, type Page, type Route } from '@playwright/test';
import { Client } from 'pg';
import { assertActivatedE2eDatabase } from '../../scripts/lib/e2e-environment';
import { E2E_PASSWORD, E2E_USERS, getUserIdByUsername, login } from './_helpers';
import { detachedActionHeaders } from './_action-replay';

async function database() {
  const db = new Client({ connectionString: assertActivatedE2eDatabase().url });
  await db.connect();
  return db;
}

async function fixture() {
  const id = `e2e-fee-recovery-${crypto.randomUUID()}`;
  const salesId = await getUserIdByUsername(E2E_USERS.sales.username);
  const ownerId = await getUserIdByUsername(E2E_USERS.owner.username);
  const db = await database();
  try {
    await db.query(`INSERT INTO "Order" (id,"orderNo","customName","submitterId","submitterRole","settlementType","createdById",status,"pricingStatus","confirmedFee","pricingConfirmedAt","pricingConfirmedById","submittedAt","createdAt","updatedAt")
      VALUES ($1,$1,'费用恢复验收',$2,'SALES','EXTERNAL_SALES',$2,'SUBMITTED','ADMIN_CONFIRMED',0,NOW(),$3,NOW(),NOW(),NOW())`, [id, salesId, ownerId]);
  } finally { await db.end(); }
  return id;
}

async function readCharges(orderId: string) {
  const db = await database();
  try {
    return (await db.query<{ description: string; amount: string; status: string }>(`SELECT description,amount::text,status::text FROM "OrderCustomerCharge" WHERE "orderId"=$1 ORDER BY id`, [orderId])).rows;
  } finally { await db.end(); }
}

async function openFees(page: Page, id: string) {
  await login(page, { username: E2E_USERS.owner.username, password: E2E_PASSWORD, from: `/orders/${id}#commercial-fees` });
  await expect(page.locator('#commercial-fees')).toBeVisible();
}
async function fillManual(page: Page) {
  const fee = page.locator('#commercial-fees');
  // 业主 2026-10-01：「添加整单费用」默认收起（仍挂载）；重新加载后会再次收起，按需展开。
  const add = fee.locator('details').filter({ has: page.locator('summary', { hasText: '添加整单费用' }) }).first();
  if (!(await add.evaluate((details) => (details as HTMLDetailsElement).open))) await add.locator(':scope > summary').click();
  await fee.getByRole('textbox', { name: '整单费用金额', exact: true }).fill('25');
  await fee.getByRole('textbox', { name: '收费说明', exact: true }).fill('网络恢复打样费');
  await fee.getByRole('textbox', { name: '原因', exact: true }).fill('客户确认');
}

for (const committed of [false, true]) {
  test(`${committed ? '费用已入库但响应丢失' : '费用请求未送达'}：保留输入、先核对且不自动重发`, async ({ page }) => {
    test.setTimeout(90_000);
    const id = await fixture();
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await openFees(page, id);
    const fee = page.locator('#commercial-fees');
    await fillManual(page);
    let writes = 0;
    const intercept = async (route: Route) => {
      if (!route.request().headers()['next-action']) return route.continue();
      writes += 1;
      if (committed) {
        const response = await route.fetch({ headers: detachedActionHeaders(route.request()) });
        expect(response.status()).toBe(200);
      }
      await route.abort('failed');
    };
    await page.route(`**/orders/${id}`, intercept);
    await fee.getByRole('button', { name: '添加费用', exact: true }).click();
    await expect(fee.getByRole('status')).toContainText('暂时无法确认费用处理结果');
    await expect(fee.getByRole('textbox', { name: '收费说明', exact: true })).toHaveValue('网络恢复打样费');
    await expect(fee.getByRole('button', { name: '添加费用', exact: true })).toBeDisabled();
    expect(await readCharges(id)).toHaveLength(committed ? 1 : 0);
    if (committed) {
      const screenshotPath = test.info().outputPath('fee-recovery.png');
      await page.screenshot({ path: screenshotPath });
      await test.info().attach('费用结果待核对', { path: screenshotPath, contentType: 'image/png' });
    }

    const popupPromise = page.waitForEvent('popup');
    await fee.getByRole('button', { name: '在新标签页核对费用', exact: true }).click();
    const checkPage = await popupPromise;
    await expect(checkPage.locator('#commercial-fees')).toBeVisible();
    if (committed) await expect(checkPage.locator('#commercial-fees').getByRole('textbox', { name: '收费说明', exact: true }).first()).toHaveValue('网络恢复打样费');
    else expect(await readCharges(id)).toEqual([]);
    await checkPage.close();
    await expect(fee.getByRole('textbox', { name: '收费说明', exact: true })).toHaveValue('网络恢复打样费');
    expect(writes).toBe(1);
    await page.unrouteAll({ behavior: 'wait' });
    await fee.getByRole('button', { name: '核对后重新加载', exact: true }).click();
    await expect(fee.getByRole('status')).toHaveCount(0);
    if (!committed) {
      await fillManual(page);
      await fee.getByRole('button', { name: '添加费用', exact: true }).click();
    }
    await expect.poll(() => readCharges(id)).toEqual([{ description: '网络恢复打样费', amount: '25.00', status: 'FINAL' }]);
    expect(writes).toBe(1);
    expect(pageErrors).toEqual([]);
  });
}

test('详情脚本加载失败后，重新加载按钮能恢复真实页面', async ({ page }) => {
  test.setTimeout(90_000);
  const id = await fixture();
  await login(page, { username: E2E_USERS.owner.username, password: E2E_PASSWORD, from: '/orders?queue=all' });
  let blocked = 0;
  const intercept = async (route: Route) => {
    const response = await route.fetch();
    const source = await response.text();
    if (source.includes('admin-order-detail') && source.includes('工单概览与操作')) {
      blocked += 1;
      await route.abort('failed');
    } else await route.fulfill({ response });
  };
  await page.route('**/_next/static/chunks/*.js', intercept);
  await page.locator(`a[href="/orders/${id}"]`).first().click();
  await expect(page.getByRole('heading', { name: '此页面暂时无法加载', exact: true })).toBeVisible();
  expect(blocked).toBeGreaterThan(0);
  await page.unrouteAll({ behavior: 'wait' });
  await page.getByRole('button', { name: '重新加载页面', exact: true }).click();
  await expect(page.getByTestId('admin-order-detail')).toBeVisible();
  await expect(page.getByRole('heading', { name: '费用恢复验收', exact: true })).toBeVisible();
});
