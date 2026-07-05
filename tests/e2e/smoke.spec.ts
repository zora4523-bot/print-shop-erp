import { test, expect } from '@playwright/test';
import {
  E2E_PASSWORD,
  E2E_USERS,
  expectNoNextErrorOverlay,
  getUserIdByUsername,
  login,
  seedSearchSmokeFixtures,
} from './_helpers';

test.describe('automation smoke', () => {
  test('protected routes redirect unauthenticated users to /login', async ({
    page,
  }) => {
    for (const path of [
      '/owner/pigsty',
      '/orders?q=CODX-E2E-ORDER-001',
      '/foreman/materials?q=CODX-E2E-MAT-001',
    ]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login(\?|$)/);
    }
  });

  test('OWNER can open Pigsty readiness and search core ERP surfaces', async ({
    page,
  }) => {
    test.setTimeout(45_000);

    const ownerId = await getUserIdByUsername(E2E_USERS.owner.username);
    const fixture = await seedSearchSmokeFixtures({ ownerId });

    await login(page, {
      from: '/owner/pigsty',
      username: E2E_USERS.owner.username,
      password: E2E_PASSWORD,
    });

    await expect(page.getByRole('heading', { name: 'Pigsty 运维' })).toBeVisible();
    await expect(page.getByText('搜索索引预检')).toBeVisible();
    await expect(page.getByText('pg_pinyin').first()).toBeVisible();
    await expectNoNextErrorOverlay(page);

    await page.goto(`/owner/products?q=${fixture.productCode}`);
    await expect(page.getByText(fixture.productCode)).toBeVisible();
    await expect(page.getByText(fixture.productName)).toBeVisible();
    await expectNoNextErrorOverlay(page);

    await page.goto('/owner/product-categories');
    await expect(page.getByRole('heading', { name: '产品分类' })).toBeVisible();
    await expect(page.getByRole('cell', { name: '空白现货' }).first()).toBeVisible();
    await expectNoNextErrorOverlay(page);

    await page.goto('/owner/prices');
    await expect(page.getByRole('heading', { name: '价格字典' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '价格阶梯' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '加价规则' })).toBeVisible();
    await expectNoNextErrorOverlay(page);

    await page.goto('/owner/boms');
    await expect(page.getByRole('heading', { name: 'BOM/用料' })).toBeVisible();
    await expect(page.getByText('Codex E2E 标准 BOM')).toBeVisible();
    await expectNoNextErrorOverlay(page);

    await page.goto('/owner/boms/new');
    await expect(page.getByRole('heading', { name: '新建 BOM' })).toBeVisible();
    await expect(page.getByLabel('BOM 名称')).toBeVisible();
    await expect(page.getByLabel('物料').first()).toBeVisible();
    await expectNoNextErrorOverlay(page);

    await page.goto(`/owner/parties?q=${fixture.partyCode}`);
    await expect(page.getByRole('heading', { name: '客户/供应商' })).toBeVisible();
    await expect(page.getByText(fixture.partyCode)).toBeVisible();
    await expect(page.getByText(fixture.partyName)).toBeVisible();
    await expectNoNextErrorOverlay(page);

    await page.goto('/owner/parties/new');
    await expect(page.getByRole('heading', { name: '新建客户/供应商' })).toBeVisible();
    await expect(page.getByLabel('编码')).toBeVisible();
    await expectNoNextErrorOverlay(page);

    await page.goto('/owner/purchases');
    await expect(page.getByRole('heading', { name: '采购单' })).toBeVisible();
    await expectNoNextErrorOverlay(page);

    await page.goto('/owner/purchases/new');
    await expect(page.getByRole('heading', { name: '新建采购单' })).toBeVisible();
    await expect(page.getByLabel('供应商')).toBeVisible();
    await expect(page.getByLabel('物料')).toBeVisible();
    await expectNoNextErrorOverlay(page);

    await page.goto('/owner/warehouses');
    await expect(page.getByRole('heading', { name: '仓库/库位' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '仓库列表' })).toBeVisible();
    await expect(page.getByText('默认仓库', { exact: true })).toBeVisible();
    await expectNoNextErrorOverlay(page);

    await page.goto('/orders/new');
    await expect(page.getByRole('heading', { name: '新建工单' })).toBeVisible();
    await page.locator('select[name="customerPartyId"]').selectOption(fixture.partyId);
    await expect(page.locator('input[name="customerRef"]')).toHaveValue(fixture.partyCode);
    await expect(page.locator('input[name="receiverName"]')).toHaveValue(fixture.partyContactName);
    await expect(page.locator('input[name="receiverPhone"]')).toHaveValue(fixture.partyContactPhone);
    await expect(page.locator('textarea[name="receiverAddress"]')).toHaveValue(fixture.partyAddress);
    await expectNoNextErrorOverlay(page);

    await page.goto(`/orders?q=${fixture.orderNo}`);
    await expect(
      page
        .locator('[data-sidebar="sidebar"]')
        .getByRole('link', { name: '采购单' }),
    ).toBeVisible();
    await expect(page.getByText(fixture.orderNo)).toBeVisible();
    await expect(page.getByText(fixture.customerRef)).toBeVisible();
    await expectNoNextErrorOverlay(page);

    await page.goto(`/orders/${fixture.orderId}`);
    await expect(page.getByRole('heading', { name: '物料用量估算' })).toBeVisible();
    await expect(page.getByText('Codex E2E 标准 BOM')).toBeVisible();
    await expect(
      page.getByText(`${fixture.materialCode} · ${fixture.materialName}`, {
        exact: true,
      }),
    ).toBeVisible();
    await expectNoNextErrorOverlay(page);

    await page.goto(`/foreman/materials?q=${fixture.materialCode}`);
    await expect(page.getByText(fixture.materialCode)).toBeVisible();
    await expect(page.getByText(fixture.materialName)).toBeVisible();
    await expectNoNextErrorOverlay(page);

    await page.goto(`/owner/materials?q=${fixture.materialCode}`);
    await expect(page.getByRole('heading', { name: '物料字典' })).toBeVisible();
    await expect(page.getByText(fixture.materialCode)).toBeVisible();
    await expect(page.getByText(fixture.materialName)).toBeVisible();
    await expectNoNextErrorOverlay(page);

    await page.goto('/owner/materials/count');
    await expect(page.getByRole('heading', { name: '库存盘点' })).toBeVisible();
    await page
      .getByPlaceholder('搜索物料编码、名称、规格、拼音')
      .fill(fixture.materialCode);
    await page.getByRole('button', { name: '搜索' }).click();
    await expect(page.getByText(fixture.materialCode)).toBeVisible();
    await page.getByLabel(`${fixture.materialName} 实盘数`).fill('8801');
    await expect(page.getByText('+1.00 张')).toBeVisible();
    await expectNoNextErrorOverlay(page);

    await page.goto(`/owner/materials?q=${fixture.materialCode}`);
    await page.getByRole('link', { name: '编辑' }).first().click();
    await expect(page.getByRole('heading', { name: /编辑物料/ })).toBeVisible();
    await expect(page.getByText('库存出入库')).toBeVisible();
    await expect(page.getByRole('heading', { name: '库位库存' })).toBeVisible();
    await expectNoNextErrorOverlay(page);

    await page.goto('/owner/materials/new');
    await expect(page.getByRole('heading', { name: '新建物料' })).toBeVisible();
    await expect(page.getByLabel('物料编码')).toBeVisible();
    await expectNoNextErrorOverlay(page);
  });
});
