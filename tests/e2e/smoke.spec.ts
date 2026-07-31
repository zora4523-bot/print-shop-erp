import { test, expect } from '@playwright/test';
import {
  cleanupAutoCodePartyFixture,
  E2E_PASSWORD,
  E2E_USERS,
  expectNoNextErrorOverlay,
  getUserIdByUsername,
  login,
  seedSearchSmokeFixtures,
  uniqueSuffix,
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

  test('ADMIN can open Pigsty readiness and search core ERP surfaces', async ({
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
    await expect(
      page.getByText('高级设置：自定义客户/供应商编码（通常无需填写）'),
    ).toBeVisible();
    await expectNoNextErrorOverlay(page);

    await page.goto(
      '/owner/parties/new?type=SUPPLIER&returnTo=%2Fowner%2Fpurchases%2Fnew',
    );
    await page
      .getByText('高级设置：自定义客户/供应商编码（通常无需填写）')
      .click();
    await page
      .getByLabel('自定义编码（选填）')
      .fill(fixture.supplierPartyCode.toLowerCase());
    await page.getByLabel('名称', { exact: true }).fill('重复供应商回归');
    await page.getByRole('button', { name: '创建客户/供应商' }).click();
    await expect(page.getByText('该客户/供应商编码已被占用')).toBeVisible();
    await expect(page).toHaveURL(/\/owner\/parties\/new\?/);
    await expectNoNextErrorOverlay(page);

    const autoSupplierName = `Codex E2E 自动编码供应商 ${uniqueSuffix()}`;
    let autoSupplierId: string | null = null;
    try {
      await page.goto(
        '/owner/parties/new?type=SUPPLIER&returnTo=%2Fowner%2Fpurchases%2Fnew',
      );
      await page.getByLabel('名称', { exact: true }).fill(autoSupplierName);
      await page.getByRole('button', { name: '创建客户/供应商' }).click();
      await page.waitForURL((url) => {
        autoSupplierId = url.searchParams.get('supplierPartyId');
        return url.pathname === '/owner/purchases/new' && Boolean(autoSupplierId);
      });

      const selectedSupplier = page
        .getByLabel('供应商')
        .locator('option:checked');
      await expect(selectedSupplier).toHaveText(/^PTY-\d{6} · Codex E2E 自动编码供应商 /);
      await expect(page.getByLabel('供应商')).toHaveValue(autoSupplierId!);
      await expectNoNextErrorOverlay(page);
    } finally {
      if (autoSupplierId) {
        await cleanupAutoCodePartyFixture({
          partyId: autoSupplierId,
          expectedName: autoSupplierName,
        });
      }
    }

    await page.goto('/owner/purchases');
    await expect(page.getByRole('heading', { name: '采购单' })).toBeVisible();
    await expectNoNextErrorOverlay(page);

    await page.goto('/owner/purchases/new');
    await expect(page.getByRole('heading', { name: '新建采购单' })).toBeVisible();
    const supplierSelect = page.getByLabel('供应商');
    await expect(supplierSelect).toBeVisible();
    await expect(supplierSelect).toContainText(fixture.supplierPartyCode);
    await supplierSelect.selectOption(fixture.supplierPartyId);
    await expect(supplierSelect).toHaveValue(fixture.supplierPartyId);
    await expect(page.getByLabel('物料')).toBeVisible();
    await expectNoNextErrorOverlay(page);

    await page.goto('/owner/warehouses');
    await expect(page.getByRole('heading', { name: '仓库作业台' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '采购待收货' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '最近库存流水' })).toBeVisible();
    await expect(page.getByText('库存一致性', { exact: true })).toBeVisible();
    await expectNoNextErrorOverlay(page);

    await page.goto('/orders/new');
    await expect(page.getByRole('heading', { name: '新建工单' })).toBeVisible();
    await expect(page.getByLabel('客户主数据（选填）')).toHaveCount(0);
    await expect(page.locator('input[name="customerRef"]')).toBeVisible();
    await expect(page.locator('input[name="receiverName"]')).toHaveCount(0);
    await expect(page.locator('input[name="receiverPhone"]')).toHaveCount(0);
    await expect(page.getByLabel('收货信息')).toBeVisible();
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
    await page
      .getByLabel(`${fixture.materialName} 实盘数`)
      .fill(String(Number(fixture.materialCurrentStock) + 1));
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
    await expect(
      page.getByText('高级设置：自定义物料编码（通常无需填写）'),
    ).toBeVisible();
    await expectNoNextErrorOverlay(page);
  });
});
