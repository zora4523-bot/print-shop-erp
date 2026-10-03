import { randomBytes, randomUUID } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { Client } from 'pg';
import { test as base, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { Role } from '../../generated/prisma/enums';
import { flattenAdminMenuItems, getAdminMenuItems, getAdminSidebarGroups } from '../../lib/navigation/admin-menu';
import { assertActivatedE2eDatabase } from '../../scripts/lib/e2e-environment';
import { E2E_PASSWORD, E2E_USERS } from './global-setup';

type NavigationRole = typeof Role.ADMIN | typeof Role.SALES;
type Session = Awaited<ReturnType<BrowserContext['storageState']>>;
type Records = { unnamedOrderId: string; namedOrderId: string; billId: string; itemId: string };
type NavigationState = { sessions: Record<NavigationRole, Session>; records: Records };
const longOrderName = '新年快乐·烫金大号红包礼盒装（第二批加急补单，客户指定金色）';
const longBillAgent = '外部销售货款核对记录及补充说明超长标题';
const billLabel = `2026-08 · ${longBillAgent}`;
const viewports = [
  [320, 568], [375, 667], [390, 844], [393, 852], [430, 932],
  [768, 1024], [1024, 768], [1280, 800], [1920, 1080],
] as const;

function observeErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  return errors;
}

async function createRecords(): Promise<Records> {
  const database = assertActivatedE2eDatabase();
  const db = new Client({ connectionString: database.url });
  await db.connect();
  try {
    const identity = await db.query<{ name: string }>('SELECT current_database() AS name');
    expect(identity.rows[0]?.name).toBe(database.databaseName);
    const users = await db.query<{ id: string; role: NavigationRole }>(
      'SELECT id, role FROM "User" WHERE username = ANY($1) AND "isActive" = TRUE',
      [[E2E_USERS.owner.username, E2E_USERS.sales.username]],
    );
    const adminId = users.rows.find((user) => user.role === Role.ADMIN)?.id;
    const salesId = users.rows.find((user) => user.role === Role.SALES)?.id;
    if (!adminId || !salesId) throw new Error('导航测试需要管理员和外部销售账号');
    const suffix = randomBytes(8).toString('hex');
    const records = {
      unnamedOrderId: `e2e-navigation-unnamed-${suffix}`,
      namedOrderId: `e2e-navigation-named-${suffix}`,
      billId: randomUUID(),
      itemId: randomUUID(),
    };
    await db.query('BEGIN');
    for (const [id, name] of [[records.unnamedOrderId, null], [records.namedOrderId, longOrderName]]) {
      await db.query(
        `INSERT INTO "Order" (id, "orderNo", "submitterId", "submitterRole", "createdById",
          "settlementType", "customName", status, "updatedAt")
         VALUES ($1, $1, $2, 'SALES', $2, 'EXTERNAL_SALES', $3, 'DRAFT', NOW())`,
        [id, salesId, name],
      );
    }
    const billingAgentId = `e2e-navigation-agent-${suffix}`;
    await db.query(
      `INSERT INTO "User" (id, username, password, role, "displayName", "updatedAt")
       SELECT $1::text, $1::text, password, 'SALES', $2, NOW() FROM "User" WHERE id = $3`,
      [billingAgentId, longBillAgent, salesId],
    );
    const settledOrderId = `e2e-navigation-settled-${suffix}`;
    await db.query(
      `INSERT INTO "Order" (id, "orderNo", "submitterId", "submitterRole", "createdById",
        "settlementType", status, "totalAmount", "processingAmount", "confirmedFee", "settledFee",
        "settledAt", "settlementContractVersion", "pricingStatus", "pricingConfirmedAt", "pricingConfirmedById",
        "submittedAt", "scheduledAt", "completedAt", "shippedAt", "finishedAt", "updatedAt")
       VALUES ($1, $1, $2, 'SALES', $2, 'EXTERNAL_SALES', 'SETTLED', 100, 100, 100, 100,
        '2026-08-15T04:00:00Z', 2, 'ADMIN_CONFIRMED', '2026-08-15T04:00:00Z', $3,
        '2026-08-15T04:00:00Z', '2026-08-15T04:00:00Z', '2026-08-15T04:00:00Z',
        '2026-08-15T04:00:00Z', '2026-08-15T04:00:00Z', NOW())`,
      [settledOrderId, billingAgentId, adminId],
    );
    await db.query(
      `INSERT INTO "AgentMonthlyBill" (id, "agentUserId", period, "agentUsernameSnapshot",
        "agentDisplayNameSnapshot", "memberSubtotal", "totalAmount", "updatedAt")
       VALUES ($1, $2, '2026-08', $2, $3, 100, 100, NOW())`,
      [records.billId, billingAgentId, longBillAgent],
    );
    await db.query(
      `INSERT INTO "AgentMonthlyBillItem" (id, "billId", "orderId", "orderNoSnapshot", "workOrderVersionSnapshot",
        "orderStatusSnapshot", "settledFeeSnapshot", "settledAtSnapshot", "updatedAt")
       VALUES ($1, $2, $3, $3, 1, 'SETTLED', 100, '2026-08-15T04:00:00Z', NOW())`,
      [records.itemId, records.billId, settledOrderId],
    );
    await db.query('COMMIT');
    return records;
  } finally {
    await db.end();
  }
}

async function signIn(browser: Browser, baseURL: string, role: NavigationRole): Promise<Session> {
  const context = await browser.newContext({ baseURL });
  try {
    const page = await context.newPage();
    const errors = observeErrors(page);
    await page.goto('/login?from=%2Forders');
    await page.locator('#username').fill(E2E_USERS[role === Role.ADMIN ? 'owner' : 'sales'].username);
    await page.locator('#password').fill(E2E_PASSWORD);
    await page.getByRole('button', { name: /登录|登 录/ }).click();
    await expect(page).toHaveURL(/\/orders$/);
    await expect(page.locator('[data-slot="admin-header"]')).toBeVisible();
    expect(errors).toEqual([]);
    return await context.storageState();
  } finally {
    await context.close();
  }
}

const test = base.extend<{ navigationRole: NavigationRole }, { navigationState: NavigationState }>({
  navigationRole: [Role.ADMIN, { option: true }],
  navigationState: [async ({ browser }, use, workerInfo) => {
    const baseURL = workerInfo.project.use.baseURL;
    if (!baseURL) throw new Error('导航测试需要 baseURL');
    const records = await createRecords();
    const admin = await signIn(browser, baseURL, Role.ADMIN);
    const sales = await signIn(browser, baseURL, Role.SALES);
    await use({ sessions: { ADMIN: admin, SALES: sales }, records });
  }, { scope: 'worker' }],
  storageState: async ({ navigationState, navigationRole }, provide) => {
    await provide(navigationState.sessions[navigationRole]);
  },
});

test.setTimeout(120_000);
test.use({ screenshot: 'off', video: 'off', trace: 'off' });

const pageErrors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => { pageErrors.set(page, observeErrors(page)); });
test.afterEach(async ({ page }) => { expect(pageErrors.get(page)).toEqual([]); });

async function settle(page: Page) {
  await expect.poll(() => page.evaluate(async () => {
    await document.fonts.ready;
    const rects = () => [...document.querySelectorAll('[data-slot="admin-header"] button, [data-slot="admin-header"] a, [data-sidebar] a, [data-sidebar] button')]
      .map((element) => {
        const { x, y, width, height } = element.getBoundingClientRect();
        return [x, y, width, height];
      });
    await new Promise(requestAnimationFrame);
    const before = rects();
    await new Promise(requestAnimationFrame);
    const after = rects();
    const animations = document.getAnimations().filter((animation) =>
      (animation.pending || animation.playState === 'running') && animation.effect?.getTiming().iterations !== Infinity,
    );
    return animations.length === 0 && !document.querySelector('[data-starting-style], [data-ending-style]')
      && JSON.stringify(before) === JSON.stringify(after);
  })).toBe(true);
}

async function visit(page: Page, path: string, theme = 'light') {
  await page.emulateMedia({ colorScheme: theme === 'dark' ? 'dark' : 'light' });
  const response = await page.goto(path);
  expect(response?.status()).toBe(200);
  await expect(page.locator('[data-slot="admin-header"]')).toBeVisible();
  await settle(page);
  if (await page.locator('html').getAttribute('data-theme') !== theme) {
    await page.getByRole('button', { name: '切换界面主题' }).click();
    await page.getByRole('menuitemradio', { name: theme === 'dark' ? '暗色' : '浅色', exact: true }).click();
    await page.keyboard.press('Escape');
    await settle(page);
  }
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
}

async function shellAccessibility(page: Page) {
  const audit = new AxeBuilder({ page }).include('[data-slot="admin-header"]');
  if (await page.getByRole('navigation', { name: '后台主导航' }).isVisible()) audit.include('[data-sidebar="sidebar"]');
  if (await page.getByRole('navigation', { name: '规则模块导航' }).isVisible()) audit.include('[aria-label="规则模块导航"]');
  if (await page.getByRole('dialog', { name: '后台导航菜单' }).isVisible()) audit.include('[data-slot="sheet-content"]');
  expect((await audit.analyze()).violations).toEqual([]);
}

async function breadcrumbAlignment(page: Page) {
  const metrics = await page.locator('[data-slot="admin-header"]').evaluate((header) =>
    [...header.querySelectorAll<HTMLElement>('[data-slot="breadcrumb-item"]')].filter((item) => item.checkVisibility()).map((item) => {
      const walker = document.createTreeWalker(item, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => node.textContent?.trim() && !node.parentElement?.closest('.sr-only')
          ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT,
      });
      const text = walker.nextNode();
      if (!text) throw new Error(`面包屑缺少文字：${item.outerHTML}`);
      const range = document.createRange();
      range.selectNodeContents(text);
      const line = range.getBoundingClientRect();
      const box = item.getBoundingClientRect();
      const link = item.querySelector('a')?.getBoundingClientRect();
      return { center: line.top + line.height / 2, boxCenter: box.top + box.height / 2,
        link: link ? { width: link.width, height: link.height } : null };
    }),
  );
  expect(metrics.length).toBeGreaterThan(0);
  for (const metric of metrics) {
    expect(Math.abs(metric.center - metric.boxCenter)).toBeLessThanOrEqual(2);
    if (metric.link) {
      expect(metric.link.width).toBeGreaterThanOrEqual(44);
      expect(metric.link.height).toBeGreaterThanOrEqual(44);
    }
  }
  expect(Math.max(...metrics.map((metric) => metric.center)) - Math.min(...metrics.map((metric) => metric.center))).toBeLessThanOrEqual(2);
}

async function menuLinks(page: Page, role: NavigationRole) {
  const nav = page.getByRole('navigation', { name: '后台主导航' });
  const expected = flattenAdminMenuItems(getAdminSidebarGroups(getAdminMenuItems({ role })).flatMap((group) => group.items))
    .filter((item) => item.href !== '#').map((item) => item.href).sort();
  expect(await nav.locator('a').evaluateAll((links) => links.map((link) => link.getAttribute('href')).sort())).toEqual(expected);
  await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
  const metrics = await nav.evaluate((element) => ({
    controls: [...element.querySelectorAll('a, button')].filter((control) => control.checkVisibility()).map((control) => {
      const style = getComputedStyle(control);
      return { size: style.fontSize, line: style.lineHeight, weight: style.fontWeight, height: control.getBoundingClientRect().height,
        emphasized: control.getAttribute('aria-current') === 'page' || Boolean(control.closest('[data-menu-level="action"]')) || control.hasAttribute('aria-expanded') };
    }),
    labels: [...element.querySelectorAll('[data-sidebar="group-label"]:not(:has(button))')].map((label) => getComputedStyle(label).fontSize),
  }));
  for (const metric of metrics.controls) {
    expect(metric.size).toBe('14px');
    expect(metric.line).toBe('20px');
    expect(metric.height).toBeCloseTo(44, 1);
    expect(metric.weight).toBe(metric.emphasized ? '500' : '400');
  }
  for (const label of metrics.labels) expect(label).toBe('12px');
  if (role === Role.SALES) {
    await expect(nav.locator('[data-menu-level="group"], [data-menu-level="children"]')).toHaveCount(0);
  } else {
    const rules = nav.locator('[data-menu-group="规则"]');
    await expect(rules.locator('[data-slot="sidebar-group-label"], button')).toHaveCount(0);
    await expect(rules.locator('a')).toHaveCount(1);
    await expect(rules.locator('a')).toHaveText('规则配置中心');
    await expect(nav.locator('a[href*="customer-pricing"]')).toHaveCount(0);
    await expect(nav.locator('a[href="/orders/new"]')).toHaveCount(1);
    await expect(nav.locator('a').first()).toHaveAttribute('href', '/orders/new');
  }
}

async function noOverflow(page: Page, width: number) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
}

for (const role of [Role.SALES, Role.ADMIN] as const) {
  test.describe(`${role} 导航`, () => {
    test.use({ navigationRole: role });
    for (const theme of ['light', 'dark']) for (const [width, height] of viewports) {
      test(`${theme} ${width}×${height}：布局、可访问操作及授权入口`, async ({ page }) => {
        await page.setViewportSize({ width, height });
        await visit(page, role === Role.ADMIN ? '/owner/rules/customer-pricing?section=blank' : '/orders/new', theme);
        const header = page.locator('[data-slot="admin-header"]');
        await expect(header.locator('[aria-label="快捷导航"], button button')).toHaveCount(0);
        await expect(header.locator('nav')).toHaveCount(1);
        const headerBox = (await header.boundingBox())!;
        expect(headerBox.height).toBe(56);
        expect(headerBox.x + headerBox.width).toBeLessThanOrEqual(width + 1);
        await breadcrumbAlignment(page);
        const buttons = await header.locator('button').evaluateAll((items) => items.map((item) => {
          const box = item.getBoundingClientRect();
          return { radius: getComputedStyle(item).borderRadius, width: box.width, height: box.height, left: box.left, right: box.right };
        }));
        expect(new Set(buttons.map((button) => button.radius)).size).toBe(1);
        for (const button of buttons) {
          expect(button.width).toBeGreaterThanOrEqual(44);
          expect(button.height).toBeGreaterThanOrEqual(44);
          expect(button.left).toBeGreaterThanOrEqual(headerBox.x);
          expect(button.right).toBeLessThanOrEqual(headerBox.x + headerBox.width);
        }
        await noOverflow(page, width);
        await shellAccessibility(page);
        if (role === Role.ADMIN) {
          await page.locator('summary').filter({ hasText: '规则目录' }).focus();
          await page.keyboard.press('Enter');
          const local = page.getByRole('navigation', { name: '规则模块导航' });
          await expect(local).toBeVisible();
          await expect(local.locator('a')).toHaveCount(11);
          await expect(local.locator('[aria-current="page"]')).toHaveCount(1);
          for (const link of await local.locator('a').all()) expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
          await noOverflow(page, width);
          await shellAccessibility(page);
        }
        if (width < 768) {
          await page.getByRole('button', { name: '打开/关闭侧边栏菜单' }).click();
          await expect(page.getByRole('dialog', { name: '后台导航菜单' })).toBeVisible();
          await settle(page);
          await shellAccessibility(page);
        }
        await menuLinks(page, role);
        const nav = page.getByRole('navigation', { name: '后台主导航' });
        const closedGroups = nav.locator('button[aria-expanded="false"]');
        while (await closedGroups.count()) await closedGroups.first().click();
        await menuLinks(page, role);
        const content = nav.locator('[data-sidebar="content"]');
        await expect(content).toHaveCSS('scrollbar-width', 'none');
        expect(await content.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
        if (width >= 768) {
          await page.getByRole('button', { name: '打开/关闭侧边栏菜单' }).click();
          await settle(page);
          for (const link of await nav.locator('a[data-sidebar="menu-button"]').all()) {
            await link.focus();
            const metric = await link.evaluate((element) => {
              const box = element.getBoundingClientRect();
              const clip = (element.closest('[data-sidebar="content"]') ?? element.closest('[data-sidebar="sidebar"]'))!.getBoundingClientRect();
              const icon = element.querySelector('svg')!.getBoundingClientRect();
              return { href: element.getAttribute('href'), width: box.width, height: box.height, left: box.left - clip.left, right: clip.right - box.right,
                top: box.top - clip.top, bottom: clip.bottom - box.bottom,
                centerDistance: Math.abs(icon.left + icon.width / 2 - (box.left + box.width / 2)),
                hitTarget: document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)?.outerHTML,
                hit: element.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)) };
            });
            expect(metric.width).toBeGreaterThanOrEqual(44);
            expect(metric.height).toBeGreaterThanOrEqual(44);
            expect(metric.left).toBeGreaterThanOrEqual(2);
            expect(metric.right).toBeGreaterThanOrEqual(2);
            expect(metric.top).toBeGreaterThanOrEqual(-1);
            expect(metric.bottom).toBeGreaterThanOrEqual(-1);
            expect(metric.centerDistance).toBeLessThanOrEqual(1);
            expect(metric.hit, JSON.stringify(metric)).toBe(true);
          }
          expect(await content.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
          await noOverflow(page, width);
        }
        await shellAccessibility(page);
        if (width < 768) {
          const controls = await page.locator('[data-mobile="true"]').evaluate((sidebar) =>
            [...sidebar.querySelectorAll<HTMLElement>('a, button:not([disabled])')].map((control) => {
              const box = control.getBoundingClientRect();
              const clip = (control.closest('[data-slot="sidebar-content"]') ?? sidebar).getBoundingClientRect();
              const x = box.left + box.width / 2;
              const y = box.top + box.height / 2;
              return { width: box.width, height: box.height, offsetWidth: control.offsetWidth, offsetHeight: control.offsetHeight,
                checkHit: x > Math.max(0, clip.left) && x < Math.min(innerWidth, clip.right) && y > Math.max(0, clip.top) && y < Math.min(innerHeight, clip.bottom),
                hit: control.contains(document.elementFromPoint(x, y)) };
            }).filter((control) => control.width && control.height),
          );
          for (const control of controls) {
            expect(control.width).toBeGreaterThanOrEqual(44);
            expect(control.height).toBeGreaterThanOrEqual(44);
            expect(control.offsetWidth).toBeGreaterThanOrEqual(44);
            expect(control.offsetHeight).toBeGreaterThanOrEqual(44);
            if (control.checkHit) expect(control.hit).toBe(true);
          }
          await page.keyboard.press('Escape');
          await expect(page.getByRole('dialog')).toHaveCount(0);
        }
      });
    }
  });
}

for (const role of [Role.ADMIN, Role.SALES] as const) test.describe(`${role} 账号操作`, () => {
  test.use({ navigationRole: role });
  for (const width of [393, 1280]) test(`${width}：主题和账号菜单支持键盘、焦点恢复及真实退出`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: role === Role.ADMIN && width === 1280 ? 'reduce' : 'no-preference' });
    await page.setViewportSize({ width, height: 852 });
    await visit(page, '/orders/new');
    const user = E2E_USERS[role === Role.ADMIN ? 'owner' : 'sales'];
    const roleLabel = role === Role.ADMIN ? '管理员后台' : '外部销售';
    const account = page.getByRole('button', { name: `用户菜单：${user.displayName}` });
    await account.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menuitem', { name: '修改密码' })).toBeVisible();
    await expect(page.getByRole('menu').getByText(roleLabel, { exact: true })).toBeVisible();
    await settle(page);
    await expect(page.getByRole('menu')).toHaveCSS('opacity', '1');
    const textPositions = await Promise.all(['修改密码', '退出登录'].map((name) =>
      page.getByRole('menuitem', { name, exact: true }).getByText(name, { exact: true })
        .evaluate((element) => element.getBoundingClientRect().left),
    ));
    expect(Math.abs(textPositions[0] - textPositions[1])).toBeLessThanOrEqual(1);
    expect((await new AxeBuilder({ page }).include('[data-slot="dropdown-menu-content"]').analyze()).violations).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(account).toBeFocused();
    const theme = page.getByRole('button', { name: '切换界面主题' });
    await theme.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menuitemradio', { name: '暗色', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(theme).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menuitemradio', { name: '浅色', exact: true })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Space');
    await expect(page.locator('html')).toHaveClass(/dark/);
    expect(await page.evaluate(() => localStorage.getItem('erp-theme'))).toBe('dark');
    await page.keyboard.press('Escape');
    await expect(theme).toBeFocused();
    await account.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menuitem', { name: '修改密码' })).toBeVisible();
    expect(await page.locator('[data-slot="user-menu-logout"]').evaluate((element) => Boolean(element.closest('form')))).toBe(true);
    await expect(page.getByRole('menu').getByText(roleLabel, { exact: true })).toBeVisible();
    await settle(page);
    await expect(page.getByRole('menu')).toHaveCSS('opacity', '1');
    expect((await new AxeBuilder({ page }).include('[data-slot="dropdown-menu-content"]').analyze()).violations).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(account).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menuitem', { name: '修改密码' })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    const logout = page.getByRole('menuitem', { name: '退出登录' });
    await expect(logout).toBeFocused();
    if (width === 393) await page.keyboard.press('Enter');
    else await logout.click();
    await expect(page).toHaveURL(/\/login/);
    await page.goto('/orders');
    await expect(page).toHaveURL(/\/login/);
  });
});

test('规则目录支持真实路由、当前模块标记和键盘收起', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await visit(page, '/owner/rules/customer-pricing?section=machine');
  const nav = page.getByRole('navigation', { name: '后台主导航' });
  await expect(nav.getByRole('link', { name: '规则配置中心', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(nav.locator('[href*="customer-pricing"]')).toHaveCount(0);
  const summary = page.locator('summary').filter({ hasText: '规则目录' });
  await summary.focus();
  await page.keyboard.press('Enter');
  const local = page.getByRole('navigation', { name: '规则模块导航' });
  await expect(local.getByRole('link', { name: '局部烫金机烫费' })).toHaveAttribute('aria-current', 'page');
  await local.getByRole('link', { name: '局部烫金机烫费' }).click();
  await expect(page).toHaveURL(/\/owner\/rules\/customer-pricing\?section=machine$/);
  await expect(local.locator('[aria-current="page"]')).toHaveCount(1);
  await summary.focus();
  await page.keyboard.press('Space');
  await expect(local).toBeHidden();
  await nav.getByRole('link', { name: '规则配置中心', exact: true }).click();
  await expect(page).toHaveURL(/\/owner\/rules$/);
  await expect(page.getByRole('navigation', { name: '规则模块导航' })).toHaveCount(0);
});

test('分组开关记忆和子页当前位置随真实访问生效', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await visit(page, '/workbench');
  const toggle = page.getByRole('button', { name: '财务结算 展开' });
  const bill = page.locator('nav[aria-label="后台主导航"] a[href="/owner/agent-bills"]');
  await expect(bill).toBeHidden();
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(bill).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('print-shop-erp:admin-sidebar-collapsed')!))).toMatchObject({ 财务结算: false });
  await page.keyboard.press('Space');
  await expect(bill).toBeHidden();
  await page.reload();
  await expect(bill).toBeHidden();
  await visit(page, '/owner/agent-bills');
  await expect(bill).toBeVisible();
  await expect(bill).toHaveAttribute('aria-current', 'page');
  await page.getByRole('button', { name: '财务结算 收起' }).click();
  await expect(bill).toBeHidden();
});

test('已有分组设置兼容，图标模式保留全部入口及键盘焦点', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await visit(page, '/workbench');
  await page.evaluate(() => localStorage.setItem('print-shop-erp:admin-sidebar-collapsed', JSON.stringify({ 财务: false, 运维: true, 规则: false })));
  await page.reload();
  const nav = page.getByRole('navigation', { name: '后台主导航' });
  const accounts = nav.locator('a[href="/owner/accounts"]');
  await expect(nav.getByRole('link', { name: '账单', exact: true })).toBeVisible();
  await expect(accounts).toBeHidden();
  await page.getByRole('button', { name: '打开/关闭侧边栏菜单' }).click();
  for (const link of await nav.locator('a').all()) await expect(link).toBeVisible();
  await accounts.focus();
  await expect(accounts).toBeFocused();
  await expect(nav.locator('a[href="/owner/rules"]')).toHaveCount(1);
  await page.getByRole('button', { name: '打开/关闭侧边栏菜单' }).click();
  await expect(accounts).toBeHidden();
  await expect(nav.getByRole('link', { name: '账单', exact: true })).toBeVisible();
});

test('鼠标切换主题后按 Escape 恢复焦点', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await visit(page, '/orders/new');
  const theme = page.getByRole('button', { name: '切换界面主题' });
  await theme.click();
  await page.getByRole('menuitemradio', { name: '暗色', exact: true }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.keyboard.press('Escape');
  await expect(theme).toBeFocused();
});

test('用户管理子页始终显示当前系统入口', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await visit(page, '/workbench');
  await page.evaluate(() => localStorage.setItem('print-shop-erp:admin-sidebar-collapsed', JSON.stringify({ 账号: true, 运维: true })));
  await visit(page, '/owner/accounts');
  const accounts = page.locator('nav[aria-label="后台主导航"] a[href="/owner/accounts"]');
  await expect(accounts).toBeVisible();
  await expect(accounts).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('button', { name: '系统管理 收起' })).toBeVisible();
});

for (const theme of ['light', 'dark']) for (const [width, height] of viewports) {
  test(`${theme} ${width}：真实页面的父级链接、单层及长标题面包屑`, async ({ browser, baseURL, navigationState }) => {
    const { records } = navigationState;
    for (const role of [Role.ADMIN, Role.SALES] as const) {
      const context = await browser.newContext({ baseURL, viewport: { width, height }, storageState: navigationState.sessions[role] });
      try {
        const page = await context.newPage();
        const errors = observeErrors(page);
        const listName = role === Role.ADMIN ? '工单列表' : '我的工单';
        const scenarios = [
          { path: '/orders/new', parentHref: '/orders', parentLabel: listName, current: '新建工单', longCurrent: false, longParent: false },
          { path: `/orders/${records.unnamedOrderId}`, parentHref: '/orders', parentLabel: listName, current: '工单详情', longCurrent: false, longParent: false },
          { path: `/orders/${records.namedOrderId}`, parentHref: '/orders', parentLabel: listName, current: longOrderName, longCurrent: true, longParent: false },
          { path: '/orders', parentHref: null, parentLabel: '', current: listName, longCurrent: false, longParent: false },
          ...(role === Role.SALES
            ? [{ path: '/sales/bills', parentHref: null, parentLabel: '', current: '我的货款账单', longCurrent: false, longParent: false }]
            : [{ path: `/owner/agent-bills/${records.billId}/credits/${records.itemId}/new`, parentHref: `/owner/agent-bills/${records.billId}`, parentLabel: billLabel, current: '录入抵扣或补收', longCurrent: false, longParent: true }]),
        ];
        for (const scenario of scenarios) {
          await visit(page, scenario.path, theme);
          const header = page.locator('[data-slot="admin-header"]');
          const current = header.locator('[aria-current="page"]');
          await expect(current).toHaveText(scenario.current);
          await breadcrumbAlignment(page);
          await expect(current).toHaveAttribute('aria-disabled', 'true');
          expect((await header.boundingBox())!.height).toBe(56);
          await noOverflow(page, width);
          if (scenario.longCurrent) {
            await expect(current).toHaveAttribute('title', scenario.current);
            await expect(current).toHaveCSS('text-overflow', 'ellipsis');
            const box = (await current.boundingBox())!;
            const bounds = (await header.boundingBox())!;
            expect(box.x + box.width).toBeLessThanOrEqual(bounds.x + bounds.width);
            if (width <= 768) expect(await current.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
          }
          if (scenario.parentHref) {
            const link = header.locator(`a[href="${scenario.parentHref}"]`);
            await expect(link).toBeVisible();
            expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
            await expect(link).toHaveText(scenario.parentLabel);
            await link.focus();
            await expect(link).toBeFocused();
            if (scenario.longParent) {
              const text = link.locator('span');
              await expect(text).toHaveAttribute('title', billLabel);
              await expect(text).toHaveCSS('text-overflow', 'ellipsis');
              await expect(text).toHaveCSS('white-space', 'nowrap');
              if (width <= 768) expect(await text.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
            }
            await link.click();
            await expect(page).toHaveURL(new URL(scenario.parentHref, baseURL).href);
          }
          if (scenario.path === '/sales/bills') await expect(header.locator('a[href="/sales"]')).toHaveCount(0);
        }
        expect(errors).toEqual([]);
      } finally {
        await context.close();
      }
    }
  });
}

test('折叠与展开保留导航节点及键盘焦点', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await visit(page, '/orders/new');
  const link = page.locator('[data-sidebar="menu-button"][href="/orders/new"]');
  const original = await link.elementHandle();
  await link.focus();
  for (const state of ['collapsed', 'expanded']) {
    await page.keyboard.press('Control+b');
    await expect(page.locator('[data-slot="sidebar"]')).toHaveAttribute('data-state', state);
    expect(await link.evaluate((element, previous) => element === previous, original)).toBe(true);
    await expect(link).toBeFocused();
  }
});

test('Reduced Motion 保持侧栏稳定及焦点边框可见', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1280, height: 800 });
  await visit(page, '/orders/new');
  const link = page.locator('a[data-sidebar="menu-button"]').first();
  await link.focus();
  await page.keyboard.press('Control+b');
  await settle(page);
  await expect(page.locator('[data-slot="sidebar"]')).toHaveAttribute('data-state', 'collapsed');
  expect(await page.locator('[data-slot="sidebar-container"]').evaluate((element) => parseFloat(getComputedStyle(element).transitionDuration))).toBeLessThanOrEqual(0.001);
  expect(await link.evaluate((element) => element.matches(':focus-visible'))).toBe(true);
  await expect(link).not.toHaveCSS('box-shadow', 'none');
  await expect(link).toBeFocused();
});
