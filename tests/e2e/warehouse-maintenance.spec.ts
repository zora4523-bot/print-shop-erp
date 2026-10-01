import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { E2E_PASSWORD, E2E_USERS, login } from './_helpers';
import { assertSupplyChainIsolation, withSupplyChainDb } from './_supply-chain-fixtures';

test.beforeEach(assertSupplyChainIsolation);
async function changeState(page: Page, name: string, button: string) {
  const section = page.getByLabel(`${name}维护`, { exact: true });
  await section.getByRole('button', { name: button, exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: button, exact: true }).click();
  // The confirmation closes before the server action settles. Wait for the
  // committed state before another tab reads the location list.
  const nextAction = button.startsWith('停用')
    ? button.replace('停用', '启用')
    : button.replace('启用', '停用');
  await expect(section.getByRole('button', { name: nextAction, exact: true })).toBeEnabled();
}

test('仓库与库位可改名停用恢复，旧出入库页面拒绝已停用库位', async ({ page, context }) => {
  test.setTimeout(120_000);
  const suffix = randomUUID().slice(0, 8);
  const warehouseName = `错名仓库-${suffix}`;
  const renamed = `修正仓库-${suffix}`;
  const locationName = `库位-${suffix}`;
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
  await login(page, { username: E2E_USERS.owner!.username, password: E2E_PASSWORD, from: '/owner/warehouses' });
  await page.getByText('仓库与库位设置', { exact: true }).click();
  await page.locator('#warehouse-create-form').getByLabel('仓库名称', { exact: true }).fill(warehouseName);
  await page.getByRole('button', { name: '创建仓库', exact: true }).click();
  const warehouse = page.getByLabel(`${warehouseName}维护`, { exact: true });
  await warehouse.getByText('改名', { exact: true }).click();
  await warehouse.getByLabel('仓库名称', { exact: true }).fill(renamed);
  await warehouse.getByRole('button', { name: '保存名称', exact: true }).click();
  await expect(page.getByLabel(`${renamed}维护`, { exact: true })).toBeVisible();
  const data = await withSupplyChainDb(async (db) => {
    const row = (await db.query<{ id: string; code: string }>('SELECT id,code FROM "Warehouse" WHERE name=$1', [renamed])).rows[0]!;
    const materialId = `maintenance-${suffix}`;
    await db.query(`INSERT INTO "Material" (id,code,name,category,unit,"createdAt","updatedAt") VALUES ($1::text,$1::text,'停用回归物料','OTHER','件',NOW(),NOW())`, [materialId]);
    return { ...row, materialId };
  });
  const createLocation = page.locator('#location-create-form');
  await createLocation.getByLabel('所属仓库', { exact: true }).selectOption(data.id);
  await createLocation.getByLabel('库位名称', { exact: true }).fill(locationName);
  await createLocation.getByRole('button', { name: '创建库位', exact: true }).click();
  await expect(page.getByLabel(`${locationName}维护`, { exact: true })).toBeVisible();
  const locationId = await withSupplyChainDb(async (db) => (await db.query<{ id: string }>('SELECT id FROM "WarehouseLocation" WHERE "warehouseId"=$1 AND name=$2', [data.id, locationName])).rows[0]!.id);
  const old = await context.newPage();
  try {
    await old.goto(`/owner/materials/${data.materialId}`);
    const stock = old.locator('#stock-transaction-form');
    await stock.getByLabel('库位', { exact: true }).selectOption(locationId);
    await stock.getByLabel('数量（件）', { exact: true }).fill('2');
    await changeState(page, locationName, '停用库位');
    await expect(page.getByLabel(`${locationName}维护`, { exact: true }).getByRole('button', { name: '启用库位', exact: true })).toBeVisible();
    await stock.getByRole('button', { name: '核对并提交出入库', exact: true }).click();
    await old.getByRole('alertdialog').getByRole('button', { name: '确认提交出入库', exact: true }).click();
    await expect(stock).toContainText('库位或所属仓库已停用');
    await expect(stock.getByLabel('库位', { exact: true })).toHaveValue(locationId);
    await changeState(page, renamed, '停用仓库');
    await expect(page.getByLabel(`${locationName}维护`, { exact: true })).toContainText('请先启用所属仓库，再启用库位');
    await expect(page.getByLabel(`${locationName}维护`, { exact: true }).getByRole('button', { name: '启用库位', exact: true })).toBeDisabled();
    await changeState(page, renamed, '启用仓库');
    await expect(page.getByLabel(`${locationName}维护`, { exact: true }).getByRole('button', { name: '启用库位', exact: true })).toBeVisible();
    await changeState(page, locationName, '启用库位');
    await old.reload();
    await expect(stock.getByLabel('库位', { exact: true }).locator(`option[value="${locationId}"]`)).toContainText(renamed);
    await withSupplyChainDb(async (db) => {
      expect((await db.query('SELECT code FROM "Warehouse" WHERE id=$1', [data.id])).rows[0]!.code).toBe(data.code);
      expect((await db.query('SELECT count(*)::int AS n FROM "MaterialTransaction" WHERE "materialId"=$1', [data.materialId])).rows[0]!.n).toBe(0);
      expect((await db.query('SELECT count(*)::int AS n FROM "BusinessAuditLog" WHERE "entityId"=ANY($1::text[]) AND action=\'WAREHOUSE_MAINTAINED\'', [[data.id, locationId]])).rows[0]!.n).toBe(5);
    });
    expect(errors).toEqual([]);
  } finally { await old.close(); }
});

for (const role of ['sales', 'workerHandPress'] as const) test(`${role} 不能进入仓库维护`, async ({ page }) => {
  await login(page, { username: E2E_USERS[role]!.username, password: E2E_PASSWORD, from: '/owner/warehouses' });
  await expect(page.getByRole('button', { name: '创建仓库', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '保存名称', exact: true })).toHaveCount(0);
});
