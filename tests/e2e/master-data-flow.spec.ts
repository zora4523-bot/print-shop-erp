import { expect, test, type Page } from '@playwright/test';
import { E2E_PASSWORD, login } from './_helpers';
import { assertActivatedE2eDatabase } from '../../scripts/lib/e2e-environment';
import {
  readBomVersions,
  readMasterRow,
  readPartyState,
  readProductStatusAudits,
  readPurchaseSupplierSnapshot,
  seedMasterDataAdmin,
} from './master-data-fixtures';

const categories = '/owner/rules/product-categories';
const papers = '/owner/rules/papers';
const products = '/owner/rules/stock-skus';
const crafts = '/owner/rules/crafts';

test.use({ actionTimeout: 15_000, navigationTimeout: 30_000 });
test.beforeEach(() => { assertActivatedE2eDatabase(); });

async function createdId(page: Page, base: string): Promise<string> {
  await expect(page).toHaveURL((url) => url.pathname.startsWith(`${base}/`) && !url.pathname.endsWith('/new'));
  const id = new URL(page.url()).pathname.split('/').at(-1);
  if (!id) throw new Error(`Missing created id for ${base}`);
  return id;
}

async function confirmState(page: Page, action: string, beforeConfirm?: () => Promise<void>) {
  await page.getByRole('button', { name: action, exact: true }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible();
  await beforeConfirm?.();
  await dialog.getByRole('button', { name: action, exact: true }).click();
  await expect(dialog).toBeHidden();
}

async function createPaper(page: Page, name: string) {
  await page.goto(`${papers}/new`);
  await page.getByLabel('物料名称', { exact: true }).fill(name);
  await page.getByLabel('规格（选填）', { exact: true }).fill('验收专用 210×297');
  await page.getByLabel('单位', { exact: true }).fill('张');
  await page.getByRole('button', { name: '创建物料', exact: true }).click();
  return createdId(page, papers);
}

async function createCategory(page: Page, name: string, parentId?: string) {
  await page.goto(`${categories}/new`);
  if (parentId) await page.getByLabel('上级分类', { exact: true }).selectOption(parentId);
  await page.getByLabel('分类名', { exact: true }).fill(name);
  await page.getByLabel('适用计价方式', { exact: true }).selectOption('BLANK_STOCK');
  await page.getByLabel('排序', { exact: true }).fill('17');
  await page.getByRole('button', { name: '创建分类', exact: true }).click();
  return createdId(page, categories);
}

async function fillBom(page: Page, productId: string, materialId: string, name: string, version: number) {
  await page.goto('/owner/boms/new');
  await page.getByLabel('建单产品', { exact: true }).selectOption(productId);
  await page.getByLabel('BOM 名称', { exact: true }).fill(name);
  await page.getByLabel('版本号', { exact: true }).fill(String(version));
  await page.getByLabel('基准产量', { exact: true }).fill('10');
  await page.locator('select[name="items.0.materialId"]').selectOption(materialId);
  await page.locator('input[name="items.0.quantity"]').fill(version === 1 ? '12.5000' : '13.2500');
  await page.locator('input[name="items.0.remark"]').fill('隔离验收用料');
}

test('账号创建、修改、重置密码与停用生效，既有会话不能继续登录', async ({ page, browser }) => {
  test.setTimeout(90_000);
  const actor = await seedMasterDataAdmin();
  const username = `e2e-account-${actor.suffix}`;
  await login(page, { username: actor.username, password: E2E_PASSWORD, from: '/owner/accounts/new' });
  await page.getByLabel('用户名', { exact: true }).fill(username);
  await page.getByLabel('初始密码', { exact: true }).fill(E2E_PASSWORD);
  await page.getByLabel('姓名', { exact: true }).fill(`验收账号${actor.suffix}`);
  await page.getByLabel('角色', { exact: true }).selectOption('SALES');
  await page.getByRole('button', { name: '创建账号', exact: true }).click();
  const accountId = await createdId(page, '/owner/accounts');
  const original = await readMasterRow('account', accountId);
  expect(original).toMatchObject({ username, role: 'SALES', isActive: true });
  await test.step('大小写不同的重复用户名返回字段错误，原账号保持不变', async () => {
    await page.goto('/owner/accounts/new');
    await page.getByLabel('用户名', { exact: true }).fill(username.toUpperCase());
    await page.getByLabel('初始密码', { exact: true }).fill(E2E_PASSWORD);
    await page.getByLabel('姓名', { exact: true }).fill('不应创建的重复账号');
    await page.getByRole('button', { name: '创建账号', exact: true }).click();
    await expect(page.locator('main')).toContainText('该用户名已被占用');
    await expect(page.getByLabel('用户名', { exact: true })).toHaveAttribute('aria-invalid', 'true');
    await expect(page).toHaveURL(/\/owner\/accounts\/new$/);
    expect(await readMasterRow('account', accountId)).toEqual(original);
  });
  await page.goto(`/owner/accounts/${accountId}`);
  // Username is an identity: the edit UI only changes the business profile.
  await expect(page.getByLabel('用户名', { exact: true })).toHaveCount(0);
  await page.getByLabel('姓名', { exact: true }).fill(`已修改账号${actor.suffix}`);
  await page.getByLabel('电话（选填）', { exact: true }).fill('13800001234');
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  await expect.poll(() => readMasterRow('account', accountId)).toMatchObject({
    username, displayName: `已修改账号${actor.suffix}`, phone: '13800001234', isActive: true,
  });
  const newPassword = `E2e-reset-${actor.suffix}-only`;
  await page.getByLabel('新密码', { exact: true }).fill(newPassword);
  await page.getByRole('button', { name: '重置密码', exact: true }).click();
  await expect(page.getByText('密码已重置', { exact: true })).toBeVisible();
  const userContext = await browser.newContext({ baseURL: new URL(page.url()).origin });
  const userPage = await userContext.newPage();
  try {
    await login(userPage, { username, password: newPassword, from: '/orders' });
    await confirmState(page, '停用账号', async () => {
      expect((await readMasterRow('account', accountId))?.isActive).toBe(true);
    });
    await expect.poll(() => readMasterRow('account', accountId)).toMatchObject({
      username, isActive: false, createdAt: original?.createdAt,
    });
    await userPage.goto('/orders');
    await expect(userPage).toHaveURL(/\/login(?:\?|$)/);
    await userPage.getByLabel('用户名', { exact: true }).fill(username);
    await userPage.getByLabel('密码', { exact: true }).fill(newPassword);
    await userPage.getByRole('button', { name: /登录|登 录/ }).click();
    await expect(userPage.getByText('用户名或密码错误', { exact: true })).toBeVisible();
    await expect(userPage).toHaveURL(/\/login(?:\?|$)/);
    await confirmState(page, '激活账号');
    await expect.poll(() => readMasterRow('account', accountId)).toMatchObject({ isActive: true });
    await userContext.clearCookies();
    await login(userPage, { username, password: newPassword, from: '/orders' });
  } finally { await userContext.close(); }
});

test('客户及供应商维护、停用过滤和已创建采购快照保持一致', async ({ page, context }) => {
  test.setTimeout(120_000);
  const actor = await seedMasterDataAdmin();
  await login(page, { username: actor.username, password: E2E_PASSWORD, from: '/owner/parties/new' });
  await page.getByLabel('类型', { exact: true }).selectOption('CUSTOMER');
  await page.getByLabel('名称', { exact: true }).fill(`验收客户${actor.suffix}`);
  await page.getByLabel('联系人', { exact: true }).fill('验收联系人');
  await page.getByLabel('联系电话', { exact: true }).fill('13800001234');
  await page.getByLabel('收货人', { exact: true }).fill('验收收货人');
  await page.getByLabel('详细地址', { exact: true }).fill('隔离测试地址 1 号');
  await page.getByRole('button', { name: '创建客户/供应商', exact: true }).click();
  const customerId = await createdId(page, '/owner/parties');
  await page.getByLabel('简称（选填）', { exact: true }).fill(`客户简称${actor.suffix}`);
  await page.getByLabel('详细地址', { exact: true }).fill('隔离测试地址 2 号');
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  await expect.poll(() => readPartyState(customerId)).toMatchObject({
    party: { type: 'CUSTOMER', shortName: `客户简称${actor.suffix}` },
    contacts: [{ name: '验收联系人', phone: '13800001234', isPrimary: true }],
    addresses: [{ detail: '隔离测试地址 2 号', isDefault: true }],
  });
  const customer = await readPartyState(customerId);
  await page.goto('/orders/new');
  await expect(page.locator(`#customerPartyId option[value="${customerId}"]`)).toHaveCount(1);
  await page.getByLabel('关联客户（选填）', { exact: true }).selectOption(customerId);
  await expect(page.getByLabel('客户名称/简称', { exact: true })).toHaveValue(`客户简称${actor.suffix}`);
  await page.goto(`/owner/parties/${customerId}`);
  await confirmState(page, '停用客户/供应商');
  await expect.poll(() => readPartyState(customerId)).toMatchObject({ party: { isActive: false } });
  const disabledCustomer = await readPartyState(customerId);
  expect(disabledCustomer.contacts).toEqual(customer.contacts);
  expect(disabledCustomer.addresses).toEqual(customer.addresses);
  await page.goto('/orders/new');
  await expect(page.locator(`#customerPartyId option[value="${customerId}"]`)).toHaveCount(0);

  const paperId = await createPaper(page, `采购验收纸${actor.suffix}`);
  await page.goto('/owner/parties/new?type=SUPPLIER');
  await page.getByLabel('名称', { exact: true }).fill(`验收供应商${actor.suffix}`);
  await page.getByRole('button', { name: '创建客户/供应商', exact: true }).click();
  const supplierId = await createdId(page, '/owner/parties');
  const supplier = await readPartyState(supplierId);
  expect(supplier.party).toMatchObject({ type: 'SUPPLIER', isActive: true });
  await page.goto('/owner/purchases/new');
  await page.getByLabel('供应商', { exact: true }).selectOption(supplierId);
  await page.getByRole('combobox', { name: '物料', exact: true }).selectOption(paperId);
  await page.getByLabel('采购数量', { exact: true }).fill('10');
  await page.getByRole('button', { name: '创建采购单', exact: true }).click();
  const purchaseId = await createdId(page, '/owner/purchases');
  const purchaseSnapshot = await readPurchaseSupplierSnapshot(purchaseId);
  expect(purchaseSnapshot).toMatchObject({ supplierPartyId: supplierId, supplierName: supplier.party.name, status: 'ORDERED' });
  const stale = await context.newPage();
  try {
    await stale.goto('/owner/purchases/new');
    await stale.getByLabel('供应商', { exact: true }).selectOption(supplierId);
    await stale.getByRole('combobox', { name: '物料', exact: true }).selectOption(paperId);
    await stale.getByLabel('采购数量', { exact: true }).fill('5');
    await page.goto(`/owner/parties/${supplierId}`);
    await page.getByLabel('名称', { exact: true }).fill(`已改名供应商${actor.suffix}`);
    await page.getByRole('button', { name: '保存修改', exact: true }).click();
    await expect.poll(() => readPartyState(supplierId)).toMatchObject({ party: { name: `已改名供应商${actor.suffix}` } });
    await page.getByLabel('类型', { exact: true }).selectOption('CUSTOMER');
    await page.getByRole('button', { name: '保存修改', exact: true }).click();
    await expect(page.getByText('该主数据已有采购单关联，不能移除供应商类型；可改为“客户/供应商”', { exact: true })).toBeVisible();
    expect((await readPartyState(supplierId)).party.type).toBe('SUPPLIER');
    await confirmState(page, '停用客户/供应商');
    await expect.poll(() => readPartyState(supplierId)).toMatchObject({ party: { isActive: false } });
    await stale.getByRole('button', { name: '创建采购单', exact: true }).click();
    await expect(stale.getByText('供应商已停用', { exact: true })).toBeVisible();
    await expect(stale).toHaveURL(/\/owner\/purchases\/new$/);
    await page.goto('/owner/purchases/new');
    await expect(page.locator(`#supplierPartyId option[value="${supplierId}"]`)).toHaveCount(0);
    expect(await readPurchaseSupplierSnapshot(purchaseId)).toEqual(purchaseSnapshot);
    await page.goto(`/owner/purchases/${purchaseId}`);
    await expect(page.locator('main')).toContainText(supplier.party.name);
  } finally { await stale.close(); }
});

test('工艺创建和修改保留编号，停用后新工单不可选择，启用后恢复', async ({ page }) => {
  test.setTimeout(90_000);
  const actor = await seedMasterDataAdmin();
  const name = `验收工艺${actor.suffix}`;
  await login(page, { username: actor.username, password: E2E_PASSWORD, from: `${crafts}/new` });
  await page.getByLabel('工艺名', { exact: true }).fill(name);
  await page.getByRole('checkbox', { name: /^外协工艺/ }).check();
  await page.getByLabel('排序', { exact: true }).fill('19');
  await page.getByRole('button', { name: '创建工艺', exact: true }).click();
  const craftId = await createdId(page, crafts);
  const original = await readMasterRow('craft', craftId);
  expect(original).toMatchObject({ name, isOutsource: true, isActive: true });
  const newName = `${name}修订`;
  await page.getByLabel('工艺名', { exact: true }).fill(newName);
  await page.getByLabel('排序', { exact: true }).fill('20');
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  await expect.poll(() => readMasterRow('craft', craftId)).toMatchObject({ name: newName, code: original?.code, sortOrder: 20 });
  await page.goto('/orders/new');
  await expect(page.getByRole('checkbox', { name: new RegExp(`^${newName} · 外协`) })).toBeVisible();
  await page.goto(`${crafts}/${craftId}`);
  await confirmState(page, '停用工艺', async () => {
    expect((await readMasterRow('craft', craftId))?.isActive).toBe(true);
  });
  await expect.poll(() => readMasterRow('craft', craftId)).toMatchObject({ isActive: false, code: original?.code });
  await page.goto('/orders/new');
  await expect(page.getByRole('checkbox', { name: new RegExp(`^${newName} · 外协`) })).toHaveCount(0);
  await page.goto(`${crafts}/${craftId}`);
  await confirmState(page, '启用工艺');
  await expect.poll(() => readMasterRow('craft', craftId)).toMatchObject({ isActive: true });
  await page.goto('/orders/new');
  await expect(page.getByRole('checkbox', { name: new RegExp(`^${newName} · 外协`) })).toBeVisible();
});

test('类别、纸张、SKU 与 BOM 按不可变边界维护，停用保留明细并阻止下游新选择', async ({ page }) => {
  test.setTimeout(180_000);
  const actor = await seedMasterDataAdmin();
  await login(page, { username: actor.username, password: E2E_PASSWORD, from: `${categories}/new` });
  const parentId = await createCategory(page, `验收父分类${actor.suffix}`);
  const categoryId = await createCategory(page, `验收子分类${actor.suffix}`, parentId);
  const originalCategory = await readMasterRow('category', categoryId);
  const parent = await readMasterRow('category', parentId);
  expect(String(originalCategory?.path).startsWith(`${parent?.path}.`)).toBe(true);
  await expect(page.getByLabel('上级分类', { exact: true })).toHaveCount(0);
  await page.getByLabel('分类名', { exact: true }).fill(`已改名分类${actor.suffix}`);
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  await expect.poll(() => readMasterRow('category', categoryId)).toMatchObject({ name: `已改名分类${actor.suffix}`, path: originalCategory?.path });

  const paperId = await createPaper(page, `验收纸张${actor.suffix}`);
  const paperName = `已改名纸张${actor.suffix}`;
  await expect(page.getByLabel('单位', { exact: true })).toBeDisabled();
  await page.getByLabel('物料名称', { exact: true }).fill(paperName);
  await page.getByLabel('安全库存（选填）', { exact: true }).fill('2.25');
  await page.getByLabel('参考平均成本（手工维护，选填）', { exact: true }).fill('1.2345');
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  await expect.poll(() => readMasterRow('paper', paperId)).toMatchObject({ name: paperName, category: 'PAPER', unit: '张', safetyStock: '2.25', averageCost: '1.2345', currentStock: '0.00' });

  await page.goto(`${products}/new`);
  await page.getByLabel('产品结构分类', { exact: true }).selectOption(categoryId);
  await page.getByLabel('组合名称', { exact: true }).fill(`验收组合${actor.suffix}`);
  await page.getByLabel('纸张（选填）', { exact: true }).fill(paperName);
  await page.getByLabel('规格（选填）', { exact: true }).fill('验收中号');
  await page.getByRole('button', { name: '创建组合', exact: true }).click();
  const productId = await createdId(page, products);
  await page.getByLabel('组合名称', { exact: true }).fill(`已改名组合${actor.suffix}`);
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  await expect.poll(() => readMasterRow('product', productId)).toMatchObject({ name: `已改名组合${actor.suffix}`, categoryNodeId: categoryId, paperType: paperName });

  await fillBom(page, productId, paperId, `验收用料${actor.suffix}第一版`, 1);
  await page.getByRole('button', { name: '创建 BOM', exact: true }).click();
  const bom1 = await createdId(page, '/owner/boms');
  await expect(page.getByRole('button', { name: '保存修改', exact: true })).toHaveCount(0);
  const initialBom = (await readBomVersions(productId))[0];
  expect(initialBom).toMatchObject({ id: bom1, version: 1, baseQuantity: 10, isActive: true, items: [{ materialId: paperId, quantity: '12.5000', remark: '隔离验收用料' }] });
  await fillBom(page, productId, paperId, `验收用料${actor.suffix}第二版`, 2);
  await page.getByRole('button', { name: '创建 BOM', exact: true }).click();
  await expect(page.locator('main')).toContainText('该产品已有启用 BOM');
  expect(await readBomVersions(productId)).toEqual([initialBom]);
  await page.goto(`/owner/boms/${bom1}`);
  await confirmState(page, '停用BOM');
  await expect.poll(() => readBomVersions(productId)).toMatchObject([{ isActive: false }]);
  await fillBom(page, productId, paperId, `验收用料${actor.suffix}第二版`, 2);
  await page.getByRole('button', { name: '创建 BOM', exact: true }).click();
  const bom2 = await createdId(page, '/owner/boms');
  const versions = await readBomVersions(productId);
  expect(versions).toHaveLength(2);
  expect(versions[0]).toEqual({ ...initialBom, isActive: false });
  expect(versions[1]).toMatchObject({ id: bom2, version: 2, isActive: true, items: [{ materialId: paperId, quantity: '13.2500' }] });
  await page.goto(`/owner/boms/${bom1}`);
  await confirmState(page, '启用BOM');
  await expect(page.getByText('该产品已有启用 BOM', { exact: true })).toBeVisible();
  expect(await readBomVersions(productId)).toEqual(versions);

  await page.goto(`${papers}/${paperId}`);
  const paperBeforeDisable = await readMasterRow('paper', paperId);
  await confirmState(page, '停用物料');
  await expect.poll(() => readMasterRow('paper', paperId)).toEqual({ ...paperBeforeDisable, isActive: false });
  await page.goto('/owner/boms/new');
  await expect(page.locator(`select[name="items.0.materialId"] option[value="${paperId}"]`)).toHaveCount(0);
  await page.goto(`/owner/boms/${bom2}`);
  await expect(page.getByRole('region', { name: 'BOM 物料明细', exact: true })).toContainText(paperName);
  await expect(page.getByRole('region', { name: 'BOM 物料明细', exact: true })).toContainText('已停用');

  await page.goto(`${products}/${productId}`);
  await page.getByRole('button', { name: '停用组合', exact: true }).click();
  const productDialog = page.getByRole('alertdialog');
  const deactivate = productDialog.getByRole('button', { name: '确认停用', exact: true });
  await expect(deactivate).toBeDisabled();
  expect((await readMasterRow('product', productId))?.isActive).toBe(true);
  const reason = '隔离验收停用旧组合，保留 BOM 历史';
  await productDialog.getByRole('textbox', { name: '停用理由', exact: true }).fill(reason);
  await deactivate.click();
  await expect.poll(() => readMasterRow('product', productId)).toMatchObject({ isActive: false });
  expect(await readProductStatusAudits(productId)).toEqual([expect.objectContaining({
    action: 'PRODUCT_DEACTIVATE', actorUsername: actor.username,
    before: { isActive: true }, after: { isActive: false },
    requestMetadata: expect.objectContaining({ reason }),
  })]);
  await page.goto('/owner/boms/new');
  await expect(page.locator(`#productId option[value="${productId}"]`)).toHaveCount(0);

  await page.goto(`${categories}/${categoryId}`);
  await confirmState(page, '停用分类');
  await expect.poll(() => readMasterRow('category', categoryId)).toMatchObject({ isActive: false, path: originalCategory?.path });
  await page.goto(`${products}/new`);
  await expect(page.locator(`#categoryNodeId option[value="${categoryId}"]`)).toHaveCount(0);
  await page.goto('/owner/boms/new');
  await page.getByLabel('适用对象', { exact: true }).selectOption('CATEGORY');
  await expect(page.locator(`#categoryNodeId option[value="${categoryId}"]`)).toHaveCount(0);
  expect(await readBomVersions(productId)).toEqual(versions);
});
