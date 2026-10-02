import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { E2E_PASSWORD, E2E_USERS, getUserIdByUsername, login, seedCdrOrder, withDb } from './_helpers';

test.describe('管理工作台 CDR 下载', () => {
  test.use({ hasTouch: true });
  test.beforeEach(async () => {
    const sales = await getUserIdByUsername(E2E_USERS.sales.username);
    await seedCdrOrder({ submitterId: sales, cdrCount: 2 });
    await withDb(async (db) => {
      await db.query(`UPDATE "Order" SET status = 'CONFIRMED', "submittedAt" = NOW() - INTERVAL '3 days' WHERE id = 'e2e-cdr-1'`);
      await db.query(`UPDATE "OrderItemDesign" SET "fileUrl" = 'https://oss.example.com/design/' || id || '.cdr' WHERE "orderItemId" = 'e2e-cdr-1-item'`);
    });
  });

  test('跨日分组、选择、生成、历史、重试与权限', async ({ page, browser }) => {
    test.setTimeout(120000);
    await login(page, { from: '/owner?cdrQ=E2E-CDR-1', username: E2E_USERS.owner.username, password: E2E_PASSWORD });
    const section = page.locator('#cdr-download');
    await expect(section.getByText('E2E 销售（e2e-sales）', { exact: true })).toBeVisible();
    await section.locator('summary').filter({ hasText: '工单明细' }).click();
    await expect(section.getByText('E2E-CDR-1', { exact: false })).toBeVisible();
    await section.getByRole('checkbox', { name: /^全选本页/ }).check();
    await expect(section.getByRole('button', { name: '下载所选（1）' })).toBeEnabled();
    const submission = page.waitForRequest((req) => req.method() === 'POST' && !!req.headers()['next-action']);
    await section.getByRole('button', { name: '下载 E2E 销售（e2e-sales） 本页文件' }).click();
    const sent = await submission;
    await expect(section.getByText('打包记录已生成', { exact: true })).toBeVisible();
    await section.locator('summary').filter({ hasText: '下载记录' }).click();
    await expect(section.getByText('暂不可下载', { exact: true })).toBeVisible();
    await section.getByRole('button', { name: '按原工单重新生成' }).click();
    await expect(section.getByText('暂不可下载', { exact: true })).toHaveCount(2);
    const context = await browser.newContext();
    const salesPage = await context.newPage();
    await login(salesPage, { from: '/owner', username: E2E_USERS.sales.username, password: E2E_PASSWORD });
    await expect(salesPage.locator('#cdr-download')).toHaveCount(0);
    const before = await withDb((db) => db.query('SELECT count(*) FROM "DesignBundle"'));
    const denied = await salesPage.request.post('/owner', { headers: {
      'next-action': sent.headers()['next-action'], 'content-type': sent.headers()['content-type'],
      origin: new URL(page.url()).origin,
    }, data: sent.postDataBuffer()! });
    expect(denied.status()).toBeGreaterThanOrEqual(400);
    const after = await withDb((db) => db.query('SELECT count(*) FROM "DesignBundle"'));
    expect(after.rows).toEqual(before.rows);
    await context.close();
    await withDb((db) => db.query(`DELETE FROM "OrderItemDesign" WHERE "orderItemId"='e2e-cdr-1-item'`));
    await page.reload();
    await expect(section.getByText(/1 款缺少 CDR/)).toBeVisible();
    await expect(section.getByRole('button', { name: '一键下载本页' })).toBeDisabled();
    await expect(section.getByRole('heading', { name: /暂无可下载/ })).toHaveCount(0);
  });

  test('六视口、明暗、键盘、触控目标和 axe', async ({ page }, info) => {
    test.setTimeout(180000);
    await login(page, { from: '/owner?cdrQ=E2E-CDR-1', username: E2E_USERS.owner.username, password: E2E_PASSWORD });
    for (const [width, height] of [[375, 667], [393, 852], [768, 1024], [1024, 768], [1280, 800], [1920, 1080]]) {
      await page.setViewportSize({ width, height });
      for (const theme of ['light', 'dark']) {
        await page.evaluate((value) => { localStorage.setItem('erp-theme', value); document.documentElement.classList.toggle('dark', value === 'dark'); document.documentElement.dataset.theme = value; document.documentElement.style.colorScheme = value; }, theme);
        // Wait through actual theme paints so axe never reads an intermediate palette.
        for (let paint = 0; paint < 3; paint += 1) {
          await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
          await expect.poll(() => page.evaluate(() => document.getAnimations().filter((animation) =>
            (animation.playState === 'running' || animation.pending) && animation.effect?.getTiming().iterations !== Infinity,
          ).length)).toBe(0);
        }
        const section = page.locator('#cdr-download');
        await expect(section.getByRole('heading', { name: 'CDR 下载', exact: true })).toBeVisible();
        const summary = section.locator('summary').filter({ hasText: '工单明细' });
        await summary.focus(); await page.keyboard.press('Enter');
        await expect(section.getByText('E2E-CDR-1', { exact: false })).toBeVisible();
        expect(await section.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
        const badTargets = await section.locator('button:visible, input:visible:not([aria-hidden="true"]), select:visible, summary:visible, a:visible').evaluateAll((nodes) => nodes.filter((n) => {
          const r = n.getBoundingClientRect(); return r.width < 44 || r.height < 44;
        }).map((n) => n.textContent));
        expect(badTargets).toEqual([]);
        await page.screenshot({ path: info.outputPath(`cdr-${width}-${theme}.png`), fullPage: false });
        expect((await new AxeBuilder({ page }).include('#cdr-download').analyze()).violations).toEqual([]);
        await summary.tap();
      }
    }
  });
});
