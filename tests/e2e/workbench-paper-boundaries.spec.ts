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
  {
    key: 'stock',
    name: `${prefix}-缺货`,
    paper: `${prefix}-缺货纸`,
    specification: '160g',
    productPaper: `160g${prefix}-缺货纸`,
    outOfStock: true,
  },
  {
    key: 'weight',
    name: `${prefix}-缺克重`,
    paper: `${prefix}-无克重`,
    specification: null,
    productPaper: null,
    outOfStock: false,
  },
  {
    key: 'long',
    name: `${prefix}-长纸名`,
    paper: longPaper,
    specification: '160g',
    productPaper: longPaper,
    outOfStock: false,
  },
];
const productIds = fixtures.map(({ key }) => `${prefix}-p-${key}`);
const materialIds = fixtures.map(({ key }) => `${prefix}-m-${key}`);
let seeded = false;
let craftWasActive: boolean | undefined;

// Use the existing isolation guard before opening any database connection.
// Prepare disposable catalog facts and restore the single foil craft activation afterward.
// No orders, prices or ledgers change.
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
    if (!node)
      throw new Error(
        'Workbench E2E requires an active custom product category',
      );
    await client.query('BEGIN');
    const craft = await client.query<{ isActive: boolean }>(
      `SELECT "isActive" FROM "Craft" WHERE code = 'FLAT_FOIL_SINGLE'`,
    );
    craftWasActive = craft.rows[0]?.isActive;
    if (craftWasActive === undefined) {
      await client.query(
        `INSERT INTO "Craft" (id, code, name, "isActive", "updatedAt") VALUES ($1, 'FLAT_FOIL_SINGLE', '专版单色平烫', true, NOW())`,
        [`${prefix}-craft`],
      );
    }
    await client.query(
      `UPDATE "Craft" SET "isActive" = true WHERE code = 'FLAT_FOIL_SINGLE'`,
    );
    for (const [index, fixture] of fixtures.entries()) {
      await client.query(
        `
        INSERT INTO "Material" (id, code, name, category, specification, unit, "outOfStock", "updatedAt")
        VALUES ($1::text, $1::text, $2, 'PAPER', $3, '张', $4, NOW())
      `,
        [
          materialIds[index],
          fixture.paper,
          fixture.specification,
          fixture.outOfStock,
        ],
      );
      await client.query(
        `
        INSERT INTO "Product" (id, name, category, "categoryNodeId", specification, "paperType", "paperMaterialId", "updatedAt")
        VALUES ($1, $2, 'CUSTOM_FLAT_FOIL', $3, '大号封90×165', $4, $5, NOW())
      `,
        [
          productIds[index],
          fixture.name,
          node,
          fixture.productPaper,
          materialIds[index],
        ],
      );
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
    await client.query(
      'UPDATE "Product" SET "isActive" = false WHERE id = ANY($1::text[])',
      [productIds],
    );
    await client.query(
      'UPDATE "Material" SET "isActive" = false WHERE id = ANY($1::text[])',
      [materialIds],
    );
    await client.query(
      `UPDATE "Craft" SET "isActive" = $1 WHERE code = 'FLAT_FOIL_SINGLE'`,
      [craftWasActive ?? false],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
});

test('shared paper choices exclude unavailable facts, preserve a long name and recover through actual quotes', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await login(page, {
    from: '/workbench',
    username: E2E_USERS.sales!.username,
    password: E2E_PASSWORD,
  });
  await page
    .getByRole('group', { name: '工单类型' })
    .getByRole('button', { name: '专版烫金', exact: true })
    .click();
  const papers = page.getByRole('group', { name: '纸张材质', exact: true });
  const unavailable = papers.getByRole('button', {
    name: fixtures[0]!.paper,
    exact: true,
  });
  if (await unavailable.count()) await expect(unavailable).toBeDisabled();
  await expect(
    papers.getByRole('button', { name: fixtures[1]!.paper, exact: true }),
  ).toHaveCount(0);
  await papers.getByRole('button', { name: longPaper, exact: true }).click();
  const quote = page.getByRole('region', { name: '报价计算', exact: true });
  await expect(quote.locator('p.text-3xl')).toHaveText('待核价');
  await expect(quote.locator('summary')).toContainText('费用明细');
  await papers.getByRole('button', { name: '珠光艳闪', exact: true }).click();
  await page
    .getByRole('group', { name: '克重', exact: true })
    .getByRole('button', { name: '160g', exact: true })
    .click();
  const product = quote.getByRole('combobox', { name: '匹配产品' });
  if (await product.count()) {
    // Explicitly choose a real catalog option when the isolated fixtures overlap.
    // 全套 spec 共库时选项排序会变，`.first()` 可能选中本 spec 自己造的「缺克重」
    // 夹具产品，报价随即失败（CI 第五轮现场）；按前缀排除本 spec 的夹具。
    const id = await product
      .locator('option[value]:not([value=""])')
      .filter({ hasNotText: prefix })
      .first()
      .getAttribute('value');
    expect(id).toBeTruthy();
    await product.selectOption(id!);
  }
  // 报价区在「正在计算…」与错误态都不渲染 p.text-3xl；CI 的 2 核 runner 在长跑
  // 后一次报价可超过默认 5 秒。最多等 30 秒，失败时把当时的报价区文字带进错误信息。
  const price = quote.locator('p.text-3xl');
  await expect
    .poll(
      async () =>
        (await price.count()) ? await price.innerText() : `<no price>\n${await quote.innerText()}`,
      { timeout: 30_000, message: '报价区应给出 ¥ 金额' },
    )
    .toContain('¥');
  expect(errors).toEqual([]);
});
