import { test, expect, type Page } from '@playwright/test';
import {
  cleanupPrintableOrderStressFixture,
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

test.beforeAll(async () => {
  // Also removes residue left by a previously interrupted local run.
  await cleanupPrintableOrderStressFixture();
});

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  browserErrors.set(page, errors);
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
});

test.afterEach(async ({ page }) => {
  try {
    expect(browserErrors.get(page), '打印页不应产生浏览器错误').toEqual([]);
  } finally {
    await cleanupPrintableOrderStressFixture();
  }
});

async function waitForPrintReady(page: Page, sheetCount?: number) {
  await expect(page.locator('html[data-print-ready="true"]')).toHaveCount(1);
  await expect(page.locator('.work-order-document')).toBeVisible();
  if (sheetCount !== undefined) {
    await expect(page.locator('.work-order-document > .sheet')).toHaveCount(
      sheetCount,
    );
  }
  await expect(
    page.getByRole('button', { name: 'Open issues overlay' }),
  ).toHaveCount(0);
  // Next's development toolbar is outside the application, but its fixed host
  // can bleed into a tall element screenshot while Playwright scroll-stitches.
  await page.addStyleTag({
    content: 'nextjs-portal { display: none !important; }',
  });
}

async function renderPdfPageCount(page: Page): Promise<number> {
  await page.emulateMedia({ media: 'print' });
  const pdf = await page.pdf({
    printBackground: true,
    preferCSSPageSize: true,
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
  });
  return (pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) ?? []).length;
}

async function expectEverySheetFitsOneA4Page(page: Page) {
  const measurements = await page.locator('.sheet').evaluateAll((sheets) =>
    sheets.map((sheet) => ({
      clientHeight: sheet.clientHeight,
      scrollHeight: sheet.scrollHeight,
      renderedHeight: sheet.getBoundingClientRect().height,
    })),
  );
  for (const [index, measurement] of measurements.entries()) {
    expect(
      measurement.scrollHeight,
      `第 ${index + 1} 张模板页不应有隐藏溢出`,
    ).toBeLessThanOrEqual(
      measurement.clientHeight + 1,
    );
    // Chromium maps 297mm to roughly 1122.52 CSS px. A page that grows past
    // this boundary would make the browser add a physical page behind the
    // template's declared footer count.
    expect(
      measurement.renderedHeight,
      `第 ${index + 1} 张模板页不应超过 A4 高度`,
    ).toBeLessThanOrEqual(1124);
  }
}

async function readSupplementText(page: Page, label: string): Promise<string> {
  return page.locator('.supplement-annex').evaluateAll(
    (sections, targetLabel) =>
      sections
        .filter((section) =>
          section
            .querySelector('.annex-title')
            ?.textContent?.startsWith(targetLabel),
        )
        .map(
          (section) =>
            section.querySelector('.supplement-text')?.textContent ?? '',
        )
        .join(''),
    label,
  );
}

function textPreview(value: string, maxCharacters: number): string {
  const characters = Array.from(value);
  return characters.length <= maxCharacters
    ? value
    : `${characters.slice(0, maxCharacters).join('')}…`;
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
    await waitForPrintReady(page, 2);

    await expect(page.locator('.cust')).toHaveText([
      'VR-CUSTOMER',
      'VR-CUSTOMER',
    ]);
    await expect(page.locator('.hd .line').first()).toContainText(
      `工单 ${textPreview(customName!, 18)}`,
    );
    expect(await readSupplementText(page, '工单名称')).toBe(customName);

    const foilFact = page.locator('.fact').filter({
      has: page.getByText('烫金工艺', { exact: true }),
    });
    await expect(foilFact.locator('.l1')).toContainText(foilColors.join('、'));

    // 新模板只打印工单级备注；该 fixture 只有款式备注，
    // 因此不应恢复旧 item 卡片来把它混入生产工单。
    await expect(page.locator('.remark')).toHaveCount(0);
    await expect(page.getByText(itemRemark!, { exact: true })).toHaveCount(0);

    await expect(page.locator('.work-order-document')).toHaveScreenshot(
      'order-print-rich-context.png',
    );
    await expectEverySheetFitsOneA4Page(page);
    expect(await renderPdfPageCount(page)).toBe(2);
  });

  test('每个生产任务保留可扫描的独立报工二维码', async ({ page }) => {
    const adminId = await getUserIdByUsername(ADMIN_USERNAME);
    const { orderId } = await seedPrintableOrder({
      submitterId: adminId,
      designCount: 1,
      variant: 'task-qr',
    });

    await login(page, {
      from: `/print/orders/${orderId}`,
      username: E2E_USERS.owner!.username,
      password: E2E_PASSWORD,
    });
    await expect(page).toHaveURL(`/print/orders/${orderId}`);
    await waitForPrintReady(page, 1);

    await expect(page.locator('.flow tbody > tr')).toHaveCount(1);
    await expect(page.locator('.flow .step')).toContainText('E2E 局部烫金');
    await expect(page.locator('.flow .flow-item')).toHaveText('图 1 · VR 款式');
    await expect(page.locator('.item-process')).toContainText(
      '彩印 C、M、Y、K · 触感膜',
    );
    await expect(page.locator('.item-process')).toContainText(
      '局部浮雕 · 正面 哑金 / 反面 红金',
    );
    await expect(page.getByText('不烫金', { exact: true })).toHaveCount(0);
    await expect(page.locator('.task-qr')).toHaveCount(1);
    await expect(
      page.getByLabel('图 1 · VR 款式 E2E 局部烫金 任务报工二维码'),
    ).toHaveCount(1);
    const qrSize = await page.locator('.task-qr svg').evaluate((svg) => {
      const bounds = svg.getBoundingClientRect();
      return { width: bounds.width, height: bounds.height };
    });
    // 15mm @ 96dpi ≈ 56.7px. Long public URLs may expand the QR further
    // to preserve the minimum module size, but must never shrink below it.
    expect(qrSize.width).toBeGreaterThanOrEqual(56);
    expect(qrSize.height).toBeGreaterThanOrEqual(56);

    await expect(page.locator('.work-order-document')).toHaveScreenshot(
      'order-print-task-qr.png',
    );
  });

  test('6 条工序正好填满首张工序附页且页脚正确', async ({ page }) => {
    const adminId = await getUserIdByUsername(ADMIN_USERNAME);
    const { orderId } = await seedPrintableOrder({
      submitterId: adminId,
      designCount: 1,
      variant: 'task-qr',
      taskCount: 6,
    });

    await login(page, {
      from: `/print/orders/${orderId}`,
      username: E2E_USERS.owner!.username,
      password: E2E_PASSWORD,
    });
    await expect(page).toHaveURL(`/print/orders/${orderId}`);
    await waitForPrintReady(page, 2);

    await expect(
      page.locator('.sheet').first().locator('.flow tbody > tr'),
    ).toHaveCount(1);
    await expect(page.locator('.flow-annex')).toHaveCount(1);
    await expect(page.locator('.flow-annex tbody > tr')).toHaveCount(5);
    await expect(page.locator('.ft span:last-child')).toHaveText([
      '1 / 2',
      '2 / 2',
    ]);
    await expect(page.locator('.task-qr')).toHaveCount(6);
    await expect(page.locator('.work-order-document')).toHaveScreenshot(
      'order-print-task-boundary.png',
    );
    expect(await renderPdfPageCount(page)).toBe(2);
  });

  test('12 条工序拆分为三张附页并连续编号', async ({ page }) => {
    const adminId = await getUserIdByUsername(ADMIN_USERNAME);
    const { orderId } = await seedPrintableOrder({
      submitterId: adminId,
      designCount: 1,
      variant: 'task-qr',
      taskCount: 12,
    });

    await login(page, {
      from: `/print/orders/${orderId}`,
      username: E2E_USERS.owner!.username,
      password: E2E_PASSWORD,
    });
    await expect(page).toHaveURL(`/print/orders/${orderId}`);
    await waitForPrintReady(page, 4);

    await expect(
      page.locator('.sheet').first().locator('.flow tbody > tr'),
    ).toHaveCount(1);
    await expect(page.locator('.flow-annex')).toHaveCount(3);
    await expect(
      page.locator('.flow-annex').nth(0).locator('tbody > tr'),
    ).toHaveCount(5);
    await expect(
      page.locator('.flow-annex').nth(1).locator('tbody > tr'),
    ).toHaveCount(5);
    await expect(
      page.locator('.flow-annex').nth(2).locator('tbody > tr'),
    ).toHaveCount(1);
    await expect(page.locator('.task-qr')).toHaveCount(12);
    await expect(page.locator('.ft span:last-child')).toHaveText([
      '1 / 4',
      '2 / 4',
      '3 / 4',
      '4 / 4',
    ]);
    await expect(
      page.getByLabel('图 1 · VR 款式 E2E 局部烫金 任务报工二维码'),
    ).toHaveCount(12);
    await expect(page.locator('.work-order-document')).toHaveScreenshot(
      'order-print-task-overflow.png',
    );
    expect(await renderPdfPageCount(page)).toBe(4);
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
    await waitForPrintReady(page, 3);

    await expect(page.locator('.items tbody > tr')).toHaveCount(3);
    await expect(page.locator('.flow-annex tbody > tr')).toHaveCount(2);
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
    expect(await renderPdfPageCount(page)).toBe(3);
  });

  test('20 款工单的款式、图稿与工序按物理 A4 页拆分', async ({ page }) => {
    const adminId = await getUserIdByUsername(ADMIN_USERNAME);
    const { orderId } = await seedPrintableOrder({
      submitterId: adminId,
      designCount: 1,
      variant: 'large-items',
      itemCount: 20,
    });

    await login(page, {
      from: `/print/orders/${orderId}`,
      username: E2E_USERS.owner!.username,
      password: E2E_PASSWORD,
    });
    await expect(page).toHaveURL(`/print/orders/${orderId}`);
    await waitForPrintReady(page, 10);

    await expect(
      page.locator('.sheet').first().locator('.items tbody > tr'),
    ).toHaveCount(4);
    await expect(page.locator('.warning-annex')).toHaveCount(1);
    await expect(page.locator('.item-annex')).toHaveCount(2);
    await expect(
      page.locator('.item-annex').nth(0).locator('tbody > tr'),
    ).toHaveCount(12);
    await expect(
      page.locator('.item-annex').nth(1).locator('tbody > tr'),
    ).toHaveCount(4);
    await expect(page.locator('.artwork-annex')).toHaveCount(2);
    await expect(page.locator('.artwork-annex .thumb')).toHaveCount(20);
    await expect(page.locator('.flow-annex')).toHaveCount(4);
    await expect(page.locator('.ft span:last-child')).toHaveText(
      Array.from({ length: 10 }, (_, index) => `${index + 1} / 10`),
    );
    await expectEverySheetFitsOneA4Page(page);
    expect(await renderPdfPageCount(page)).toBe(10);
  });

  test('50 款边界的声明页数与实际 PDF 页数一致', async ({ page }) => {
    const adminId = await getUserIdByUsername(ADMIN_USERNAME);
    const { orderId } = await seedPrintableOrder({
      submitterId: adminId,
      designCount: 1,
      variant: 'large-items',
      itemCount: 50,
    });

    await login(page, {
      from: `/print/orders/${orderId}`,
      username: E2E_USERS.owner!.username,
      password: E2E_PASSWORD,
    });
    await expect(page).toHaveURL(`/print/orders/${orderId}`);
    await waitForPrintReady(page, 23);

    await expect(
      page.locator('.sheet').first().locator('.items tbody > tr'),
    ).toHaveCount(4);
    await expect(page.locator('.warning-annex')).toHaveCount(3);
    await expect(page.locator('.item-annex')).toHaveCount(4);
    await expect(
      page.locator('.item-annex').nth(0).locator('tbody > tr'),
    ).toHaveCount(12);
    await expect(
      page.locator('.item-annex').nth(1).locator('tbody > tr'),
    ).toHaveCount(12);
    await expect(
      page.locator('.item-annex').nth(2).locator('tbody > tr'),
    ).toHaveCount(12);
    await expect(
      page.locator('.item-annex').nth(3).locator('tbody > tr'),
    ).toHaveCount(10);
    await expect(page.locator('.artwork-annex')).toHaveCount(5);
    await expect(page.locator('.artwork-annex .thumb')).toHaveCount(50);
    await expect(page.locator('.flow-annex')).toHaveCount(10);
    await expect(page.locator('.ft span:last-child')).toHaveText(
      Array.from({ length: 23 }, (_, index) => `${index + 1} / 23`),
    );
    await expectEverySheetFitsOneA4Page(page);
    expect(await renderPdfPageCount(page)).toBe(23);
  });

  test('最长合法文本与 10 个地址也通过显式续页保持 PDF 页数一致', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const adminId = await getUserIdByUsername(ADMIN_USERNAME);
    const { orderId } = await seedPrintableOrder({
      submitterId: adminId,
      designCount: 1,
      variant: 'large-items',
      itemCount: 20,
      stressText: true,
    });

    await login(page, {
      from: `/print/orders/${orderId}`,
      username: E2E_USERS.owner!.username,
      password: E2E_PASSWORD,
    });
    await expect(page).toHaveURL(`/print/orders/${orderId}`);
    await waitForPrintReady(page);

    const sheets = page.locator('.work-order-document > .sheet');
    const sheetCount = await sheets.count();
    expect(sheetCount).toBeGreaterThan(70);
    await expect(page.locator('.supplement-annex')).not.toHaveCount(0);
    await expect(page.locator('.shipment-annex')).toHaveCount(3);
    await expect(page.locator('.ship-list > .ship')).toHaveCount(10);
    await expect(page.locator('.items tbody > tr')).toHaveCount(20);
    await expect(page.locator('.artwork-annex .thumb')).toHaveCount(20);
    await expect(page.locator('.flow tbody > tr')).toHaveCount(69);
    await expect(page.locator('.ft span:last-child')).toHaveText(
      Array.from(
        { length: sheetCount },
        (_, index) => `${index + 1} / ${sheetCount}`,
      ),
    );

    const remark = Array.from({ length: 500 }, () => '备').join('\n');
    const workerNames = Array.from({ length: 50 }, (_, index) => {
      const sequence = String(index + 1).padStart(2, '0');
      return `师傅${sequence}${'长'.repeat(60)}`;
    });
    const team = workerNames.join(' / ');
    const customer = '客'.repeat(128);
    const customName = '单'.repeat(100);

    await expect(page.locator('.cust')).toHaveText(
      Array.from({ length: sheetCount }, () => textPreview(customer, 16)),
    );
    await expect(page.locator('.hd .line b:first-of-type')).toHaveText(
      Array.from({ length: sheetCount }, () => textPreview(team, 18)),
    );
    expect(await readSupplementText(page, '客户')).toBe(customer);
    expect(await readSupplementText(page, '生产团队')).toBe(team);
    expect(await readSupplementText(page, '工单名称')).toBe(customName);
    expect(await readSupplementText(page, '备注')).toBe(remark);
    expect(
      await page.locator('.sheet').first().locator('.note').textContent(),
    ).not.toContain('\n');

    await expectEverySheetFitsOneA4Page(page);
    expect(await renderPdfPageCount(page)).toBe(sheetCount);
  });

  test('8 款、8 图、临界文本与双长地址不挤破密集主页', async ({
    page,
  }) => {
    const adminId = await getUserIdByUsername(ADMIN_USERNAME);
    const { orderId } = await seedPrintableOrder({
      submitterId: adminId,
      designCount: 1,
      variant: 'large-items',
      itemCount: 8,
      denseBoundary: true,
    });

    await login(page, {
      from: `/print/orders/${orderId}`,
      username: E2E_USERS.owner!.username,
      password: E2E_PASSWORD,
    });
    await expect(page).toHaveURL(`/print/orders/${orderId}`);
    await waitForPrintReady(page, 9);

    await expect(page.locator('.sheet').first()).toHaveClass(/\bdense\b/);
    await expect(
      page.locator('.sheet').first().locator('.items tbody > tr'),
    ).toHaveCount(4);
    await expect(page.locator('.item-annex tbody > tr')).toHaveCount(4);
    await expect(page.locator('.sheet').first().locator('.art')).toHaveCount(0);
    await expect(page.locator('.artwork-annex .thumb')).toHaveCount(8);
    await expect(page.locator('.shipment-annex')).toHaveCount(1);
    await expect(page.locator('.shipment-annex .ship')).toHaveCount(2);
    await expect(page.locator('.supplement-annex')).toHaveCount(2);
    await expect(page.locator('.ft span:last-child')).toHaveText(
      Array.from({ length: 9 }, (_, index) => `${index + 1} / 9`),
    );

    await expectEverySheetFitsOneA4Page(page);
    expect(await renderPdfPageCount(page)).toBe(9);
  });

  test('1 款 1 图因千字多行备注移入附页时仍严格对齐物理 A4', async ({
    page,
  }) => {
    const adminId = await getUserIdByUsername(ADMIN_USERNAME);
    const { orderId } = await seedPrintableOrder({
      submitterId: adminId,
      designCount: 1,
      variant: 'large-items',
      itemCount: 1,
      artworkAnnexBoundary: true,
    });
    const remark = Array.from({ length: 20 }, () => '备'.repeat(50)).join('\n');

    await login(page, {
      from: `/print/orders/${orderId}`,
      username: E2E_USERS.owner!.username,
      password: E2E_PASSWORD,
    });
    await expect(page).toHaveURL(`/print/orders/${orderId}`);
    await waitForPrintReady(page);

    const sheets = page.locator('.work-order-document > .sheet');
    const sheetCount = await sheets.count();
    await expect(page.locator('.sheet').first().locator('.art')).toHaveCount(0);
    await expect(page.locator('.artwork-annex')).toHaveCount(1);
    await expect(page.locator('.artwork-annex .thumb')).toHaveCount(1);
    await expect(page.locator('.artwork-annex img')).toHaveAttribute(
      'src',
      /^data:image\/svg\+xml;base64,/,
    );
    const artworkBox = await page.locator('.artwork-annex .box').boundingBox();
    expect(artworkBox).not.toBeNull();
    expect(artworkBox!.width).toBeLessThanOrEqual(455);
    expect(artworkBox!.height).toBeLessThanOrEqual(606);
    expect(await readSupplementText(page, '备注')).toBe(remark);
    await expect(page.locator('.ft span:last-child')).toHaveText(
      Array.from(
        { length: sheetCount },
        (_, index) => `${index + 1} / ${sheetCount}`,
      ),
    );

    await expectEverySheetFitsOneA4Page(page);
    expect(await renderPdfPageCount(page)).toBe(sheetCount);
  });

});
