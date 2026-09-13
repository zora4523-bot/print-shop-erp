import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { expect, test } from '@playwright/test';
import {
  E2E_PASSWORD,
  E2E_USERS,
  login,
  productionOperationE2eIsolationFailure as e2eIsolationFailure,
} from './_helpers';

const prefix = `e2e-wb-${randomBytes(4).toString('hex')}`;
const longPaper = prefix + '纸'.repeat(32 - prefix.length);
const fixtures = [
  { key: 'stock', name: `${prefix}-缺货`, paper: `${prefix}-缺货纸`, specification: '160g', productPaper: `160g${prefix}-缺货纸`, outOfStock: true },
  { key: 'weight', name: `${prefix}-缺克重`, paper: `${prefix}-无克重`, specification: null, productPaper: null, outOfStock: false },
  { key: 'long', name: `${prefix}-长纸名`, paper: longPaper, specification: '160g', productPaper: longPaper, outOfStock: false },
];
const productIds = fixtures.map(({ key }) => `${prefix}-p-${key}`);
const materialIds = fixtures.map(({ key }) => `${prefix}-m-${key}`);
let seeded = false;

// Use the existing isolation guard before opening any database connection.
// These are disposable catalog facts only; no orders, prices or ledgers change.
async function connect() {
  const failure = e2eIsolationFailure();
  if (failure) throw new Error(failure);
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  return client;
}

test.beforeAll(async () => {
  const client = await connect();
  try {
    const result = await client.query<{ categoryNodeId: string }>(`
      SELECT p."categoryNodeId" FROM "Product" p
      JOIN "ProductCategoryNode" c ON c.id = p."categoryNodeId"
      WHERE p.category = 'CUSTOM_FLAT_FOIL' AND p."isActive" AND c."isActive"
      ORDER BY p.id LIMIT 1
    `);
    const node = result.rows[0]?.categoryNodeId;
    if (!node) throw new Error('Workbench E2E requires an active custom product category');
    await client.query('BEGIN');
    for (const [index, fixture] of fixtures.entries()) {
      await client.query(`
        INSERT INTO "Material" (id, code, name, category, specification, unit, "outOfStock", "updatedAt")
        VALUES ($1::text, $1::text, $2, 'PAPER', $3, '张', $4, NOW())
      `, [materialIds[index], fixture.paper, fixture.specification, fixture.outOfStock]);
      await client.query(`
        INSERT INTO "Product" (id, name, category, "categoryNodeId", specification, "paperType", "paperMaterialId", "updatedAt")
        VALUES ($1, $2, 'CUSTOM_FLAT_FOIL', $3, '大号封90×165', $4, $5, NOW())
      `, [productIds[index], fixture.name, node, fixture.productPaper, materialIds[index]]);
    }
    await client.query('COMMIT');
    seeded = true;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
});

test.afterAll(async () => {
  if (!seeded) return;
  const client = await connect();
  try {
    // Only retire this run's catalog fixtures; preserve any historical references.
    await client.query('BEGIN');
    await client.query('UPDATE "Product" SET "isActive" = false WHERE id = ANY($1::text[])', [productIds]);
    await client.query('UPDATE "Material" SET "isActive" = false WHERE id = ANY($1::text[])', [materialIds]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
});

test('paper boundaries explain unavailable facts, preserve the long name and recover through real automatic quoting', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await login(page, { from: '/workbench', username: E2E_USERS.sales!.username, password: E2E_PASSWORD });
  const product = page.getByRole('combobox', { name: '产品', exact: true });
  const paper = page.getByRole('combobox', { name: '纸张', exact: true });
  for (const [index, reason] of [
    '所选产品的纸张已缺货或停用，请选择其他产品或联系管理员补充资料',
    '所选纸张缺少克重，请选择其他产品或联系管理员补充资料',
  ].entries()) {
    await product.click();
    await page.getByRole('option', { name: fixtures[index]!.name, exact: true }).click();
    await expect(paper).toBeDisabled();
    await expect(paper).toHaveAccessibleDescription(reason);
    await expect(page.getByText('请选择纸张', { exact: true })).toHaveCount(0);
    await expect(page.locator('p.text-3xl')).toHaveCount(0);
    await page.getByRole('button', { name: '计算报价', exact: true }).click();
    await expect(page.getByRole('region', { name: '报价计算', exact: true }).getByRole('alert')).toHaveText(reason);
  }
  await product.click();
  await page.getByRole('option', { name: fixtures[2]!.name, exact: true }).click();
  await expect(paper).toHaveText(`160g${longPaper}`);
  // The real engine reports unknown paper pricing; a schema rejection would
  // have neither a price version nor this manual-pricing result.
  await expect(page.locator('p.text-3xl')).toHaveText('待核价');
  await expect(page.getByText(/加工费价格版本/)).toBeVisible();
  await expect(page.getByRole('region', { name: '报价计算', exact: true }).getByRole('alert')).toHaveCount(0);
  await product.click();
  await page.getByRole('option', { name: '专版烫金 · 大号封', exact: true }).click();
  await paper.click();
  await page.getByRole('option', { name: '160g珠光艳闪', exact: true }).click();
  await expect(page.locator('p.text-3xl')).toContainText('¥');
  await expect(paper).toHaveAccessibleDescription('');
  expect(errors).toEqual([]);
});
