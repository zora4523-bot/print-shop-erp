import { expect, test } from '@playwright/test';
import { login, E2E_USERS, E2E_PASSWORD } from './_helpers';

test.describe('sales workbench', () => {
  // The first visit compiles a new authenticated route in the shared dev server.
  test.describe.configure({ timeout: 90_000 });
  test('sales opens the workbench, calculates with the current catalog and searches replies', async ({
    page,
  }) => {
    await login(page, {
      from: '/workbench',
      username: E2E_USERS.sales!.username,
      password: E2E_PASSWORD,
    });
    await expect(
      page.getByRole('heading', { name: '工作台', exact: true }),
    ).toBeVisible();
    await expect(
      page
        .getByRole('navigation', { name: '后台主导航' })
        .getByRole('link', { name: '工作台', exact: true }),
    ).toHaveAttribute('aria-current', 'page');
    await page.getByRole('combobox', { name: '产品类型', exact: true }).click();
    await page
      .getByRole('option', { name: '局部烫金（通版现货）', exact: true })
      .click();
    await page.getByRole('combobox', { name: '产品', exact: true }).click();
    await page.getByRole('option').first().click();
    for (const label of ['规格', '纸张']) {
      await page.getByRole('combobox', { name: label, exact: true }).click();
      await page.getByRole('option').first().click();
    }
    await page
      .getByRole('group', { name: '正面烫金颜色（最多 3 色）' })
      .getByRole('button')
      .first()
      .click();
    await page.getByRole('button', { name: '计算报价', exact: true }).click();
    const quote = page.getByRole('region', { name: '报价计算', exact: true });
    await expect(quote.getByText(/加工费价格版本/)).toBeVisible();
    await expect(quote.getByText('加工费', { exact: true })).toBeVisible();
    await expect(quote.getByText(/暂无法取得当前报价/)).toHaveCount(0);
    await page.getByRole('spinbutton', { name: '数量（个）' }).fill('2000');
    await expect(quote.getByText(/加工费价格版本/)).toHaveCount(0);
    // Custom catalog products own a size and intentionally leave paperType
    // empty. Their paper selector must use current materials.
    await page.getByRole('combobox', { name: '产品类型', exact: true }).click();
    await page.getByRole('option', { name: '专版烫金', exact: true }).click();
    await page.getByRole('combobox', { name: '产品', exact: true }).click();
    await page
      .getByRole('option', { name: '专版烫金 · 大号封', exact: true })
      .click();
    await page.getByRole('combobox', { name: '纸张', exact: true }).click();
    await page
      .getByRole('option', { name: '160g珠光艳闪', exact: true })
      .click();
    await page
      .getByRole('group', { name: '正面烫金颜色（最多 3 色）' })
      .getByRole('button')
      .first()
      .click();
    await page.getByRole('button', { name: '计算报价', exact: true }).click();
    await expect(quote.getByText(/加工费价格版本/)).toBeVisible();
    await expect(quote.getByText('待核价', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: '话术应对', exact: true }).click();
    await page.getByRole('textbox', { name: '搜索销售话术' }).fill('免费打样');
    await page.getByText('可以免费打样吗', { exact: true }).click();
    await expect(
      page.getByRole('button', { name: '复制话术：可以免费打样吗' }),
    ).toBeVisible();
  });

  test('customer service can read the same knowledge page', async ({
    page,
  }) => {
    await login(page, {
      from: '/workbench',
      username: E2E_USERS.customerService!.username,
      password: E2E_PASSWORD,
    });
    await expect(
      page.getByRole('heading', { name: '工作台', exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: '纸张与规格', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: '当前可选规格' }),
    ).toBeVisible();
  });

  test('workers cannot open sales workbench', async ({ page }) => {
    await login(page, {
      username: E2E_USERS.workerHandPress!.username,
      password: E2E_PASSWORD,
    });
    await page.goto('/workbench');
    await expect(page.getByTestId('sales-workbench')).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: '计算报价', exact: true }),
    ).toHaveCount(0);
  });
});
