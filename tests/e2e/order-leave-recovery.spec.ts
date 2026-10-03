import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { E2E_PASSWORD, E2E_USERS, login } from './_helpers';

test.use({ hasTouch: true });

async function failDraftWrites(page: Page, storage: 'localStorage' | 'sessionStorage') {
  await page.evaluate((storageName) => {
    const original = Storage.prototype.setItem;
    const target = window[storageName];
    Storage.prototype.setItem = function (key, value) {
      if (this === target) throw new DOMException('full', 'QuotaExceededError');
      original.call(this, key, value);
    };
  }, storage);
}
async function openCreate(page: Page, actor: 'owner' | 'sales') {
  await login(page, { from: '/orders/new', username: E2E_USERS[actor].username, password: E2E_PASSWORD });
  await expect(page.getByRole('textbox', { name: '工单名称', exact: true })).toBeEnabled();
}
async function assertProtectedUnload(page: Page) {
  expect(await page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  })).toBe(true);
}

for (const actor of ['owner', 'sales'] as const) {
  test(`${actor}: failed draft save blocks batch switching and Next client navigation`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await openCreate(page, actor);
    await page.getByRole('button', { name: '＋ 添加工单', exact: true }).click();
    await failDraftWrites(page, 'localStorage');
    const name = page.getByRole('textbox', { name: '工单名称', exact: true });
    await name.fill('不能丢失的第二张工单');
    for (const action of ['工单 1', '移除当前工单', '＋ 添加工单']) {
      await page.getByRole('button', { name: action, exact: true }).click();
      await expect(name).toHaveValue('不能丢失的第二张工单');
    }
    await assertProtectedUnload(page);
    const back = page.getByRole('link', { name: '返回工单列表', exact: true });
    await back.click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: '保存草稿并离开', exact: true }).click();
    const notice = page.getByRole('alert').filter({ hasText: '本机草稿未保存' });
    await expect(notice).toContainText('工单 2 已填写的内容');
    await expect(page).toHaveURL(/\/orders\/new$/);
    await notice.getByRole('button', { name: '留在本页', exact: true }).click();
    await expect(back).toBeFocused();
    await expect(name).toHaveValue('不能丢失的第二张工单');
    expect(errors).toEqual([]);
  });

  for (const purpose of ['打样', '寄样品']) {
    test(`${actor}: ${purpose} protects actual contact edits with unavailable session storage`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await openCreate(page, actor);
      await page.getByRole('button', { name: purpose, exact: true }).click();
      await failDraftWrites(page, 'sessionStorage');
      const address = page.getByLabel('收货地址', { exact: true });
      await address.fill('浙江省杭州市尚未保存的新地址');
      await assertProtectedUnload(page);
      await page.getByRole('link', { name: '返回工单列表', exact: true }).click();
      await page.getByRole('alertdialog').getByRole('button', { name: '保存草稿并离开', exact: true }).click();
      await expect(page.getByRole('alert').filter({ hasText: '本机草稿未保存' })).toContainText('浏览器无法写入本机草稿');
      await expect(page).toHaveURL(/\/orders\/new$/);
      await page.getByRole('button', { name: '＋ 添加工单', exact: true }).click();
      await expect(address).toHaveValue('浙江省杭州市尚未保存的新地址');
      expect(errors).toEqual([]);
    });
  }
}

test('save failure confirmation supports six viewports, both themes, touch and focus return', async ({ page }) => {
  test.setTimeout(120_000);
  await openCreate(page, 'owner');
  await failDraftWrites(page, 'localStorage');
  await page.getByRole('textbox', { name: '工单名称', exact: true }).fill('离开保护布局验证');
  const back = page.getByRole('link', { name: '返回工单列表', exact: true });
  for (const width of [375, 393, 768, 1024, 1280, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    for (const dark of [false, true]) {
      await page.evaluate((value) => document.documentElement.classList.toggle('dark', value), dark);
      await back.tap();
      const dialog = page.getByRole('alertdialog');
      await dialog.getByRole('button', { name: '保存草稿并离开', exact: true }).tap();
      const notice = page.getByRole('alert').filter({ hasText: '本机草稿未保存' });
      await expect(notice).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      const dismiss = notice.getByRole('button', { name: '留在本页', exact: true });
      const bounds = await dismiss.boundingBox();
      expect(bounds?.height).toBeGreaterThanOrEqual(44);
      expect(bounds?.width).toBeGreaterThanOrEqual(44);
      expect((await new AxeBuilder({ page }).include('[role="alert"]').analyze()).violations).toEqual([]);
      await dismiss.tap();
      await expect(back).toBeFocused();
    }
  }
});

/**
 * 全应用导航守卫（2026-10-04）：侧栏、面包屑父级与浏览器后退在真实外壳里同样经过建单离开判定。
 * 修复前这三条路径都直接离开，未上传的设计文件与未存草稿的内容静默丢失。
 */
const SHELL = {
  owner: { sidebarHref: '/orders', parent: '工单列表' },
  sales: { sidebarHref: '/sales/bills', parent: '我的工单' },
} as const;

async function selectDesignFile(page: Page) {
  await page.getByLabel('第 1 款 CDR 文件', { exact: true }).setInputFiles({ name: '外壳离开.cdr', mimeType: 'application/octet-stream', buffer: Buffer.from('cdr') });
}

for (const actor of ['owner', 'sales'] as const) {
  test(`${actor}: sidebar, breadcrumb parent and browser back confirm before leaving order creation`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await login(page, { from: '/orders', username: E2E_USERS[actor].username, password: E2E_PASSWORD });
    // Enter creation through the sidebar so browser back is a same-document traversal.
    await page.locator('nav[aria-label="后台主导航"] a[href="/orders/new"]').click();
    await expect(page).toHaveURL(/\/orders\/new$/);
    const name = page.getByRole('textbox', { name: '工单名称', exact: true });
    await expect(name).toBeEnabled();
    await name.fill(`${actor} 外壳离开保护`);
    // Typed text is autosaved as a local draft; an unuploaded file stays at risk until confirmed.
    await selectDesignFile(page);
    const dialog = page.getByRole('alertdialog');

    const sidebar = page.locator(`nav[aria-label="后台主导航"] a[href="${SHELL[actor].sidebarHref}"]`);
    await sidebar.click();
    await expect(dialog).toContainText('1 个未上传的设计文件将丢失。');
    await expect(page).toHaveURL(/\/orders\/new$/);
    await dialog.getByRole('button', { name: '继续编辑', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(sidebar).toBeFocused();

    const parent = page.getByRole('navigation', { name: '面包屑导航' }).getByRole('link', { name: SHELL[actor].parent, exact: true });
    await parent.click();
    await expect(dialog).toContainText('1 个未上传的设计文件将丢失。');
    await expect(page).toHaveURL(/\/orders\/new$/);
    await dialog.getByRole('button', { name: '继续编辑', exact: true }).click();
    await expect(dialog).toHaveCount(0);

    // A cancelled traversal never commits, so do not wait for the navigation to finish.
    void page.goBack({ waitUntil: 'commit', timeout: 5_000 }).catch(() => undefined);
    await expect(dialog).toContainText('1 个未上传的设计文件将丢失。');
    await expect(page).toHaveURL(/\/orders\/new$/);
    await dialog.getByRole('button', { name: '继续编辑', exact: true }).click();
    await expect(name).toHaveValue(`${actor} 外壳离开保护`);
    void page.goBack({ waitUntil: 'commit', timeout: 5_000 }).catch(() => undefined);
    await dialog.getByRole('button', { name: '放弃修改并离开', exact: true }).click();
    await expect(page).toHaveURL(/\/orders(\?.*)?$/);
    expect(errors).toEqual([]);
  });

  test(`${actor}: an unuploaded design file is only discarded after confirming the sidebar link`, async ({ page }) => {
    await openCreate(page, actor);
    await selectDesignFile(page);
    const dialog = page.getByRole('alertdialog');
    await page.locator(`nav[aria-label="后台主导航"] a[href="${SHELL[actor].sidebarHref}"]`).click();
    await expect(dialog).toContainText('1 个未上传的设计文件将丢失。');
    await dialog.getByRole('button', { name: '放弃修改并离开', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${SHELL[actor].sidebarHref}(\\?.*)?$`));
  });
}

test('owner: a confirmed sidebar leave keeps the sidebar link pending during a slow navigation', async ({ page }) => {
  await openCreate(page, 'owner');
  await selectDesignFile(page);
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  // Hold the RSC payload of the destination so the navigation stays in flight.
  await page.route((url) => url.pathname === '/orders' && url.searchParams.has('_rsc'), async (route) => {
    await held;
    await route.continue();
  });
  const link = page.locator('nav[aria-label="后台主导航"] a[href="/orders"]');
  await link.click();
  const dialog = page.getByRole('alertdialog');
  await dialog.getByRole('button', { name: '放弃修改并离开', exact: true }).click();
  await expect(link.locator('[data-pending="true"]')).toBeVisible();
  await expect(page).toHaveURL(/\/orders\/new$/);
  release();
  await expect(page).toHaveURL(/\/orders$/);
  await expect(link.locator('[data-pending="true"]')).toHaveCount(0);
});
