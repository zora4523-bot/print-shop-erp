import { expect, test, type Page } from '@playwright/test';
import { login, E2E_PASSWORD, E2E_USERS } from './_helpers';
import { paperCommand, type PaperFixture, type PaperState } from './paper-spec-fixtures';
import { assertActivatedE2eDatabase } from '../../scripts/lib/e2e-environment';

test.beforeEach(() => { assertActivatedE2eDatabase(); });
test.use({ actionTimeout: 20_000 });
async function openPaper(page: Page, fixture: PaperFixture) {
  await login(page, { username: E2E_USERS.owner.username, password: E2E_PASSWORD, from: `/owner/rules/papers/${fixture.paperId}` });
}
const state = (fixture: PaperFixture) => paperCommand<PaperState>({ op: 'state', paperId: fixture.paperId });
const mid = (page: Page) => page.getByRole('checkbox', { name: /中号封80×115/ });

test('合法无外键组合重复启用为空操作；重新启用不补外键，长编码可保存名称', async ({ page }) => {
  test.setTimeout(120_000);
  const fixture = await paperCommand<PaperFixture>({ op: 'setup' });
  const original = await state(fixture);
  await paperCommand({ op: 'enable', paperId: fixture.paperId });
  expect(await state(fixture)).toEqual(original);
  await paperCommand({ op: 'deactivate-fixture', ids: [fixture.productId] });
  const inactive = await state(fixture);
  await openPaper(page, fixture);
  await mid(page).check();
  await page.getByRole('button', { name: '复核启用规格', exact: true }).click();
  await expect(page.getByText('无现行单价，建单后待核价', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: '启用规格', exact: true }).click();
  await expect(mid(page)).toBeChecked();
  await expect(mid(page)).toBeDisabled();
  await expect.poll(async () => (await state(fixture)).products.find((row) => row.id === fixture.productId)?.isActive).toBe(true);
  const enabled = await state(fixture);
  expect(enabled.products[0]).toMatchObject({ ...inactive.products[0], isActive: true, updatedAt: enabled.products[0]!.updatedAt });
  expect(enabled.products[0]!.paperMaterialId).toBeNull();
  expect(enabled.audits.length).toBe(inactive.audits.length + 1);
  await page.goto(`/owner/rules/stock-skus/${fixture.productId}`);
  await page.getByLabel('组合名称', { exact: true }).fill('更新显示名称');
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  await expect.poll(async () => (await state(fixture)).products[0]!.name).toBe('更新显示名称');
  expect((await state(fixture)).products[0]!.code).toBe(original.products[0]!.code);
  for (const kind of ['create', 'move']) {
    await expect(paperCommand({ op: 'duplicate', productId: fixture.productId, kind })).rejects.toThrow(/已有产品或待处理组合/);
  }
  await page.goto('/owner/rules/stock-skus/new');
  await page.getByLabel('产品结构分类', { exact: true }).selectOption(fixture.nodeId);
  await page.getByLabel('组合名称', { exact: true }).fill('不应创建的重复组合');
  await page.getByLabel('纸张（选填）', { exact: true }).fill(fixture.name);
  await page.getByLabel('规格（选填）', { exact: true }).fill('中号封80×115');
  await page.getByRole('button', { name: '创建组合', exact: true }).click();
  await expect(page.getByText(/该纸张规格已有产品或待处理组合/)).toBeVisible();
  const movable = await paperCommand<{ productId: string }>({ op: 'duplicate', productId: fixture.productId, kind: 'prepare-move' });
  await page.goto(`/owner/rules/stock-skus/${movable.productId}`);
  await page.getByLabel('产品结构分类', { exact: true }).selectOption(fixture.nodeId);
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  await expect(page.getByText(/该纸张规格已有产品或待处理组合/)).toBeVisible();
});

for (const kind of ['alias', 'multi', 'duplicate']) {
  test(`启用${kind}异常阻止勾选，停用旧行后解除且不改写历史`, async ({ page }) => {
    test.setTimeout(120_000);
    const fixture = await paperCommand<PaperFixture>({ op: 'setup' });
    const anomaly = await paperCommand<{ id: string }>({ op: 'anomaly', productId: fixture.productId, kind });
    try {
      await openPaper(page, fixture);
      await expect(mid(page)).toBeDisabled();
      expect((await state(fixture)).view!.cells.find((cell) => cell.key === 'mid')!.state).toBe('needs-attention');
      await expect(paperCommand({ op: 'enable', paperId: fixture.paperId })).rejects.toThrow();
    } finally { await paperCommand({ op: 'deactivate-fixture', ids: [anomaly.id] }); }
    const before = await state(fixture);
    await paperCommand({ op: 'enable', paperId: fixture.paperId });
    expect(await state(fixture)).toEqual(before);
    await page.reload();
    await expect(mid(page)).toBeChecked();
    expect((await state(fixture)).view!.cells.find((cell) => cell.key === 'mid')!.state).toBe('enabled');
  });
}

for (const kind of ['zero', 'four-decimal']) {
  test(`现行${kind}价格在重新启用时立即命中；草稿保存发布、其他组合报价不变`, async ({ page }) => {
    test.setTimeout(150_000);
    const fixture = await paperCommand<PaperFixture>({ op: 'setup' });
    const control = await paperCommand<PaperFixture>({ op: 'setup' });
    const quote = (value: PaperFixture) => paperCommand<{
      input: { items: { configuration: { specification: string } }[] };
      quote: { items: { unitPrice: string | null; manualReasons: { code: string }[] }[] };
    }>({ op: 'quote', ...value });
    const missing = await quote(fixture);
    expect(missing.quote.items[0]!.manualReasons).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'PARTIAL_BLANK_PRICE_NOT_FOUND' }),
    ]));
    await paperCommand({ op: 'publish-price', paperId: fixture.paperId, kind });
    const priced = await quote(fixture);
    expect(priced.input.items[0]!.configuration.specification).toBe('CATALOG');
    expect(priced.quote.items[0]!.unitPrice).toBe(kind === 'zero' ? '0.0000' : '0.1234');
    const controlBefore = await quote(control);
    await paperCommand({ op: 'deactivate-fixture', ids: [fixture.productId] });
    const catalogBefore = await paperCommand<import('./paper-spec-fixtures').PaperCatalog>({ op: 'catalog' });
    expect(catalogBefore.options.products.some((row) => row.id === fixture.productId)).toBe(false);
    await expect(quote(fixture)).rejects.toThrow();
    await openPaper(page, fixture);
    await mid(page).check();
    await page.getByRole('button', { name: '复核启用规格', exact: true }).click();
    await expect(page.getByText(/按现行单价.*计价/)).toContainText(kind === 'zero' ? '0.00' : '0.1234');
    await page.getByRole('button', { name: '启用规格', exact: true }).click();
    await expect(mid(page)).toBeChecked();
    await expect.poll(async () => (await state(fixture)).products.find((row) => row.id === fixture.productId)?.isActive).toBe(true);
    expect(await quote(fixture)).toEqual(priced);
    expect(await quote(control)).toEqual(controlBefore);
    const catalogAfter = await paperCommand<import('./paper-spec-fixtures').PaperCatalog>({ op: 'catalog' });
    expect(catalogAfter.options.products.some((row) => row.id === fixture.productId)).toBe(true);
    expect(catalogAfter.options.products.filter((row) => row.id !== fixture.productId)).toEqual(catalogBefore.options.products);
  });
}

test('纸张页新增后专版自动出现该纸；缺加价和冰白纸仍转人工', async ({ page }) => {
  test.setTimeout(120_000);
  const fixture = await paperCommand<PaperFixture>({ op: 'setup' });
  const full = await paperCommand<{ productId: string }>({ op: 'full-product' });
  await openPaper(page, fixture);
  await page.goto('/owner/rules/papers/new');
  const name = `新纸${Date.now().toString(36)}`;
  await page.getByLabel('纸张名称', { exact: true }).fill(name);
  await page.getByLabel('克重（g）', { exact: true }).fill('160');
  await page.getByRole('button', { name: '复核新增纸张', exact: true }).click();
  await page.getByRole('button', { name: '新增纸张', exact: true }).click();
  await expect(page).toHaveURL((url) => url.pathname.startsWith('/owner/rules/papers/') && !url.pathname.endsWith('/new'));
  const paperId = new URL(page.url()).pathname.split('/').at(-1)!;
  const catalog = await paperCommand<import('./paper-spec-fixtures').PaperCatalog>({ op: 'catalog' });
  expect(catalog.papers.some((paper) => paper.label === name && paper.routes.includes('CUSTOM_SINGLE_FLAT_FOIL'))).toBe(true);
  const quote = await paperCommand<{ quote: { manualReasons: { code: string }[] } }>({ op: 'quote', paperId, productId: full.productId, kind: 'full' });
  expect(quote.quote.manualReasons).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'FULL_PAPER_SURCHARGE_NOT_FOUND' })]));
  const ice = catalog.options.papers.find((paper) => /冰白/.test(paper.name) && /160/.test(`${paper.name} ${paper.specification}`));
  expect(ice, '隔离价目准备必须包含冰白纸160g').toBeDefined();
  const iceQuote = await paperCommand<{ quote: { manualReasons: { code: string }[] } }>({ op: 'quote', paperId: ice!.id, productId: full.productId, kind: 'full' });
  expect(iceQuote.quote.manualReasons).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'FULL_ICE_WHITE_ADMIN_PRICING' })]));
  await mid(page).check();
  await page.getByRole('button', { name: '复核启用规格', exact: true }).click();
  await expect(page.getByText('无现行单价，建单后待核价', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: '启用规格', exact: true }).click();
  await expect(mid(page)).toBeChecked();
  await expect.poll(async () => (await paperCommand<PaperState>({ op: 'state', paperId })).products.length).toBe(1);
  const created = await paperCommand<PaperState>({ op: 'state', paperId });
  expect(created.products).toHaveLength(1);
  expect(created.products[0]!.paperMaterialId).toBe(paperId);
  const blank = await paperCommand<{ quote: { manualReasons: { code: string }[] } }>({ op: 'quote', paperId, productId: created.products[0]!.id });
  expect(blank.quote.manualReasons).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'PARTIAL_BLANK_PRICE_NOT_FOUND' })]));
});


test('仅有文本匹配现行价时，新启用组合立即自动报价且不写价目', async ({ page }) => {
  test.setTimeout(150_000);
  const fixture = await paperCommand<PaperFixture>({ op: 'setup' });
  const anchor = await paperCommand<PaperFixture>({ op: 'setup' });
  await paperCommand({ op: 'publish-price', paperId: fixture.paperId, kind: 'four-decimal' });
  await paperCommand({ op: 'remove-priced-fixture', productId: fixture.productId, ids: [anchor.productId] });
  const before = await state(fixture);
  expect(before.products).toHaveLength(0);
  await openPaper(page, fixture);
  await mid(page).check();
  await page.getByRole('button', { name: '复核启用规格', exact: true }).click();
  await expect(page.getByText(/按现行单价.*计价/)).toContainText('0.1234');
  await page.getByRole('button', { name: '启用规格', exact: true }).click();
  await expect(mid(page)).toBeChecked();
  await expect.poll(async () => (await state(fixture)).products.length).toBe(1);
  const after = await state(fixture);
  expect(after.priceDigest).toBe(before.priceDigest);
  const created = after.products[0]!;
  expect(created.id).not.toBe(fixture.productId);
  expect(created.paperMaterialId).toBe(fixture.paperId);
  const result = await paperCommand<{ quote: { items: { unitPrice: string | null }[] } }>({ op: 'quote', paperId: fixture.paperId, productId: created.id });
  expect(result.quote.items[0]!.unitPrice).toBe('0.1234');
});
