import { test, expect, type Page } from '@playwright/test';
import {
  login,
  ADMIN_USERNAME,
  E2E_PASSWORD,
  E2E_USERS,
  getUserIdByUsername,
  seedPrintableOrder,
} from '../e2e/_helpers';

// Production work-order visual regression. The committed screenshots cover
// each artwork density used by the print layout, including the annex boundary.
// seedPrintableOrder keeps IDs, QR content, dates, and inline artwork stable.

const ARTWORK_COUNTS = [1, 2, 3, 5, 8, 10] as const;
const browserErrors = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  browserErrors.set(page, errors);
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
});

test.afterEach(async ({ page }) => {
  expect(browserErrors.get(page), '打印页不应产生浏览器错误').toEqual([]);
});

async function waitForPrintReady(page: Page, sheetCount: number) {
  await expect(page.locator('html[data-print-ready="true"]')).toHaveCount(1);
  await expect(page.locator('.work-order-document')).toBeVisible();
  await expect(page.locator('.work-order-document > .sheet')).toHaveCount(
    sheetCount,
  );
  await expect(
    page.getByRole('button', { name: 'Open issues overlay' }),
  ).toHaveCount(0);
  // Next's development toolbar is outside the application, but its fixed host
  // can bleed into a tall element screenshot while Playwright scroll-stitches.
  await page.addStyleTag({
    content: 'nextjs-portal { display: none !important; }',
  });
}

test.describe('OrderPrintLayout 截图回归', () => {
  for (const count of ARTWORK_COUNTS) {
    test(`${count} 张图稿的主页与附页稳定`, async ({ page }) => {
      const adminId = await getUserIdByUsername(ADMIN_USERNAME);
      const { orderId } = await seedPrintableOrder({
        submitterId: adminId,
        designCount: count,
      });

      await login(page, {
        from: `/print/orders/${orderId}`,
        username: E2E_USERS.owner!.username,
        password: E2E_PASSWORD,
      });
      await expect(page).toHaveURL(`/print/orders/${orderId}`);

      const expectedSheets = count === 10 ? 2 : 1;
      await waitForPrintReady(page, expectedSheets);

      if (count === 10) {
        await expect(page.locator('.sheet').nth(0).locator('.art')).toHaveCount(
          0,
        );
        await expect(
          page.locator('.sheet').nth(1).locator('.artwork-annex .thumb'),
        ).toHaveCount(10);
      } else {
        await expect(page.locator('.sheet .art .thumb')).toHaveCount(count);
        await expect(page.locator('.artwork-annex')).toHaveCount(0);
      }

      await expect(page.locator('.work-order-document')).toHaveScreenshot(
        `order-print-${count}-designs.png`,
      );
    });
  }

  test('完整工单上下文稳定', async ({ page }) => {
    const adminId = await getUserIdByUsername(ADMIN_USERNAME);
    const { orderId, customName, itemRemark, foilColors } =
      await seedPrintableOrder({
        submitterId: adminId,
        designCount: 1,
        variant: 'rich-context',
      });

    await login(page, {
      from: `/print/orders/${orderId}`,
      username: E2E_USERS.owner!.username,
      password: E2E_PASSWORD,
    });
    await expect(page).toHaveURL(`/print/orders/${orderId}`);
    await waitForPrintReady(page, 1);

    await expect(page.locator('.cust')).toHaveText('VR-CUSTOMER');
    await expect(page.locator('.hd .line')).toContainText(`工单 ${customName}`);

    const foilFact = page.locator('.fact').filter({
      has: page.getByText('烫金颜色', { exact: true }),
    });
    await expect(foilFact.locator('.l0')).toHaveText(foilColors.join('、'));

    // 新模板只打印工单级备注；该 fixture 只有款式备注，
    // 因此不应恢复旧 item 卡片来把它混入生产工单。
    await expect(page.locator('.remark')).toHaveCount(0);
    await expect(page.getByText(itemRemark!, { exact: true })).toHaveCount(0);

    await expect(page.locator('.work-order-document')).toHaveScreenshot(
      'order-print-rich-context.png',
    );
  });

  test('三款工单的款式、多地址与打印分页稳定', async ({ page }) => {
    const adminId = await getUserIdByUsername(ADMIN_USERNAME);
    const { orderId } = await seedPrintableOrder({
      submitterId: adminId,
      designCount: 1,
      variant: 'three-items',
    });

    await login(page, {
      from: `/print/orders/${orderId}`,
      username: E2E_USERS.owner!.username,
      password: E2E_PASSWORD,
    });
    await expect(page).toHaveURL(`/print/orders/${orderId}`);
    await waitForPrintReady(page, 1);

    await expect(page.locator('.items tbody > tr')).toHaveCount(3);
    await expect(page.locator('.ship-list > .ship')).toHaveCount(2);
    await expect(page.locator('.ship-list')).toContainText('VR 主地址收件人');
    await expect(page.locator('.ship-list')).toContainText('佛山市测试主地址 88 号');
    await expect(page.locator('.ship-list')).toContainText('VR 分地址收件人');
    await expect(page.locator('.ship-list')).toContainText('广州市测试分地址 99 号');

    await expect(page.locator('.work-order-document')).toHaveScreenshot(
      'order-print-three-items.png',
    );

    const footerPositions = await page
      .locator('.sheet > .ft')
      .evaluateAll((footers) =>
        footers.map((footer) => getComputedStyle(footer).position),
      );
    expect(footerPositions).not.toContain('fixed');

    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('.work-order-document')).toHaveCSS(
      'print-color-adjust',
      'exact',
    );
    const pdf = await page.pdf({
      printBackground: true,
      preferCSSPageSize: true,
      margin: {
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
      },
    });
    const pageObjects = pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) ?? [];
    expect(pageObjects).toHaveLength(1);
  });
});
