import { expect, test } from '@playwright/test';
import { E2E_PASSWORD, E2E_USERS, login } from './_helpers';
import { assertSupplyChainIsolation, readPurchaseState, seedPurchasePrerequisites } from './_supply-chain-fixtures';

test.beforeEach(assertSupplyChainIsolation);

test('采购创建 → 部分收货 → 幂等重试 → 拒绝非法取消 → 撤销收货 → 取消采购', async ({ page, context }) => {
  test.setTimeout(90_000);
  const fixture = await seedPurchasePrerequisites();
  await login(page, { from: '/owner/purchases/new', username: E2E_USERS.owner!.username, password: E2E_PASSWORD });
  await page.getByLabel('供应商', { exact: true }).selectOption(fixture.supplierId);
  await page.getByRole('combobox', { name: '物料', exact: true }).selectOption(fixture.materialId);
  await page.getByLabel('采购数量', { exact: true }).fill('100');
  await page.getByLabel('单位成本（选填）', { exact: true }).fill('2.1250');
  await page.getByRole('button', { name: '创建采购单', exact: true }).click();
  await page.waitForURL(/\/owner\/purchases\/(?!new$)[a-z0-9_-]+$/i);
  const purchaseOrderId = new URL(page.url()).pathname.split('/').at(-1)!;
  const initial = await readPurchaseState(purchaseOrderId, fixture.materialId);
  expect(initial.order?.status).toBe('ORDERED');
  expect(initial.items).toEqual([{ quantity: '100.00', receivedQuantity: '0.00' }]);
  expect(initial.stock).toBe('0.00');

  // Preserve a legitimately loaded cancellation form so the later attempt
  // tests the server state guard, not merely the UI hiding a forbidden button.
  const stalePage = await context.newPage();
  await stalePage.goto(page.url());
  await expect(stalePage.getByRole('button', { name: '取消采购单', exact: true })).toBeVisible();
  try {
    await test.step('部分收货要经过确认；确认前无入库，重试不重复入库', async () => {
      await page.getByLabel('收货库位', { exact: true }).selectOption(fixture.locationId);
      await page.getByLabel('本次收货数量（件）', { exact: true }).fill('40');
      await page.getByRole('button', { name: '核对并确认收货过账', exact: true }).click();
      const confirmation = page.getByRole('alertdialog');
      await expect(confirmation).toBeVisible();
      expect((await readPurchaseState(purchaseOrderId, fixture.materialId)).receipts).toHaveLength(0);
      const submitted = page.waitForRequest((request) => request.method() === 'POST' && new URL(request.url()).pathname === `/owner/purchases/${purchaseOrderId}`);
      await confirmation.getByRole('button', { name: '收货过账', exact: true }).click();
      const receiptRequest = await submitted;
      await expect(page.getByText('✓ 采购收货已过账', { exact: true })).toBeVisible();
      const received = await readPurchaseState(purchaseOrderId, fixture.materialId);
      expect(received.order?.status).toBe('PARTIALLY_RECEIVED');
      expect(received.items).toEqual([{ quantity: '100.00', receivedQuantity: '40.00' }]);
      expect(received.receipts).toHaveLength(1);
      expect(received.receipts[0]?.status).toBe('POSTED');
      expect(received.stock).toBe('40.00');
      expect(received.locationStocks).toEqual([{ locationId: fixture.locationId, currentStock: '40.00' }]);
      expect(received.transactions).toHaveLength(1);
      expect(received.transactions[0]).toMatchObject({ direction: 'IN', quantity: '40.00', reasonType: 'PURCHASE_RECEIPT' });
      const replay = await page.request.fetch(receiptRequest);
      expect(replay.status()).toBe(200);
      await replay.dispose();
      expect(await readPurchaseState(purchaseOrderId, fixture.materialId)).toEqual(received);
    });

    await test.step('旧页面仍不能取消已经收货的采购单', async () => {
      const before = await readPurchaseState(purchaseOrderId, fixture.materialId);
      await stalePage.getByRole('button', { name: '取消采购单', exact: true }).click();
      await stalePage.getByRole('alertdialog').getByRole('button', { name: '取消采购单', exact: true }).click();
      await expect(stalePage.getByText('已有入库记录的采购单不能直接取消，请先取消入库单', { exact: true })).toBeVisible();
      expect(await readPurchaseState(purchaseOrderId, fixture.materialId)).toEqual(before);
    });

    await test.step('取消收货必须填写原因，以反向流水抵销库存并保留原单据', async () => {
      await page.getByRole('button', { name: '取消收货过账', exact: true }).click();
      const confirmation = page.getByRole('alertdialog');
      const submit = confirmation.getByRole('button', { name: '取消并反向出库', exact: true });
      await expect(submit).toBeDisabled();
      await confirmation.getByRole('textbox', { name: /^取消理由/u }).fill('供应商送错物料，已退回');
      await submit.click();
      await expect(page.getByText('取消原因：供应商送错物料，已退回', { exact: true })).toBeVisible();
      const reversed = await readPurchaseState(purchaseOrderId, fixture.materialId);
      expect(reversed.order?.status).toBe('ORDERED');
      expect(reversed.stock).toBe('0.00');
      expect(reversed.items[0]?.receivedQuantity).toBe('0.00');
      expect(reversed.receipts).toHaveLength(1);
      expect(reversed.receipts[0]).toMatchObject({ status: 'CANCELLED', cancelReason: '供应商送错物料，已退回' });
      expect(reversed.transactions).toHaveLength(2);
      expect(reversed.transactions.map(({ direction, quantity, reasonType }) => ({ direction, quantity, reasonType }))).toEqual([
        { direction: 'IN', quantity: '40.00', reasonType: 'PURCHASE_RECEIPT' },
        { direction: 'OUT', quantity: '40.00', reasonType: 'PURCHASE_RECEIPT_CANCEL' },
      ]);
      expect(new Set(reversed.transactions.map((row) => row.purchaseReceiptItemId)).size).toBe(1);
      expect(reversed.locationStocks).toEqual([{ locationId: fixture.locationId, currentStock: '0.00' }]);
    });

    await test.step('已无有效收货时允许取消采购，重复取消保持原库存历史', async () => {
      await page.getByRole('button', { name: '取消采购单', exact: true }).click();
      const submitted = page.waitForRequest((request) => request.method() === 'POST' && new URL(request.url()).pathname === `/owner/purchases/${purchaseOrderId}`);
      await page.getByRole('alertdialog').getByRole('button', { name: '取消采购单', exact: true }).click();
      const cancelRequest = await submitted;
      await expect(page.getByRole('button', { name: '取消采购单', exact: true })).toHaveCount(0);
      const cancelled = await readPurchaseState(purchaseOrderId, fixture.materialId);
      expect(cancelled.order?.status).toBe('CANCELLED');
      expect(cancelled.receipts).toHaveLength(1);
      expect(cancelled.transactions).toHaveLength(2);
      const replay = await page.request.fetch(cancelRequest);
      expect(replay.status()).toBe(200);
      await replay.dispose();
      expect(await readPurchaseState(purchaseOrderId, fixture.materialId)).toEqual(cancelled);
    });
  } finally {
    await stalePage.close();
  }
});

test('销售角色不能进入采购写入页面', async ({ page }) => {
  await login(page, { username: E2E_USERS.sales!.username, password: E2E_PASSWORD });
  await page.goto('/owner/purchases/new');
  await expect(page).not.toHaveURL(/\/owner\/purchases/);
  await expect(page.getByRole('button', { name: '创建采购单', exact: true })).toHaveCount(0);
});
