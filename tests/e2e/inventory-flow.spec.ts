import Decimal from 'decimal.js';
import { expect, test, type Page } from '@playwright/test';
import { E2E_PASSWORD, login } from './_helpers';
import { inventoryLedger, seedInventoryLedgerFixture } from './release-ledger-fixtures';

type Fixture = Awaited<ReturnType<typeof seedInventoryLedgerFixture>>;

async function stockMovement(page: Page, fixture: Fixture, direction: 'IN' | 'OUT', quantity: string) {
  await page.goto(`/owner/materials/${fixture.materialId}`);
  const form = page.locator('#stock-transaction-form');
  await form.getByLabel('方向', { exact: true }).selectOption(direction);
  await form.getByLabel('库位', { exact: true }).selectOption(fixture.sourceId);
  await form.getByLabel('数量（个）', { exact: true }).fill(quantity);
  await form.getByLabel('原因', { exact: true }).selectOption(direction === 'IN' ? 'RETURN' : 'PRODUCTION_USE');
  await form.getByRole('button', { name: '核对并提交出入库', exact: true }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText(`数量：${quantity} 个`);
  const originalKey = await form.locator('input[name="idempotencyKey"]').inputValue();
  const movementRoute = `**/owner/materials/${fixture.materialId}`;
  let replayed = false;
  await page.route(movementRoute, async (route) => {
    if (replayed || route.request().method() !== 'POST' || !route.request().headers()['next-action']) {
      await route.continue(); return;
    }
    replayed = true;
    // Deliver the same real form request concurrently. A lost response or a
    // double delivery must never create two movements for one confirmation.
    const [first, replay] = await Promise.all([route.fetch(), route.fetch()]);
    expect(first.status()).toBe(200);
    expect(replay.status()).toBe(200);
    await route.fulfill({ response: first });
  });
  try {
    await dialog.getByRole('button', { name: '确认提交出入库', exact: true }).click();
    await expect(form).toContainText('库存已更新');
    await expect(form.locator('input[name="idempotencyKey"]')).not.toHaveValue(originalKey);
    expect(replayed).toBe(true);
  } finally { await page.unroute(movementRoute); }
}

async function submitCount(page: Page, reason: string) {
  await page.getByRole('button', { name: '核对并提交盘点过账（1 条）', exact: true }).click();
  const dialog = page.getByRole('alertdialog');
  // The label includes an aria-hidden required marker. Match the textbox's
  // accessible name, which excludes that marker, instead of raw label text.
  await dialog.getByRole('textbox', { name: '盘点过账原因', exact: true }).fill(reason);
  await dialog.getByRole('button', { name: '确认过账', exact: true }).click();
}

test('库存领退料、调拨重试、盘点冲突与重新盘点保持数量和流水一致', async ({ page, context }) => {
  test.setTimeout(150_000);
  const fixture = await seedInventoryLedgerFixture();
  test.info().annotations.push({ type: 'data-residue', description: `Append-only inventory fixture retained: ${fixture.materialId}` });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await login(page, { username: fixture.admin.username, password: E2E_PASSWORD, from: `/owner/materials/${fixture.materialId}` });

  await stockMovement(page, fixture, 'IN', '100');
  await stockMovement(page, fixture, 'OUT', '20');
  await stockMovement(page, fixture, 'IN', '5');
  let ledger = await inventoryLedger(fixture.materialId);
  expect(ledger.total).toBe('85.00');
  expect(ledger.transactions.map((row) => [row.direction, row.quantity, row.reasonType]))
    .toEqual([['IN', '100.00', 'RETURN'], ['OUT', '20.00', 'PRODUCTION_USE'], ['IN', '5.00', 'RETURN']]);

  await page.goto('/owner/warehouses');
  const transfer = page.locator('#stock-transfer-form');
  await transfer.getByLabel('物料', { exact: true }).selectOption(fixture.materialId);
  await transfer.getByLabel('来源库位', { exact: true }).selectOption(fixture.sourceId);
  await transfer.getByLabel('目标库位', { exact: true }).selectOption(fixture.destinationId);
  await transfer.getByLabel('调拨数量（个）', { exact: true }).fill('15');
  let retried = false;
  await page.route('**/owner/warehouses', async (route) => {
    if (route.request().method() !== 'POST' || !route.request().headers()['next-action'] || retried) {
      await route.continue(); return;
    }
    retried = true;
    // Replay exactly the UI-generated request before the UI receives success
    // and rotates its idempotency key: simulate a lost-response network retry.
    const first = await route.fetch();
    const replay = await route.fetch();
    expect(first.status()).toBe(200);
    expect(replay.status()).toBe(200);
    await route.fulfill({ response: first });
  });
  await transfer.getByRole('button', { name: '确认调拨', exact: true }).click();
  await expect(transfer).toContainText(/调拨单 .+ 已完成/);
  await page.unroute('**/owner/warehouses');
  expect(retried).toBe(true);
  ledger = await inventoryLedger(fixture.materialId);
  expect(ledger.total).toBe('85.00');
  expect(ledger.transfers).toHaveLength(1);
  expect(ledger.transactions.filter((row) => row.stockTransferId)).toHaveLength(2);
  expect(ledger.stocks.find((row) => row.locationId === fixture.sourceId)?.quantity).toBe('70.00');
  expect(ledger.stocks.find((row) => row.locationId === fixture.destinationId)?.quantity).toBe('15.00');

  await page.goto('/owner/materials/count');
  await page.getByRole('textbox', { name: '搜索盘点物料' }).fill(fixture.materialCode);
  await page.locator('#inventory-count-search-form').getByRole('button', { name: '搜索', exact: true }).click();
  const countInput = page.getByRole('textbox', { name: `${fixture.materialName} ${fixture.warehouseName}/来源 实盘数`, exact: true });
  await countInput.fill('80');
  const concurrentPage = await context.newPage();
  try { await stockMovement(concurrentPage, fixture, 'IN', '3'); } finally { await concurrentPage.close(); }
  await submitCount(page, 'E2E 核验并发盘点冲突');
  const countForm = page.locator('#inventory-count-form');
  await expect(countForm).toContainText('盘点过账失败');
  await expect(countForm).toContainText('账面数已变动');
  ledger = await inventoryLedger(fixture.materialId);
  expect(ledger.total).toBe('88.00');
  expect(ledger.counts).toHaveLength(0);
  expect(ledger.transactions.filter((row) => row.inventoryCountItemId)).toHaveLength(0);

  await page.reload();
  await page.getByRole('textbox', { name: '搜索盘点物料' }).fill(fixture.materialCode);
  await page.locator('#inventory-count-search-form').getByRole('button', { name: '搜索', exact: true }).click();
  await countInput.fill('80');
  await submitCount(page, 'E2E 重新盘点实物数量后确认过账');
  await expect(countForm).toContainText('盘点已过账');
  ledger = await inventoryLedger(fixture.materialId);
  expect(ledger.total).toBe('95.00');
  expect(ledger.counts).toHaveLength(1);
  expect(ledger.counts[0]).toMatchObject({ bookQuantity: '73.00', countedQuantity: '80.00', difference: '7.00' });
  expect(ledger.transactions.filter((row) => row.inventoryCountItemId)).toHaveLength(1);
  const stockSum = ledger.stocks.reduce((sum, row) => sum.plus(row.quantity), new Decimal(0));
  const movementSum = ledger.transactions.reduce((sum, row) => row.direction === 'IN'
    ? sum.plus(row.quantity) : sum.minus(row.quantity), new Decimal(0));
  expect(stockSum.toFixed(2)).toBe(ledger.total);
  expect(movementSum.toFixed(2)).toBe(ledger.total);

  await page.goto(`/owner/materials/${fixture.materialId}`);
  const movement = page.locator('#stock-transaction-form');
  const retryKey = await movement.locator('input[name="idempotencyKey"]').inputValue();
  await movement.getByLabel('方向', { exact: true }).selectOption('OUT');
  await movement.getByLabel('库位', { exact: true }).selectOption(fixture.sourceId);
  await movement.getByLabel('数量（个）', { exact: true }).fill('100');
  await movement.getByLabel('原因', { exact: true }).selectOption('PRODUCTION_USE');
  await movement.getByRole('button', { name: '核对并提交出入库', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '确认提交出入库', exact: true }).click();
  await expect(movement).toContainText('库存不足');
  await expect(movement.getByLabel('数量（个）', { exact: true })).toHaveValue('100');
  await expect(movement.getByLabel('库位', { exact: true })).toHaveValue(fixture.sourceId);
  await expect(movement.locator('input[name="idempotencyKey"]')).toHaveValue(retryKey);
  expect(await inventoryLedger(fixture.materialId)).toEqual(ledger);
  expect(errors).toEqual([]);
});
