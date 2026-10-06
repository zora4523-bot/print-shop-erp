import type { ComponentProps } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import { Role } from '@/generated/prisma/enums';
import {
  ADMIN_ROLE_BADGE,
  flattenAdminMenuItems,
  getAdminMenuItems,
  getAdminSidebarGroups,
} from '@/lib/navigation/admin-menu';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { waitForStableLayout } from '@/tests/browser/wait-for-layout';
import '@/app/globals.css';

const route = vi.hoisted(() => ({ pathname: '/orders/new', search: '' }));
vi.mock('next/navigation', () => ({
  usePathname: () => route.pathname,
  useSearchParams: () => new URLSearchParams(route.search),
}));
vi.mock('next/link', () => ({
  __esModule: true,
  default: ({
    prefetch: _prefetch,
    scroll: _scroll,
    onNavigate: _onNavigate,
    ...props
  }: ComponentProps<'a'> & { prefetch?: boolean; scroll?: boolean; onNavigate?: unknown }) => {
    void _prefetch;
    void _scroll;
    void _onNavigate;
    return <a {...props} />;
  },
  useLinkStatus: () => ({ pending: false }),
}));
vi.mock('@/actions/account', () => ({ signOutAction: vi.fn() }));

import { AdminHeader } from '../AdminHeader';
import { AppSidebar } from '../AppSidebar';
import { RuleCenterNavigation } from '@/components/business/rules/RuleCenterNavigation';
import { BreadcrumbEntity, BreadcrumbEntityProvider } from '../breadcrumb-entity';

let host: HTMLDivElement;
let root: Root;
const preventNavigation = (event: MouseEvent) => {
  if ((event.target as Element | null)?.closest('a[href]')) event.preventDefault();
};

beforeEach(() => {
  // Only this isolated browser-test context is changed; no login or database fixture.
  localStorage.removeItem('print-shop-erp:admin-sidebar-collapsed');
  route.search = '';
  host = document.createElement('div');
  host.dataset.testid = 'admin-shell-fixture';
  document.body.append(host);
  root = createRoot(host);
  document.documentElement.lang = 'zh-CN';
  document.addEventListener('click', preventNavigation);
});

afterEach(() => {
  document.removeEventListener('click', preventNavigation);
  flushSync(() => root.unmount());
  host.remove();
  document.documentElement.classList.remove('dark');
  delete document.documentElement.dataset.theme;
  document.documentElement.style.colorScheme = '';
  localStorage.removeItem('erp-theme');
  localStorage.removeItem('print-shop-erp:admin-sidebar-collapsed');
});

async function renderShell(
  role: Role,
  theme = 'light',
  environment = 'development',
  entityLabel: string | null = null,
) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  document.documentElement.dataset.theme = theme;
  flushSync(() => root.render(
    <SidebarProvider className="admin-viewport">
      <AppSidebar
        menuGroups={getAdminMenuItems({ role })}
        roleBadge={ADMIN_ROLE_BADGE[role]}
      />
      <SidebarInset id="admin-main" tabIndex={-1} className="min-w-0">
        <BreadcrumbEntityProvider>
          <AdminHeader
            displayName="导航测试账号"
            roleLabel={ADMIN_ROLE_BADGE[role]}
            environmentLabel={environment}
            role={role}
          />
          <div className="p-6">
            {entityLabel ? <BreadcrumbEntity label={entityLabel} /> : null}
            <h1>导航测试页面</h1>
            {role === Role.ADMIN && route.pathname.startsWith('/owner/rules') ? (
              <RuleCenterNavigation items={getAdminMenuItems({ role }).flatMap((group) => group.items).find((item) => item.href === '/owner/rules')?.children ?? []} />
            ) : null}
          </div>
        </BreadcrumbEntityProvider>
      </SidebarInset>
    </SidebarProvider>,
  ));
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

function assertBreadcrumbTextAlignment(header: HTMLElement) {
  const items = [...header.querySelectorAll<HTMLElement>('[data-slot="breadcrumb-item"]')]
    .filter((item) => item.checkVisibility());
  const centers: number[] = [];
  for (const item of items) {
    const walker = document.createTreeWalker(item, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => node.textContent?.trim() && !node.parentElement?.closest('.sr-only')
        ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT,
    });
    const text = walker.nextNode();
    expect(text, item.outerHTML).not.toBeNull();
    const range = document.createRange();
    range.selectNodeContents(text!);
    const line = range.getBoundingClientRect();
    const center = line.top + line.height / 2;
    centers.push(center);
    const box = item.getBoundingClientRect();
    // Measure glyphs, not only the centered 44px anchor box.
    expect(Math.abs(center - (box.top + box.height / 2)), item.textContent ?? '').toBeLessThanOrEqual(2);
    const link = item.querySelector('a');
    if (link) {
      expect(link.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
      expect(link.getBoundingClientRect().width).toBeGreaterThanOrEqual(44);
    }
  }
  expect(centers.length).toBeGreaterThan(0);
  expect(Math.max(...centers) - Math.min(...centers)).toBeLessThanOrEqual(2);
}

// A translating 44px control can have a fractional bounding-box width even
// though its layout width is 44px. Measure after the real transition finishes.
async function settleMobileSidebar() {
  expect(document.querySelector('[data-mobile="true"]')).not.toBeNull();
  await waitForStableLayout();
}

function assertMenuLinks(role: Role) {
  const nav = document.querySelector('[aria-label="后台主导航"]')!;
  const expected = flattenAdminMenuItems(
    getAdminSidebarGroups(getAdminMenuItems({ role })).flatMap((group) => group.items),
  ).filter((item) => item.href !== '#').map((item) => item.href).sort();
  const actual = [...nav.querySelectorAll('a')]
    .map((link) => link.getAttribute('href')).sort();
  expect(actual).toEqual(expected);
  expect(nav.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
  for (const control of nav.querySelectorAll('a, button')) {
    if (!control.checkVisibility()) continue;
    const style = getComputedStyle(control);
    expect(style.fontSize, control.textContent ?? '').toBe('14px');
    expect(style.lineHeight).toBe('20px');
    expect(control.getBoundingClientRect().height).toBeCloseTo(44, 1);
    const isEmphasized = control.getAttribute('aria-current') === 'page'
      || Boolean(control.closest('[data-menu-level="action"]'))
      || control.hasAttribute('aria-expanded');
    expect(style.fontWeight).toBe(isEmphasized ? '500' : '400');
  }
  for (const label of nav.querySelectorAll('[data-sidebar="group-label"]:not(:has(button))')) {
    expect(getComputedStyle(label).fontSize).toBe('12px');
  }
  if (role !== Role.ADMIN) {
    expect(nav.querySelector('[data-menu-level="group"]')).toBeNull();
    expect(nav.querySelector('[data-menu-level="children"]')).toBeNull();
  } else {
    const rules = nav.querySelector('[data-menu-group="规则"]')!;
    expect(rules.querySelector('[data-slot="sidebar-group-label"]')).toBeNull();
    expect(rules.querySelectorAll('a')).toHaveLength(1);
    expect(rules.querySelector('button')).toBeNull();
    expect(rules.querySelector('a')?.textContent).toBe('规则配置中心');
    expect(nav.querySelector('a[href*="customer-pricing"]')).toBeNull();
    expect(nav.querySelectorAll('a[href="/orders/new"]')).toHaveLength(1);
    expect(nav.querySelector('a')?.getAttribute('href')).toBe('/orders/new');
  }
}

const viewports = [
  [320, 568], [375, 667], [390, 844], [393, 852], [430, 932], [768, 1024],
  [1024, 768], [1280, 800], [1920, 1080],
] as const;

describe.each([Role.SALES, Role.ADMIN])('%s shared navigation', (role) => {
  for (const theme of ['light', 'dark']) {
    for (const [width, height] of viewports) {
      it(`${theme} ${width}×${height}: layout, accessible controls and authorized links`, async () => {
        await page.viewport(width, height);
        route.pathname = role === Role.ADMIN ? '/owner/rules/customer-pricing' : '/orders/new';
        await renderShell(role, theme);
        const header = host.querySelector('header')!;
        expect(header.querySelector('[aria-label="快捷导航"]')).toBeNull();
        expect(header.querySelectorAll('nav')).toHaveLength(1);
        expect(header.querySelectorAll('button button')).toHaveLength(0);
        const headerRect = header.getBoundingClientRect();
        expect(headerRect.height).toBe(56);
        assertBreadcrumbTextAlignment(header);
        expect(headerRect.right).toBeLessThanOrEqual(width + 1);
        const radii = [...header.querySelectorAll('button')].map(
          (button) => getComputedStyle(button).borderRadius,
        );
        expect(new Set(radii).size).toBe(1);
        for (const button of header.querySelectorAll('button')) {
          const rect = button.getBoundingClientRect();
          expect(rect.width).toBeGreaterThanOrEqual(44);
          expect(rect.height).toBeGreaterThanOrEqual(44);
          expect(rect.left).toBeGreaterThanOrEqual(headerRect.left);
          expect(rect.right).toBeLessThanOrEqual(headerRect.right);
        }
        expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
        expect(await commands.checkShellAccessibility()).toEqual([]);
        if (role === Role.ADMIN) {
          const summary = page.elementLocator(host.querySelector('summary')!);
          summary.element().focus();
          await userEvent.keyboard('{Enter}');
          const localNav = page.getByRole('navigation', { name: '规则模块导航' });
          await expect.element(localNav).toBeVisible();
          expect(localNav.element().querySelectorAll('a')).toHaveLength(11);
          expect(localNav.element().querySelectorAll('[aria-current="page"]')).toHaveLength(1);
          for (const link of localNav.element().querySelectorAll('a')) {
            expect(link.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
          }
          expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
          expect(await commands.checkShellAccessibility()).toEqual([]);
        }

        if (width < 768) {
          await page.getByRole('button', { name: '打开/关闭侧边栏菜单' }).click();
          await expect.element(page.getByRole('dialog', { name: '后台导航菜单' })).toBeVisible();
          await settleMobileSidebar();
          expect(await commands.checkShellAccessibility()).toEqual([]);
        }
        assertMenuLinks(role);
        if (role === Role.ADMIN && (width === 1280 || width === 375)) {
          await page.screenshot({ path: `__screenshots__/grouped-sidebar-${theme}-${width}.png` });
        }
        const nav = document.querySelector('[aria-label="后台主导航"]')!;
        for (const button of nav.querySelectorAll<HTMLButtonElement>('button[aria-expanded="false"]')) {
          await page.elementLocator(button).click();
        }
        assertMenuLinks(role);
        const content = nav.querySelector<HTMLElement>('[data-sidebar="content"]')!;
        expect(getComputedStyle(content).scrollbarWidth).toBe('none');
        expect(content.scrollWidth).toBeLessThanOrEqual(content.clientWidth);
        if (width >= 768) {
          await page.getByRole('button', { name: '打开/关闭侧边栏菜单' }).click();
          await waitForStableLayout(host);
          const sidebar = host.querySelector<HTMLElement>('[data-sidebar="sidebar"]')!;
          const bounds = sidebar.getBoundingClientRect();
          for (const link of sidebar.querySelectorAll<HTMLAnchorElement>('a[data-sidebar="menu-button"]')) {
            link.focus();
            const box = link.getBoundingClientRect();
            const clip = link.closest('[data-sidebar="content"]')?.getBoundingClientRect() ?? bounds;
            expect(box.width).toBeGreaterThanOrEqual(44);
            expect(box.height).toBeGreaterThanOrEqual(44);
            expect(box.left).toBeGreaterThanOrEqual(clip.left + 2);
            expect(box.right).toBeLessThanOrEqual(clip.right - 2);
            expect(box.top).toBeGreaterThanOrEqual(clip.top - 1);
            expect(box.bottom).toBeLessThanOrEqual(clip.bottom + 1);
            const icon = link.querySelector('svg')!.getBoundingClientRect();
            expect(Math.abs(icon.left + icon.width / 2 - (box.left + box.width / 2))).toBeLessThanOrEqual(1);
            expect(link.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2))).toBe(true);
          }
          expect(content.scrollWidth).toBeLessThanOrEqual(content.clientWidth);
          expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
        }
        await page.screenshot({ path: `__screenshots__/sidebar-scroll-${role}-${theme}-${width}.png` });
        expect(await commands.checkShellAccessibility()).toEqual([]);
        if (width < 768) {
          const sidebar = document.querySelector<HTMLElement>('[data-mobile="true"]')!;
          for (const control of sidebar.querySelectorAll<HTMLElement>('a, button:not([disabled])')) {
            const rect = control.getBoundingClientRect();
            if (!rect.width || !rect.height) continue;
            expect(control.offsetWidth).toBeGreaterThanOrEqual(44);
            expect(control.offsetHeight).toBeGreaterThanOrEqual(44);
            expect(rect.width).toBeGreaterThanOrEqual(44);
            expect(rect.height).toBeGreaterThanOrEqual(44);
            const clip = (control.closest('[data-slot="sidebar-content"]') ?? sidebar).getBoundingClientRect();
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;
            if (centerX > Math.max(0, clip.left) && centerX < Math.min(width, clip.right)
              && centerY > Math.max(0, clip.top) && centerY < Math.min(height, clip.bottom)) {
              expect(control.contains(document.elementFromPoint(centerX, centerY)), control.outerHTML).toBe(true);
            }
          }
          await userEvent.keyboard('{Escape}');
          await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
        }
      });
    }
  }
});

it('主题和账号菜单保持键盘、焦点与退出表单契约', async () => {
  await page.viewport(393, 852);
  route.pathname = '/orders/new';
  await renderShell(Role.SALES);
  const theme = page.getByRole('button', { name: '切换界面主题' });
  theme.element().focus();
  await userEvent.keyboard('{Enter}');
  await expect.element(page.getByRole('menuitemradio', { name: '暗色', exact: true })).toBeVisible();
  await userEvent.keyboard('{Escape}');
  await vi.waitFor(() => expect(document.activeElement).toBe(theme.element()));
  await userEvent.keyboard('{Enter}');
  await expect.element(page.getByRole('menuitemradio', { name: '浅色', exact: true })).toHaveFocus();
  await userEvent.keyboard('{ArrowDown} ');
  expect(document.documentElement.classList.contains('dark')).toBe(true);
  expect(localStorage.getItem('erp-theme')).toBe('dark');
  // Radio choices keep their menu open; dismiss before opening the account menu.
  await userEvent.keyboard('{Escape}');
  await vi.waitFor(() => expect(document.activeElement).toBe(theme.element()));
  const account = page.getByRole('button', { name: '用户菜单：导航测试账号' });
  account.element().focus();
  await userEvent.keyboard('{Enter}');
  await expect.element(page.getByRole('menuitem', { name: '修改密码' })).toBeVisible();
  expect(document.querySelector('[data-slot="user-menu-logout"]')?.closest('form')).not.toBeNull();
  await expect.element(page.getByText('外部销售', { exact: true })).toBeVisible();
  await userEvent.keyboard('{Escape}');
  await vi.waitFor(() => expect(document.activeElement).toBe(account.element()));
});

it('规则目录移入模块内，全局只保留一个当前模块入口', async () => {
  await page.viewport(1280, 800);
  route.pathname = '/owner/rules/customer-pricing';
  route.search = 'section=machine';
  await renderShell(Role.ADMIN);
  const nav = page.getByRole('navigation', { name: '后台主导航' });
  await expect.element(nav.getByRole('link', { name: '规则配置中心', exact: true })).toHaveAttribute('aria-current', 'page');
  expect(nav.element().querySelector('[href*="customer-pricing"]')).toBeNull();
  const summary = page.elementLocator(host.querySelector('summary')!);
  summary.element().focus();
  await userEvent.keyboard('{Enter}');
  const local = page.elementLocator(host.querySelector('[aria-label="规则模块导航"]')!);
  await expect.element(local.getByRole('link', { name: '局部烫金机烫费' })).toHaveAttribute('aria-current', 'page');
  await local.getByRole('link', { name: '局部烫金机烫费' }).click();
  expect(local.element().querySelectorAll('[aria-current="page"]')).toHaveLength(1);
  summary.element().focus();
  await userEvent.keyboard(' ');
  await expect.element(local).not.toBeVisible();
  route.pathname = '/owner/rules';
  route.search = '';
  await renderShell(Role.ADMIN);
  expect(host.querySelector('[aria-label="规则模块导航"]')).toBeNull();
});

it('低频组默认收起，键盘展开与收起记忆生效，进入子页自动显露当前位置', async () => {
  await page.viewport(1280, 800);
  route.pathname = '/workbench';
  await renderShell(Role.ADMIN);
  const toggle = page.getByRole('button', { name: '财务结算 展开' });
  const bill = page.elementLocator(host.querySelector('a[href="/owner/agent-bills"]')!);
  await expect.element(bill).not.toBeVisible();
  toggle.element().focus();
  await userEvent.keyboard('{Enter}');
  await expect.element(bill).toBeVisible();
  expect(JSON.parse(localStorage.getItem('print-shop-erp:admin-sidebar-collapsed')!)).toMatchObject({ 财务结算: false });
  await userEvent.keyboard(' ');
  await expect.element(bill).not.toBeVisible();
  await renderShell(Role.ADMIN);
  await expect.element(bill).not.toBeVisible();
  route.pathname = '/owner/agent-bills';
  await renderShell(Role.ADMIN);
  await expect.element(bill).toBeVisible();
  await expect.element(bill).toHaveAttribute('aria-current', 'page');
  await page.getByRole('button', { name: '财务结算 收起' }).click();
  await expect.element(bill).not.toBeVisible();
});

it('旧分组偏好兼容，图标模式保留所有模块入口与键盘焦点', async () => {
  await page.viewport(1280, 800);
  localStorage.setItem('print-shop-erp:admin-sidebar-collapsed', JSON.stringify({ 财务: false, 运维: true, 规则: false }));
  route.pathname = '/workbench';
  await renderShell(Role.ADMIN);
  const nav = page.getByRole('navigation', { name: '后台主导航' });
  await expect.element(nav.getByRole('link', { name: '账单', exact: true })).toBeVisible();
  await expect.element(page.elementLocator(nav.element().querySelector('a[href="/owner/accounts"]')!)).not.toBeVisible();
  await page.getByRole('button', { name: '打开/关闭侧边栏菜单' }).click();
  for (const link of nav.element().querySelectorAll('a')) expect(link.checkVisibility()).toBe(true);
  const accounts = page.elementLocator(nav.element().querySelector('a[href="/owner/accounts"]')!);
  accounts.element().focus();
  await expect.element(accounts).toHaveFocus();
  expect(nav.element().querySelectorAll('a[href="/owner/rules"]')).toHaveLength(1);
  await page.getByRole('button', { name: '打开/关闭侧边栏菜单' }).click();
  await expect.element(accounts).not.toBeVisible();
  await expect.element(nav.getByRole('link', { name: '账单', exact: true })).toBeVisible();
});

it('鼠标切换主题后按 Escape 关闭菜单，焦点返回主题按钮', async () => {
  await page.viewport(393, 852);
  route.pathname = '/orders/new';
  await renderShell(Role.SALES);
  const theme = page.getByRole('button', { name: '切换界面主题' });
  await theme.click();
  await page.getByRole('menuitemradio', { name: '暗色', exact: true }).click();
  expect(document.documentElement.classList.contains('dark')).toBe(true);
  await userEvent.keyboard('{Escape}');
  await vi.waitFor(() => expect(document.activeElement).toBe(theme.element()));
});

it('账号入口归入系统管理，打开账号页面时不被旧偏好隐藏', async () => {
  await page.viewport(1280, 800);
  localStorage.setItem('print-shop-erp:admin-sidebar-collapsed', JSON.stringify({ 账号: true, 运维: true }));
  route.pathname = '/owner/accounts';
  await renderShell(Role.ADMIN);
  const nav = page.getByRole('navigation', { name: '后台主导航' });
  const accounts = page.elementLocator(nav.element().querySelector('a[href="/owner/accounts"]')!);
  await expect.element(accounts).toBeVisible();
  await expect.element(accounts).toHaveAttribute('aria-current', 'page');
  await expect.element(page.getByRole('button', { name: '系统管理 收起' })).toBeVisible();
});

describe('breadcrumb text alignment in the real admin shell', () => {
  // 工单列表按角色取名（管理员「工单列表」、外部销售「我的工单」），两个角色都走真实页头。
  const listName = { [Role.ADMIN]: '工单列表', [Role.SALES]: '我的工单' } as const;
  type Scenario = {
    role: Role; path: string; parentHref: string | null; parentLabel?: string; current: string;
    entityLabel?: string; entityOnCurrent?: boolean;
  };
  const cases: Scenario[] = [
    ...([Role.ADMIN, Role.SALES] as const).flatMap((role): Scenario[] => [
      { role, path: '/orders/new', parentHref: '/orders', parentLabel: listName[role], current: '新建工单' },
      // 工单详情页头不再放「返回工单列表」：面包屑父级是唯一的返回入口，六视口都必须可见可聚焦。
      { role, path: '/orders/cabcdefghijklmnopqrstuvwx', parentHref: '/orders', parentLabel: listName[role], current: '工单详情' },
      // 末段显示工单名称（业主 2026-10-02），长名称在末段内省略，完整名称放在 title。
      {
        role,
        path: '/orders/cabcdefghijklmnopqrstuvwx',
        parentHref: '/orders',
        parentLabel: listName[role],
        current: '新年快乐·烫金大号红包礼盒装（第二批加急补单，客户指定金色）',
        entityLabel: '新年快乐·烫金大号红包礼盒装（第二批加急补单，客户指定金色）',
        entityOnCurrent: true,
      },
      { role, path: '/orders', parentHref: null, current: listName[role] },
    ]),
    { role: Role.SALES, path: '/sales/bills', parentHref: null, current: '我的货款账单' },
    {
      role: Role.ADMIN,
      path: '/owner/agent-bills/cabcdefghijklmnopqrstuvwx/credits/czyxwvutsrqponmlkjihgfedcb/new',
      parentHref: '/owner/agent-bills/cabcdefghijklmnopqrstuvwx',
      current: '录入抵扣或补收',
      entityLabel: '2026 年 8 月外部销售货款核对记录及补充说明超长标题',
    },
  ];
  for (const theme of ['light', 'dark']) {
    for (const [width, height] of viewports) {
      it(`${theme} ${width}: aligns linked, layout-only, single and long-title crumbs`, async () => {
        await page.viewport(width, height);
        for (const scenario of cases) {
          route.pathname = scenario.path;
          await renderShell(scenario.role, theme, 'production', scenario.entityLabel ?? null);
          const header = host.querySelector<HTMLElement>('header')!;
          assertBreadcrumbTextAlignment(header);
          const current = header.querySelector<HTMLElement>('[aria-current="page"]')!;
          expect(current.textContent).toBe(scenario.current);
          if (scenario.entityOnCurrent) {
            expect(current.title).toBe(scenario.current);
            expect(getComputedStyle(current).textOverflow).toBe('ellipsis');
            expect(current.getBoundingClientRect().right).toBeLessThanOrEqual(header.getBoundingClientRect().right);
            if (width <= 768) expect(current.scrollWidth).toBeGreaterThan(current.clientWidth);
          }
          expect(current.getAttribute('aria-disabled')).toBe('true');
          expect(header.getBoundingClientRect().height).toBe(56);
          expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
          if (scenario.parentHref) {
            const link = header.querySelector<HTMLAnchorElement>(`a[href="${scenario.parentHref}"]`)!;
            expect(link).not.toBeNull();
            expect(link.checkVisibility()).toBe(true);
            expect(link.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
            if (scenario.parentLabel) expect(link.textContent?.trim()).toBe(scenario.parentLabel);
            link.focus();
            expect(document.activeElement).toBe(link);
            if (scenario.entityLabel && !scenario.entityOnCurrent) {
              const text = link.querySelector<HTMLElement>('span')!;
              expect(text).not.toBeNull();
              // The truncating element itself carries the full label (visual gate: hidden-clipping).
              expect(text.title).toBe(scenario.entityLabel);
              expect(getComputedStyle(text).textOverflow).toBe('ellipsis');
              expect(getComputedStyle(text).whiteSpace).toBe('nowrap');
              if (width <= 768) expect(text.scrollWidth).toBeGreaterThan(text.clientWidth);
            }
          }
          if (scenario.path === '/sales/bills') expect(header.querySelector('a[href="/sales"]')).toBeNull();
        }
      });
    }
  }
});


it('折叠与展开侧栏保留导航节点和键盘焦点', async () => {
  await page.viewport(1280, 800);
  await renderShell(Role.ADMIN);
  const link = host.querySelector<HTMLAnchorElement>('[data-sidebar="menu-button"][href="/orders/new"]')!;
  expect(link).not.toBeNull();
  link.focus();
  for (const state of ['collapsed', 'expanded']) {
    await userEvent.keyboard('{Control>}b{/Control}');
    await expect.poll(() => host.querySelector('[data-slot="sidebar"]')?.getAttribute('data-state')).toBe(state);
    expect(host.querySelector('[data-sidebar="menu-button"][href="/orders/new"]')).toBe(link);
    expect(document.activeElement).toBe(link);
  }
});


it('减少动态效果时折叠菜单立即稳定且焦点边框可见', async () => {
  await commands.setReducedMotion(true);
  try {
    await page.viewport(1280, 800);
    await renderShell(Role.ADMIN);
    const link = host.querySelector<HTMLAnchorElement>('a[data-sidebar="menu-button"]')!;
    link.focus();
    await userEvent.keyboard('{Control>}b{/Control}');
    await waitForStableLayout(host);
    expect(host.querySelector('[data-slot="sidebar"]')?.getAttribute('data-state')).toBe('collapsed');
    const container = host.querySelector<HTMLElement>('[data-slot="sidebar-container"]')!;
    expect(parseFloat(getComputedStyle(container).transitionDuration)).toBeLessThanOrEqual(0.001);
    expect(link.matches(':focus-visible')).toBe(true);
    expect(getComputedStyle(link).boxShadow).not.toBe('none');
    expect(document.activeElement).toBe(link);
  } finally {
    await commands.setReducedMotion(false);
  }
});
