import { expect, test } from '@playwright/test';
import { E2E_PASSWORD, E2E_USERS, login } from './_helpers';
import { assertSupplyChainIsolation, seedOutsourcePrerequisites } from './_supply-chain-fixtures';

test('从外协列表选择工单后真实创建外协', async ({ page }) => {
  test.setTimeout(60_000);
  assertSupplyChainIsolation();
  const fixture = await seedOutsourcePrerequisites();
  await login(page, { username: E2E_USERS.owner!.username, password: E2E_PASSWORD, from: '/foreman/outsource' });
  await page.getByRole('link', { name: '从工单创建外协', exact: true }).click();
  const allQueue = page.getByRole('navigation', { name: '工单队列', exact: true }).getByRole('link', { name: /^全部/ });
  await allQueue.click();
  await expect(allQueue).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('input[name="queue"]')).toHaveValue('all');
  await page.getByRole('textbox', { name: '搜索工单', exact: true }).fill(fixture.orderNo);
  await page.getByRole('button', { name: '应用筛选', exact: true }).click();
  await page.locator(`a[href="/orders/${fixture.orderId}"]`).first().click();
  await page.getByRole('link', { name: '新建外协单', exact: true }).click();
  await page.getByRole('checkbox', { name: /^#1 · 外协回归款1/ }).check();
  const supplierName = `可发现性回归外协厂 ${fixture.orderNo}`;
  await page.getByLabel('外协厂名 *', { exact: true }).fill(supplierName);
  await page.getByRole('button', { name: '创建并标记已发出', exact: true }).click();
  await expect(page).toHaveURL(/\/foreman\/outsource\/(?!new)[a-z0-9_-]+$/i);
  await page.getByRole('navigation', { name: '后台主导航', exact: true }).getByRole('link', { name: '外协', exact: true }).click();
  await expect(page).toHaveURL(/\/foreman\/outsource$/);
  await expect(page.getByRole('heading', { name: '外协单', exact: true })).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: supplierName })).toBeVisible();
});

for (const width of [375, 1280]) test(`管理员 ${width}px 从导航找到用料和供应商，采购管理链接保留输入`, async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width, height: 852 });
  await login(page, { username: E2E_USERS.owner!.username, password: E2E_PASSWORD, from: '/owner' });
  if (width === 375) await page.getByRole('button', { name: '打开/关闭侧边栏菜单', exact: true }).click();
  const dictionary = page.getByRole('button', { name: /^基础资料\s*(展开|收起)$/ });
  if (await dictionary.getAttribute('aria-expanded') !== 'true') await dictionary.click();
  await page.getByRole('link', { name: '用料清单', exact: true }).click();
  await expect(page).toHaveURL(/\/owner\/boms$/);
  if (width === 375) await page.getByRole('button', { name: '打开/关闭侧边栏菜单', exact: true }).click();
  await page.getByRole('link', { name: '客户/供应商', exact: true }).click();
  await expect(page.getByRole('heading', { name: '客户/供应商', exact: true })).toBeVisible();
  await page.goto('/owner/purchases/new');
  await page.getByLabel('采购数量', { exact: true }).fill('123');
  await page.getByLabel('单位成本（选填）', { exact: true }).fill('2.5');
  await page.getByLabel('备注（选填）', { exact: true }).fill('保留采购录入');
  await expect(page.getByLabel('采购数量', { exact: true })).toHaveValue('123');
  await expect(page.getByLabel('单位成本（选填）', { exact: true })).toHaveValue('2.5');
  await page.getByRole('link', { name: '管理供应商', exact: true }).click();
  await expect(page.getByRole('combobox', { name: '类型', exact: true })).toHaveValue('suppliers');
  await page.getByRole('link', { name: '返回原录入', exact: true }).click();
  await expect(page.getByLabel('采购数量', { exact: true })).toHaveValue('123');
  await expect(page.getByLabel('单位成本（选填）', { exact: true })).toHaveValue('2.5');
  await expect(page.getByLabel('备注（选填）', { exact: true })).toHaveValue('保留采购录入');
});

test('外协列表引导到工单列表，规则中心只有一个薪酬入口', async ({ page }) => {
  await login(page, { username: E2E_USERS.owner!.username, password: E2E_PASSWORD, from: '/foreman/outsource' });
  await page.getByRole('link', { name: '从工单创建外协', exact: true }).click();
  await expect(page).toHaveURL(/\/orders$/);
  await page.goto('/owner/rules');
  const main = page.locator('#admin-main');
  await expect(main.getByText('计件工价、标准工时与加班起点', { exact: true })).toBeVisible();
  const link = main.locator('a[href="/owner/rules/employee-pay"]');
  await expect(link).toHaveCount(1);
  await link.click();
  await expect(page).toHaveURL(/\/owner\/rules\/employee-pay$/);
});

for (const role of ['sales', 'workerHandPress'] as const) {
  test(`${role} 无字典管理入口且深链接拒绝`, async ({ page }) => {
    await login(page, { username: E2E_USERS[role]!.username, password: E2E_PASSWORD });
    await expect(page.getByRole('link', { name: '用料清单', exact: true })).toHaveCount(0);
    await expect(page.getByRole('link', { name: '客户/供应商', exact: true })).toHaveCount(0);
    for (const path of ['/owner/boms', '/owner/parties', '/foreman/outsource/new']) {
      await page.goto(path);
      await expect(page).not.toHaveURL(new RegExp(path));
    }
  });
}
