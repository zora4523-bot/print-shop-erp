import { expect, test, type Page } from '@playwright/test';
import { E2E_PASSWORD, E2E_USERS, login } from './_helpers';
import { RULE_CENTER_HREFS } from '../../lib/navigation/rule-center';

const blankHeading = '局部烫金 · 空白封现货单价';
const machineHeading = '局部烫金 · 机烫费与制版费';

async function expectPricingSection(page: Page, section: string, heading: string) {
  await expect(page).toHaveURL((url) =>
    url.pathname === RULE_CENTER_HREFS.customerPricing && url.searchParams.get('section') === section,
  );
  await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: heading, exact: true })).toBeVisible();
  await expect(page.getByText('价格业务板块暂时无法加载', { exact: true })).toHaveCount(0);
}

test.describe('customer pricing entry normalization', () => {
  test.describe.configure({ mode: 'serial' });

  // Repeat the complete sequence, rather than retrying and hiding a failed run.
  for (const run of [1, 2, 3]) {
    test(`production entry and navigation sequence ${run}`, async ({ page }) => {
      const pageErrors: string[] = [];
      page.on('pageerror', (error) => pageErrors.push(error.message));
      await login(page, {
        from: RULE_CENTER_HREFS.root,
        username: E2E_USERS.owner!.username,
        password: E2E_PASSWORD,
      });

      for (const entry of [
        RULE_CENTER_HREFS.customerPricing,
        `${RULE_CENTER_HREFS.customerPricing}?section=not-a-section`,
        '/owner/prices/external-sales',
      ]) {
        await test.step(`direct ${entry}`, async () => {
          await page.goto(entry);
          await expectPricingSection(page, 'blank', blankHeading);
          await page.reload();
          await expectPricingSection(page, 'blank', blankHeading);
          expect(pageErrors).toEqual([]);
        });
      }

      await test.step('legacy logistics entry retains its business section', async () => {
        await page.goto('/owner/prices/external-sales?section=logistics');
        await expectPricingSection(page, 'ship', '包装 · 纸箱耗材 · 中通快递');
      });

      await test.step('real Next links, back and forward keep the same document', async () => {
        await page.goto(RULE_CENTER_HREFS.root);
        const timeOrigin = await page.evaluate(() => performance.timeOrigin);
        await page.locator('main').getByRole('link', { name: /^空白封单价/ }).click();
        await expectPricingSection(page, 'blank', blankHeading);
        expect(await page.evaluate(() => performance.timeOrigin)).toBe(timeOrigin);
        await page.goBack();
        await expect(page.getByRole('heading', { name: '规则配置中心', exact: true })).toBeVisible();
        await page.goForward();
        await expectPricingSection(page, 'blank', blankHeading);
        expect(await page.evaluate(() => performance.timeOrigin)).toBe(timeOrigin);

        await page.goBack();
        await page.locator('main').getByRole('link', { name: /^局部烫金机烫费/ }).click();
        await expectPricingSection(page, 'machine', machineHeading);
        expect(await page.evaluate(() => performance.timeOrigin)).toBe(timeOrigin);
      });
      expect(pageErrors).toEqual([]);
    });
  }
});
