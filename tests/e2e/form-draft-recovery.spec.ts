import { randomUUID } from 'node:crypto';
import { expect, test, type Page, type Route } from '@playwright/test';
import { E2E_PASSWORD, E2E_USERS, login } from './_helpers';
import { assertSupplyChainIsolation, seedPurchasePrerequisites, withSupplyChainDb } from './_supply-chain-fixtures';
import { detachedActionHeaders } from './_action-replay';

test.beforeEach(assertSupplyChainIsolation);

const owner = { username: E2E_USERS.owner!.username, password: E2E_PASSWORD };
async function fillPurchase(page: Page, supplierId: string, materialId: string) {
  await page.getByLabel('供应商', { exact: true }).selectOption(supplierId);
  await page.getByRole('combobox', { name: '物料', exact: true }).selectOption(materialId);
  await page.getByLabel('采购数量', { exact: true }).fill('123');
  await page.getByLabel('单位成本（选填）', { exact: true }).fill('2.5');
  await page.getByLabel('预计到货日（选填）', { exact: true }).fill('2026-10-01');
  await page.getByLabel('备注（选填）', { exact: true }).fill('跨页后保留这条备注');
}
async function assertPurchase(page: Page) {
  await expect(page.getByLabel('采购数量', { exact: true })).toHaveValue('123');
  await expect(page.getByLabel('单位成本（选填）', { exact: true })).toHaveValue('2.5');
  await expect(page.getByLabel('预计到货日（选填）', { exact: true })).toHaveValue('2026-10-01');
  await expect(page.getByLabel('备注（选填）', { exact: true })).toHaveValue('跨页后保留这条备注');
}
async function createSupplementMaterial(page: Page, name: string) {
  await expect(page.getByRole('heading', { name: '新建物料', exact: true })).toBeVisible();
  await page.getByLabel('分类', { exact: true }).selectOption('OTHER');
  await page.getByLabel('物料名称', { exact: true }).fill(name);
  await page.getByLabel('单位', { exact: true }).fill('件');
  await page.getByRole('button', { name: '创建物料', exact: true }).click();
}

test('采购补物料与供应商后恢复全部字段，真实保存并清理草稿', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const fixture = await seedPurchasePrerequisites();
  const materialName = `跨页物料 ${randomUUID()}`;
  const supplierName = `跨页供应商 ${randomUUID()}`;
  await login(page, { ...owner, from: '/owner/purchases/new' });
  await fillPurchase(page, fixture.supplierId, fixture.materialId);
  const requestId = await page.locator('input[name="clientRequestId"]').inputValue();
  await page.getByRole('link', { name: '新建物料', exact: true }).click();
  await createSupplementMaterial(page, materialName);
  await assertPurchase(page);
  await expect(page.getByRole('combobox', { name: '物料', exact: true }).locator('option:checked')).toContainText(materialName);
  const materialId = await page.getByRole('combobox', { name: '物料', exact: true }).inputValue();
  await page.getByRole('link', { name: '新建供应商', exact: true }).click();
  await page.getByLabel('名称', { exact: true }).fill(supplierName);
  await page.getByRole('button', { name: '创建客户/供应商', exact: true }).click();
  await assertPurchase(page);
  await expect(page.getByLabel('供应商', { exact: true }).locator('option:checked')).toContainText(supplierName);
  await expect(page.locator('input[name="clientRequestId"]')).toHaveValue(requestId);
  await page.getByRole('button', { name: '创建采购单', exact: true }).click();
  await expect(page).toHaveURL(/\/owner\/purchases\/(?!new)[a-z0-9_-]+$/i);
  const id = new URL(page.url()).pathname.split('/').at(-1)!;
  await withSupplyChainDb(async (db) => {
    const rows = await db.query('SELECT p.remark,i.quantity::text,i."unitCost"::text,i."materialId",r."clientRequestId"::text FROM "PurchaseOrder" p JOIN "PurchaseOrderItem" i ON i."purchaseOrderId"=p.id JOIN "FormCreationRequest" r ON r."purchaseOrderId"=p.id WHERE p.id=$1', [id]);
    expect(rows.rows).toEqual([{ remark: '跨页后保留这条备注', quantity: '123.00', unitCost: '2.5000', materialId, clientRequestId: requestId }]);
  });
  await expect.poll(() => page.evaluate(() => Object.keys(sessionStorage).filter((key) => key.startsWith('erp:form-draft:') && !key.endsWith(':complete')).length)).toBe(0);
  expect(errors).toEqual([]);
});

test('BOM 删除首行后补物料与分类，稳定回填第二行并真实保存 22', async ({ page }) => {
  test.setTimeout(90_000);
  const fixture = await seedPurchasePrerequisites();
  const materialName = `BOM 补料 ${randomUUID()}`;
  const categoryName = `BOM 补分类 ${randomUUID()}`;
  await login(page, { ...owner, from: '/owner/boms/new' });
  await page.getByLabel('BOM 名称', { exact: true }).fill('两行回填回归');
  await page.getByLabel('适用对象', { exact: true }).selectOption('CATEGORY');
  await page.locator('[name="items.0.materialId"]').selectOption(fixture.materialId);
  await page.locator('[name="items.0.quantity"]').fill('11');
  await page.getByRole('button', { name: '添加物料', exact: true }).click();
  await page.locator('[name="items.1.quantity"]').fill('22');
  await page.locator('[name="items.1.remark"]').fill('第二行备注');
  await page.getByRole('button', { name: '删除', exact: true }).first().click();
  await page.getByRole('link', { name: '新建物料', exact: true }).click();
  await createSupplementMaterial(page, materialName);
  await expect(page.locator('[name="items.0.quantity"]')).toHaveValue('22');
  await expect(page.locator('[name="items.0.remark"]')).toHaveValue('第二行备注');
  await expect(page.locator('[name="items.0.materialId"] option:checked')).toContainText(materialName);
  await page.getByRole('link', { name: '新建分类', exact: true }).click();
  await page.getByLabel('分类名', { exact: true }).fill(categoryName);
  await page.getByRole('button', { name: '创建分类', exact: true }).click();
  await expect(page.getByLabel('BOM 名称', { exact: true })).toHaveValue('两行回填回归');
  await expect(page.getByLabel('产品结构分类', { exact: true }).locator('option:checked')).toContainText(categoryName);
  await page.getByRole('button', { name: '创建 BOM', exact: true }).click();
  await expect(page).toHaveURL(/\/owner\/boms\/(?!new)[a-z0-9_-]+$/i);
  const id = new URL(page.url()).pathname.split('/').at(-1)!;
  await withSupplyChainDb(async (db) => {
    const result = await db.query('SELECT b.name,i.quantity::text,i.remark,m.name AS material FROM "BillOfMaterial" b JOIN "BillOfMaterialItem" i ON i."bomId"=b.id JOIN "Material" m ON m.id=i."materialId" WHERE b.id=$1', [id]);
    expect(result.rows).toEqual([{ name: '两行回填回归', quantity: '22.0000', remark: '第二行备注', material: materialName }]);
  });
});

test('校验失败、取消和刷新均保留输入；普通重访要明确续填', async ({ page }) => {
  const fixture = await seedPurchasePrerequisites();
  await login(page, { ...owner, from: '/owner/purchases/new' });
  await fillPurchase(page, fixture.supplierId, fixture.materialId);
  await page.getByLabel('采购数量', { exact: true }).fill('0.');
  await page.getByRole('button', { name: '创建采购单', exact: true }).click();
  await expect(page.getByText('数量格式错误（整数部分最多 10 位、小数最多 2 位、非负数）', { exact: true })).toBeVisible();
  await expect(page.getByLabel('采购数量', { exact: true })).toHaveValue('0.');
  await page.getByRole('link', { name: '新建物料', exact: true }).click();
  await page.getByRole('link', { name: '返回原录入', exact: true }).first().click();
  await expect(page.getByLabel('采购数量', { exact: true })).toHaveValue('0.');
  const requestId = await page.locator('input[name="clientRequestId"]').inputValue();
  await page.reload();
  await page.getByRole('button', { name: '继续上次录入', exact: true }).click();
  await expect(page.getByLabel('采购数量', { exact: true })).toHaveValue('0.');
  await expect(page.locator('input[name="clientRequestId"]')).toHaveValue(requestId);
});

test('sessionStorage 不可用时留在原页，补资料新标签无 opener，刷新选项不重置', async ({ page, context }) => {
  await page.addInitScript(() => { Storage.prototype.setItem = function () { throw new DOMException('unavailable', 'QuotaExceededError'); }; });
  const fixture = await seedPurchasePrerequisites();
  await login(page, { ...owner, from: '/owner/purchases/new' });
  await fillPurchase(page, fixture.supplierId, fixture.materialId);
  await page.getByRole('link', { name: '新建物料', exact: true }).click();
  await expect(page).toHaveURL(/\/owner\/purchases\/new$/);
  const popupPromise = context.waitForEvent('page');
  await page.getByRole('link', { name: '在新标签页补充资料', exact: true }).click();
  const popup = await popupPromise;
  try { await expect(popup.getByRole('heading', { name: '新建物料', exact: true })).toBeVisible(); expect(await popup.evaluate(() => window.opener === null)).toBe(true); }
  finally { await popup.close(); }
  await page.getByRole('button', { name: '更新可选资料', exact: true }).click();
  await assertPurchase(page);
});

test('旧会话返回需明确续填，换账号后清理旧账号暂存', async ({ page, context }) => {
  const fixture = await seedPurchasePrerequisites();
  await login(page, { ...owner, from: '/owner/purchases/new' });
  await fillPurchase(page, fixture.supplierId, fixture.materialId);
  const requestId = await page.locator('input[name="clientRequestId"]').inputValue();
  await page.getByRole('link', { name: '新建物料', exact: true }).click();
  const returnHref = await page.getByRole('link', { name: '返回原录入', exact: true }).first().getAttribute('href');
  await context.clearCookies();
  await login(page, { ...owner, from: returnHref! });
  await expect(page.getByLabel('采购数量', { exact: true })).toHaveValue('');
  await page.getByRole('button', { name: '继续上次录入', exact: true }).click();
  await assertPurchase(page);
  await expect(page.locator('input[name="clientRequestId"]')).toHaveValue(requestId);
  await context.clearCookies();
  await login(page, { username: E2E_USERS.sales!.username, password: E2E_PASSWORD, from: '/workbench' });
  await expect.poll(() => page.evaluate(() => Object.keys(sessionStorage).filter((key) => key.startsWith('erp:form-draft:')).length)).toBe(0);
});

test('复制标签页遇到活跃原页时不自动回填，确认另建后才换请求标识', async ({ page, context }) => {
  const fixture = await seedPurchasePrerequisites();
  await login(page, { ...owner, from: '/owner/purchases/new' });
  await fillPurchase(page, fixture.supplierId, fixture.materialId);
  const requestId = await page.locator('input[name="clientRequestId"]').inputValue();
  const values = await page.evaluate(() => Object.fromEntries(Object.entries(sessionStorage)));
  const copied = await context.newPage();
  try {
    await copied.addInitScript((data) => { for (const [key, value] of Object.entries(data)) sessionStorage.setItem(key, value); }, values);
    await copied.goto('/owner/purchases/new');
    await expect(copied.getByText('另一标签页也在使用这份录入，请返回原标签页，或核对后选择另建一单。', { exact: true })).toBeVisible();
    await expect(copied.getByLabel('采购数量', { exact: true })).toHaveValue('');
    await expect(copied.locator('input[name="clientRequestId"]')).toHaveValue(requestId);
    await copied.getByRole('button', { name: '另建一单', exact: true }).click();
    await assertPurchase(copied);
    await expect(copied.locator('input[name="clientRequestId"]')).not.toHaveValue(requestId);
    await expect(page.locator('input[name="clientRequestId"]')).toHaveValue(requestId);
  } finally { await copied.close(); }
});

test('返回物料停用或目标行已删时不误填；旧返回地址不覆盖后来选择', async ({ page }) => {
  const fixture = await seedPurchasePrerequisites();
  await login(page, { ...owner, from: '/owner/boms/new' });
  await page.getByLabel('BOM 名称', { exact: true }).fill('失效回填保护');
  await page.getByRole('button', { name: '添加物料', exact: true }).click();
  await page.locator('[name="items.1.quantity"]').fill('22');
  await page.getByRole('link', { name: '新建物料', exact: true }).last().click();
  const href = await page.getByRole('link', { name: '返回原录入', exact: true }).first().getAttribute('href');
  // Simulate a legitimately removed target row in a restored local draft.
  await page.evaluate(() => {
    for (const key of Object.keys(sessionStorage).filter((key) => key.startsWith('erp:form-draft:') && !key.endsWith(':complete'))) {
      const draft = JSON.parse(sessionStorage.getItem(key)!);
      if (draft.kind === 'bom-new') { draft.payload.rows = draft.payload.rows.slice(0, 1); sessionStorage.setItem(key, JSON.stringify(draft)); }
    }
  });
  await page.goto(`${href}&form_entityId=${fixture.materialId}`);
  await expect(page.getByText('原物料行已删除，请手动选择新物料。', { exact: true })).toBeVisible();
  await expect(page.locator('[name="items.0.materialId"]')).toHaveValue('');
  await page.locator('[name="items.0.materialId"]').selectOption(fixture.materialId);
  await page.goto(`${href}&form_entityId=nonexistent`);
  await page.getByRole('button', { name: '继续上次录入', exact: true }).click();
  await expect(page.locator('[name="items.0.materialId"]')).toHaveValue(fixture.materialId);
  await page.getByRole('link', { name: '新建物料', exact: true }).click();
  const secondHref = await page.getByRole('link', { name: '返回原录入', exact: true }).first().getAttribute('href');
  await withSupplyChainDb((db) => db.query('UPDATE "Material" SET "isActive"=FALSE WHERE id=$1', [fixture.materialId]));
  await page.goto(`${secondHref}&form_entityId=${fixture.materialId}`);
  await expect(page.getByText('补充的资料已停用或不适用，请重新选择', { exact: true })).toBeVisible();
  await expect(page.getByLabel('BOM 名称', { exact: true })).toHaveValue('失效回填保护');
});

test('创建已提交但响应丢失，恢复只指向原单据；修改过的草稿展示差异并保留原请求键', async ({ page }) => {
  test.setTimeout(60_000);
  const fixture = await seedPurchasePrerequisites();
  await login(page, { ...owner, from: '/owner/purchases/new' });
  await fillPurchase(page, fixture.supplierId, fixture.materialId);
  const requestId = await page.locator('input[name="clientRequestId"]').inputValue();
  const saved = await page.evaluate(() => Object.entries(sessionStorage).find(([key]) => key.startsWith('erp:form-draft:') && !key.endsWith(':complete'))!);
  let responseCommitted!: () => void;
  const committed = new Promise<void>((resolve) => { responseCommitted = resolve; });
  let intercepted = false;
  await page.route('**/owner/purchases/new**', async (route) => {
    if (intercepted || route.request().method() !== 'POST') { await route.continue(); return; }
    intercepted = true;
    const result = await route.fetch({ headers: detachedActionHeaders(route.request()) });
    expect(result.ok()).toBe(true);
    await result.dispose();
    await route.abort('connectionfailed');
    await page.unroute('**/owner/purchases/new**');
    responseCommitted();
  });
  await page.getByRole('button', { name: '创建采购单', exact: true }).click();
  await committed;
  await page.goto('/owner/purchases/new');
  await expect(page.getByRole('link', { name: '查看已创建单据', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '创建采购单', exact: true })).toBeDisabled();
  await withSupplyChainDb(async (db) => {
    const count = await db.query('SELECT count(*)::text FROM "FormCreationRequest" WHERE "clientRequestId"=$1::uuid', [requestId]);
    expect(count.rows).toEqual([{ count: '1' }]);
  });
  await page.evaluate(([key, raw]) => {
    const draft = JSON.parse(raw); draft.payload.quantity = '124';
    sessionStorage.removeItem(`${key}:complete`); sessionStorage.setItem(key, JSON.stringify(draft));
  }, saved);
  await page.reload();
  await expect(page.getByText('数量：原单据为“123.00”，当前为“124.00”', { exact: true })).toBeVisible();
  await expect(page.locator('input[name="clientRequestId"]')).toHaveValue(requestId);
  expect(await page.evaluate((key) => sessionStorage.getItem(key) !== null, saved[0])).toBe(true);
  await page.getByRole('button', { name: '另建一单', exact: true }).click();
  await expect(page.getByLabel('采购数量', { exact: true })).toHaveValue('124');
  await expect(page.locator('input[name="clientRequestId"]')).not.toHaveValue(requestId);
});

test('无 JS 原生提交带请求标识，补资料默认新标签页', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL: 'http://127.0.0.1:3100' });
  const page = await context.newPage();
  try {
    const fixture = await seedPurchasePrerequisites();
    await login(page, { ...owner, from: '/owner/purchases/new' });
    await fillPurchase(page, fixture.supplierId, fixture.materialId);
    const link = page.getByRole('link', { name: '新建物料', exact: true });
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    const requestId = await page.locator('input[name="clientRequestId"]').inputValue();
    await page.getByRole('button', { name: '创建采购单', exact: true }).click();
    await expect(page).toHaveURL(/\/owner\/purchases\/(?!new)[a-z0-9_-]+(?:\?.*)?$/i);
    await withSupplyChainDb(async (db) => {
      const record = await db.query('SELECT count(*)::text FROM "FormCreationRequest" WHERE "clientRequestId"=$1::uuid', [requestId]);
      expect(record.rows).toEqual([{ count: '1' }]);
    });
    await page.getByRole('button', { name: /退出登录/ }).click();
    await expect(page).toHaveURL(/\/login/);
  } finally { await context.close(); }
});

test('创建后浏览器后退不会默默重用原单，明确另建后相同内容创建新单', async ({ page }) => {
  const fixture = await seedPurchasePrerequisites();
  await login(page, { ...owner, from: '/owner/purchases/new' });
  await fillPurchase(page, fixture.supplierId, fixture.materialId);
  const originalKey = await page.locator('input[name="clientRequestId"]').inputValue();
  await page.getByRole('button', { name: '创建采购单', exact: true }).click();
  await expect(page).toHaveURL(/\/owner\/purchases\/(?!new)[a-z0-9_-]+$/i);
  const originalPath = new URL(page.url()).pathname;
  await page.goBack();
  await expect(page.getByRole('link', { name: '查看已创建单据', exact: true })).toHaveAttribute('href', originalPath);
  await expect(page.getByRole('button', { name: '创建采购单', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '另建一单', exact: true }).click();
  await expect(page.locator('input[name="clientRequestId"]')).not.toHaveValue(originalKey);
  await fillPurchase(page, fixture.supplierId, fixture.materialId);
  await page.getByRole('button', { name: '创建采购单', exact: true }).click();
  await expect(page).toHaveURL(/\/owner\/purchases\/(?!new)[a-z0-9_-]+$/i);
  expect(new URL(page.url()).pathname).not.toBe(originalPath);
});

test('核对结果未知仍可用原请求键续填重试，不能默认另建', async ({ page }) => {
  const fixture = await seedPurchasePrerequisites();
  await login(page, { ...owner, from: '/owner/purchases/new' });
  await fillPurchase(page, fixture.supplierId, fixture.materialId);
  const requestId = await page.locator('input[name="clientRequestId"]').inputValue();
  await page.route('**/owner/purchases/new**', async (route) => {
    if (route.request().method() === 'POST' && route.request().postData()?.includes('"kind":"purchase-new"')) {
      await route.fulfill({ status: 503, body: 'temporarily unavailable' });
    } else await route.continue();
  });
  await page.reload();
  await expect(page.getByText('暂时无法确认是否已经创建，请保留内容并重新核对；不要重复新建。', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '另建一单', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '继续上次录入', exact: true }).click();
  await assertPurchase(page);
  await expect(page.locator('input[name="clientRequestId"]')).toHaveValue(requestId);
  await page.unroute('**/owner/purchases/new**');
  await page.getByRole('button', { name: '创建采购单', exact: true }).click();
  await expect(page).toHaveURL(/\/owner\/purchases\/(?!new)[a-z0-9_-]+$/i);
});

test('脚本尚未加载时输入的内容不会被挂载默认值覆盖', async ({ page }) => {
  const fixture = await seedPurchasePrerequisites();
  await login(page, { ...owner, from: '/owner' });
  const waiting: Route[] = [];
  let released = false;
  await page.route('**/_next/static/**/*.js', async (route) => {
    if (released) await route.continue(); else waiting.push(route);
  });
  try {
    await page.goto('/owner/purchases/new', { waitUntil: 'commit' });
    await fillPurchase(page, fixture.supplierId, fixture.materialId);
    released = true;
    await Promise.all(waiting.map((route) => route.continue()));
    await expect(page).toHaveURL(/\/owner\/purchases\/new\?draft=/);
    await assertPurchase(page);
    await page.getByRole('link', { name: '管理供应商', exact: true }).click();
    await page.getByRole('link', { name: '返回原录入', exact: true }).click();
    await assertPurchase(page);
  } finally {
    released = true;
    await page.unroute('**/_next/static/**/*.js');
  }
});
