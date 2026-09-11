import { expect, test, type Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { login, E2E_USERS, E2E_PASSWORD } from './_helpers';

async function selectChoice(page: Page, label: string, name: string) {
  const control = page.getByRole('combobox', { name: label, exact: true });
  await control.click();
  await page.getByRole('option', { name, exact: true }).click();
  await expect(control).toContainText(name);
}

async function choiceNames(page: Page, label: string) {
  const control = page.getByRole('combobox', { name: label, exact: true });
  if (await control.isDisabled()) return [];
  await control.click();
  await expect(page.getByRole('option').first()).toBeVisible();
  const values = await page.getByRole('option').allTextContents();
  await page.keyboard.press('Escape');
  return values;
}

function firstFoilColor(page: Page, side: '正面' | '反面') {
  return page
    .getByRole('group', { name: `${side}烫金颜色（最多 3 色）` })
    .getByRole('button')
    .first();
}

async function selectFirstFrontColor(page: Page) {
  const color = firstFoilColor(page, '正面');
  if ((await color.getAttribute('aria-pressed')) !== 'true')
    await color.click();
  await expect(color).toHaveAttribute('aria-pressed', 'true');
}

function quotedAmount(page: Page) {
  return page
    .getByRole('region', { name: '报价计算', exact: true })
    .locator('p.text-3xl');
}

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
    await expect(
      page.getByRole('combobox', { name: '规格', exact: true }),
    ).not.toContainText('请选择');
    await page.getByRole('combobox', { name: '纸张', exact: true }).click();
    await page.getByRole('option').first().click();
    await selectFirstFrontColor(page);
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
    await selectFirstFrontColor(page);
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
  const report: object[] = [];
  for (const route of await choiceNames(page, '产品类型')) {
    await selectChoice(page, '产品类型', route);
    // Specification choices now cover the whole route and may switch product.
    // Audit that selector once per route, then retain each product's own size.
    const routeSpecifications = await choiceNames(page, '规格');
    expect(routeSpecifications.length, `${route} 规格`).toBeGreaterThan(0);
    for (const specification of routeSpecifications)
      await selectChoice(page, '规格', specification);
    report.push({ route, routeSpecifications });
    await page
      .getByRole('button', { name: '重新选择产品、规格和纸张' })
      .click();
    const products = await choiceNames(page, '产品');
    expect(products.length, route).toBeGreaterThan(0);
    for (const product of products) {
      await selectChoice(page, '产品', product);
      const specification = (
        await page
          .getByRole('combobox', { name: '规格', exact: true })
          .innerText()
      ).trim();
      expect(specification, `${product} 规格`).not.toBe('请选择');
      expect(routeSpecifications, `${product} 规格`).toContain(specification);
      const papers = await choiceNames(page, '纸张');
      expect(papers.length, `${product} 纸张`).toBeGreaterThan(0);
      for (const paper of papers) await selectChoice(page, '纸张', paper);
      await expect(
        page.getByRole('combobox', { name: '产品', exact: true }),
      ).toContainText(product);
      await selectChoice(page, '纸张', papers[0]!);
      for (const technique of await choiceNames(page, '烫金方式')) {
        await selectChoice(page, '烫金方式', technique);
        if (technique !== '无烫金') await selectFirstFrontColor(page);
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
          specification,
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

test('initial specification and paper choices work without selecting a product first', async ({
  page,
}) => {
  await login(page, {
    from: '/workbench',
    username: E2E_USERS.sales!.username,
    password: E2E_PASSWORD,
  });
  for (const label of ['规格', '纸张'])
    await expect(
      page.getByRole('combobox', { name: label, exact: true }),
    ).toBeEnabled();
  await page.getByRole('button', { name: '重新选择产品、规格和纸张' }).click();
  await page.getByRole('combobox', { name: '纸张', exact: true }).click();
  await page.getByRole('option', { name: '160g珠光艳闪', exact: true }).click();
  await page.getByRole('combobox', { name: '规格', exact: true }).click();
  await page.getByRole('option', { name: '大号封90×165', exact: true }).click();
  await expect(
    page.getByRole('combobox', { name: '产品', exact: true }),
  ).toContainText('专版烫金 · 大号封');
  await selectFirstFrontColor(page);
  await page.getByRole('button', { name: '计算报价', exact: true }).click();
  await expect(page.getByText(/加工费价格版本/)).toBeVisible();
  await expect(page.getByText('待核价', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '重新选择产品、规格和纸张' }).click();
  await expect(page.getByText(/加工费价格版本/)).toHaveCount(0);
  await page.getByRole('combobox', { name: '规格', exact: true }).click();
  await page.getByRole('option', { name: '大号封90×165', exact: true }).click();
  await page.getByRole('combobox', { name: '纸张', exact: true }).click();
  await page.getByRole('option', { name: '160g珠光艳闪', exact: true }).click();
  await page.getByRole('button', { name: '计算报价', exact: true }).click();
  await expect(page.getByText(/加工费价格版本/)).toBeVisible();
});

test('prices immediately on entry and recalculates quantity, specification and markup without a calculate click', async ({
  page,
}) => {
  await login(page, {
    from: '/workbench',
    username: E2E_USERS.sales!.username,
    password: E2E_PASSWORD,
  });
  const amount = quotedAmount(page);
  // No form interaction is permitted before this assertion: the prototype's
  // complete initial example must already produce a live system quote.
  await expect(amount).toHaveText('¥ 438.75');
  await expect(firstFoilColor(page, '正面')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(
    page.getByRole('combobox', { name: '规格', exact: true }),
  ).toContainText('大号封90×165');
  await expect(
    page.getByRole('combobox', { name: '纸张', exact: true }),
  ).toContainText('160g珠光艳闪');
  await page.getByRole('spinbutton', { name: '数量（个）' }).fill('2000');
  await expect(amount).toHaveText('¥ 769.50');
  await expect(
    page.getByRole('spinbutton', { name: '数量（个）' }),
  ).toBeFocused();
  const midSpecification = (await choiceNames(page, '规格')).find((name) =>
    name.startsWith('中号封'),
  );
  expect(midSpecification).toBeTruthy();
  await selectChoice(page, '规格', midSpecification!);
  await expect(
    page.getByRole('combobox', { name: '产品', exact: true }),
  ).toContainText('专版烫金 · 中号封');
  await expect(firstFoilColor(page, '正面')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(amount).toHaveText('¥ 729.00');
  await page.getByRole('button', { name: '不加价', exact: true }).click();
  await expect(page.getByText(/加工费价格版本/)).toBeVisible();
  const base = await page
    .getByText('加工费', { exact: true })
    .locator('..')
    .locator('dd')
    .innerText();
  await expect(amount).toHaveText(base);
});

test('explains reverse-side pricing limitations and recovers automatically after correcting the combination', async ({
  page,
}) => {
  await login(page, {
    from: '/workbench',
    username: E2E_USERS.sales!.username,
    password: E2E_PASSWORD,
  });
  await expect(quotedAmount(page)).toHaveText('¥ 438.75');
  await firstFoilColor(page, '反面').click();
  await expect(
    page.getByText(
      '专版反面烫金暂不支持自动报价；如需反面烫金，请联系管理员核价',
      { exact: true },
    ),
  ).toBeVisible();
  await expect(quotedAmount(page)).toHaveCount(0);
  await firstFoilColor(page, '反面').click();
  await expect(quotedAmount(page)).toHaveText('¥ 438.75');

  await selectChoice(page, '产品类型', '彩印');
  await selectChoice(page, '烫金方式', '平烫');
  await selectFirstFrontColor(page);
  await firstFoilColor(page, '反面').click();
  await expect(
    page.getByText(
      '彩印加反面烫金暂不支持自动报价；如需反面烫金，请联系管理员核价',
      { exact: true },
    ),
  ).toBeVisible();

  await selectChoice(page, '产品类型', '局部烫金（通版现货）');
  await firstFoilColor(page, '正面').click();
  await firstFoilColor(page, '反面').click();
  await expect(
    page.getByText('请至少选择一种正面烫金颜色后自动计算', { exact: true }),
  ).toBeVisible();
  await selectFirstFrontColor(page);
  await expect(page.getByText(/加工费价格版本/)).toBeVisible();
  await expect(quotedAmount(page)).not.toHaveText('待核价');
  await expect(
    page.getByText('请至少选择一种正面烫金颜色后自动计算', { exact: true }),
  ).toHaveCount(0);
});

test('shows the specific missing paper price and recalculates when a priced paper is restored', async ({
  page,
}) => {
  await login(page, {
    from: '/workbench',
    username: E2E_USERS.sales!.username,
    password: E2E_PASSWORD,
  });
  await expect(quotedAmount(page)).toHaveText('¥ 438.75');
  await selectChoice(page, '纸张', '120g珠光艳闪');
  await expect(quotedAmount(page)).toHaveText('待核价');
  await expect(
    page.getByText('所选纸张暂无专版烫金价格，请选择其他纸张或联系管理员核价', {
      exact: true,
    }),
  ).toBeVisible();
  await selectChoice(page, '纸张', '160g珠光艳闪');
  await expect(quotedAmount(page)).toHaveText('¥ 438.75');
  await expect(
    page.getByText('所选纸张暂无专版烫金价格，请选择其他纸张或联系管理员核价', {
      exact: true,
    }),
  ).toHaveCount(0);
});

test('renders the partial foil charge once for the complete front and back combination', async ({
  page,
}) => {
  await login(page, {
    from: '/workbench',
    username: E2E_USERS.sales!.username,
    password: E2E_PASSWORD,
  });
  await selectChoice(page, '产品类型', '局部烫金（通版现货）');
  const machineCharge = page
    .getByRole('region', { name: '报价计算', exact: true })
    .locator('dl > div')
    .filter({ has: page.getByText('机烫费', { exact: true }) });
  await expect(quotedAmount(page)).toHaveText('¥ 229.50');
  await expect(machineCharge.locator('dt')).toHaveText(/机烫费\s*¥ 40\.00 × 1$/);
  await expect(machineCharge.locator('dd')).toHaveText('¥ 40.00');
  await firstFoilColor(page, '反面').click();
  await expect(quotedAmount(page)).toHaveText('¥ 283.50');
  await expect(machineCharge.locator('dt')).toHaveText(/机烫费\s*¥ 80\.00 × 1$/);
  await expect(machineCharge.locator('dd')).toHaveText('¥ 80.00');
});

test('ice-white full foil explicitly requires administrator pricing and recovers on paper change', async ({ page }) => {
  await login(page, { from: '/workbench', username: E2E_USERS.sales!.username, password: E2E_PASSWORD });
  await expect(quotedAmount(page)).toHaveText('¥ 438.75');
  await selectChoice(page, '纸张', '160g冰白纸');
  await expect(quotedAmount(page)).toHaveText('待核价');
  const guidance = page.getByText('冰白纸专版烫金由管理员手动核价，请提交工单后等待核价', { exact: true });
  await expect(guidance).toBeVisible();
  await expect(page.getByText('所选纸张暂无专版烫金价格，请选择其他纸张或联系管理员核价', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '2,000', exact: true }).click();
  await expect(quotedAmount(page)).toHaveText('待核价');
  await expect(guidance).toBeVisible();
  await selectChoice(page, '纸张', '160g红卡');
  await expect(quotedAmount(page)).toHaveText('¥ 769.50');
  await expect(guidance).toHaveCount(0);
});
