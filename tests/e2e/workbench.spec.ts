import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
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

test('every live catalog product, specification, paper and technique can be selected', async ({
  page,
}, testInfo) => {
  test.setTimeout(240_000);
  await login(page, {
    from: '/workbench',
    username: E2E_USERS.sales!.username,
    password: E2E_PASSWORD,
  });
  const select = async (label: string, name: string) => {
    await page.getByRole('combobox', { name: label, exact: true }).click();
    await page.getByRole('option', { name, exact: true }).click();
    await expect(
      page.getByRole('combobox', { name: label, exact: true }),
    ).toContainText(name);
  };
  const names = async (label: string) => {
    const control = page.getByRole('combobox', { name: label, exact: true });
    if (await control.isDisabled()) return [];
    await control.click();
    await expect(page.getByRole('option').first()).toBeVisible();
    const values = await page.getByRole('option').allTextContents();
    await page.keyboard.press('Escape');
    return values;
  };
  const report: object[] = [];
  for (const route of await names('产品类型')) {
    await select('产品类型', route);
    const products = await names('产品');
    expect(products.length, route).toBeGreaterThan(0);
    for (const product of products) {
      await select('产品', product);
      const specs = await names('规格');
      const papers = await names('纸张');
      expect(specs.length, `${product} 规格`).toBeGreaterThan(0);
      expect(papers.length, `${product} 纸张`).toBeGreaterThan(0);
      for (const spec of specs) await select('规格', spec);
      for (const paper of papers) await select('纸张', paper);
      // Check every technique using the first configured size/paper for each product.
      await select('规格', specs[0]!);
      await select('纸张', papers[0]!);
      for (const technique of await names('烫金方式')) {
        await select('烫金方式', technique);
        if (technique !== '无烫金') {
          const color = page
            .getByRole('group', { name: '正面烫金颜色（最多 3 色）' })
            .getByRole('button')
            .first();
          if ((await color.getAttribute('aria-pressed')) !== 'true')
            await color.click();
        }
        await page
          .getByRole('button', { name: '计算报价', exact: true })
          .click();
        if (product === '紫色珠光纸') {
          await expect(
            page.getByText(
              '所选纸张缺少克重，请联系管理员补充产品资料后再计算',
            ),
          ).toBeVisible();
        } else {
          await expect(page.getByText(/加工费价格版本/)).toBeVisible();
        }
        report.push({
          route,
          product,
          specs,
          papers,
          technique,
          missingPaperWeight: product === '紫色珠光纸',
          needsPricing:
            (await page.getByText('待核价', { exact: true }).count()) > 0,
        });
      }
    }
  }
  const reportPath = testInfo.outputPath('catalog-selection-audit.json');
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  await testInfo.attach('catalog-selection-audit', {
    path: reportPath,
    contentType: 'application/json',
  });
});
