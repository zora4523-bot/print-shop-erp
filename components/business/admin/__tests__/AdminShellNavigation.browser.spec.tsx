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
} from '@/lib/navigation/admin-menu';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
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
    ...props
  }: ComponentProps<'a'> & { prefetch?: boolean }) => {
    void _prefetch;
    return <a {...props} />;
  },
  useLinkStatus: () => ({ pending: false }),
}));
vi.mock('@/actions/account', () => ({ signOutAction: vi.fn() }));

import { AdminHeader } from '../AdminHeader';
import { AppSidebar } from '../AppSidebar';
import { BreadcrumbEntity, BreadcrumbEntityProvider } from '../breadcrumb-entity';

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  // Only this isolated browser-test context is changed; no login or database fixture.
  localStorage.removeItem('print-shop-erp:admin-sidebar-collapsed');
  host = document.createElement('div');
  host.dataset.testid = 'admin-shell-fixture';
  document.body.append(host);
  root = createRoot(host);
  document.documentElement.lang = 'zh-CN';
});

afterEach(() => {
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
          />
          <div className="p-6">
            {entityLabel ? <BreadcrumbEntity label={entityLabel} /> : null}
            <h1>导航测试页面</h1>
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

async function settleMobileSidebar() {
  const sidebar = document.querySelector<HTMLElement>('[data-mobile="true"]')!;
  await expect.poll(() => sidebar.hasAttribute('data-starting-style')).toBe(false);
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
  // A translating 44px control can have a fractional bounding-box width even
  // though its layout width is 44px. Measure after the real transition finishes.
  await expect.poll(() => sidebar.getAnimations({ subtree: true })
    .some((animation) => animation.pending || animation.playState === 'running')).toBe(false);
}

function assertMenuLinks(role: Role) {
  const nav = document.querySelector('[aria-label="后台主导航"]')!;
  const expected = flattenAdminMenuItems(
    getAdminMenuItems({ role }).flatMap((group) => group.items),
  ).filter((item) => item.href !== '#').map((item) => item.href).sort();
  const actual = [...nav.querySelectorAll('a')]
    .map((link) => link.getAttribute('href')).sort();
  expect(actual).toEqual(expected);
  expect(nav.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
  for (const control of nav.querySelectorAll('a, button')) {
    const style = getComputedStyle(control);
    expect(style.fontSize, control.textContent ?? '').toBe('14px');
    expect(style.lineHeight).toBe('20px');
    expect(control.getBoundingClientRect().height).toBeCloseTo(44, 1);
    const isEmphasized = control.getAttribute('aria-current') === 'page'
      || Boolean(control.closest('[data-menu-level="parent"]') && control.matches('a[data-sidebar="menu-button"]'))
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
    const link = rules.querySelector<HTMLAnchorElement>('a[href="/owner/rules"]')!;
    const toggle = rules.querySelector<HTMLButtonElement>('button')!;
    expect(link.textContent).toBe('规则配置中心');
    expect(toggle.getAttribute('aria-label')).toBe('收起规则配置中心子菜单');
    expect(toggle.closest('a')).toBeNull();
    const linkRect = link.getBoundingClientRect();
    const toggleRect = toggle.getBoundingClientRect();
    expect(linkRect.top).toBe(toggleRect.top);
    // 移动抽屉的 transform 可能引入不足 0.01px 的浮点舍入差。
    expect(linkRect.right).toBeLessThanOrEqual(toggleRect.left + 0.01);
    expect(toggleRect.right).toBeLessThanOrEqual(nav.getBoundingClientRect().right);
  }
}

const viewports = [
  [375, 667], [393, 852], [768, 1024],
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

        if (width < 768) {
          await page.getByRole('button', { name: '打开/关闭侧边栏菜单' }).click();
          await expect.element(page.getByRole('dialog', { name: '后台导航菜单' })).toBeVisible();
          await settleMobileSidebar();
          expect(await commands.checkShellAccessibility()).toEqual([]);
        }
        assertMenuLinks(role);
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

it('规则中心入口与折叠按钮合为一行，键盘折叠后仍可进入总览', async () => {
  await page.viewport(1280, 800);
  route.pathname = '/owner/rules/customer-pricing';
  await renderShell(Role.ADMIN);
  assertMenuLinks(Role.ADMIN);
  const toggle = page.getByRole('button', { name: '收起规则配置中心子菜单' });
  toggle.element().focus();
  await userEvent.keyboard('{Enter}');
  expect(document.querySelector('[aria-label="规则配置中心子菜单"]')).toBeNull();
  // 面包屑现在保留父级「规则配置中心」，这里断言的是侧栏入口。
  await expect.element(page.getByRole('link', { name: '规则配置中心', exact: true }).and(page.elementLocator(document.querySelector('[data-sidebar="menu-button"][href="/owner/rules"]')!))).toBeVisible();
  expect(JSON.parse(localStorage.getItem('print-shop-erp:admin-sidebar-collapsed')!)).toMatchObject({ 规则: true });
  expect(await commands.checkShellAccessibility()).toEqual([]);
  await userEvent.keyboard(' ');
  assertMenuLinks(Role.ADMIN);
  expect(host.querySelector('[data-menu-group="规则"] [data-menu-level="group-children"]')?.className).not.toContain('pl-2');
});

it('原有规则折叠偏好继续生效，图标模式与总览入口保持可用', async () => {
  await page.viewport(1280, 800);
  localStorage.setItem('print-shop-erp:admin-sidebar-collapsed', JSON.stringify({ 规则: true }));
  route.pathname = '/owner/rules';
  await renderShell(Role.ADMIN);
  const nav = page.getByRole('navigation', { name: '后台主导航' });
  const link = nav.getByRole('link', { name: '规则配置中心', exact: true });
  await expect.element(link).toHaveAttribute('href', '/owner/rules');
  await expect.element(link).toHaveAttribute('aria-current', 'page');
  const toggle = page.getByRole('button', { name: '展开规则配置中心子菜单' }).element();
  await expect.element(toggle).toBeVisible();
  expect(document.querySelector('[aria-label="规则配置中心子菜单"]')).toBeNull();
  await page.getByRole('button', { name: '打开/关闭侧边栏菜单' }).click();
  await expect.element(link).toBeVisible();
  await expect.element(toggle).not.toBeVisible();
  await page.getByRole('button', { name: '打开/关闭侧边栏菜单' }).click();
  await page.getByRole('button', { name: '展开规则配置中心子菜单' }).click();
  assertMenuLinks(Role.ADMIN);
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

it('账号始终展开，不受旧折叠偏好影响', async () => {
  await page.viewport(1280, 800);
  localStorage.setItem('print-shop-erp:admin-sidebar-collapsed', JSON.stringify({ 账号: true, 财务: true }));
  route.pathname = '/owner/accounts';
  await renderShell(Role.ADMIN);
  const group = host.querySelector('[data-menu-group="账号"]')!;
  expect(group.querySelector('button[aria-expanded]')).toBeNull();
  await expect.element(page.getByRole('navigation', { name: '后台主导航' }).getByRole('link', { name: '用户管理', exact: true })).toBeVisible();
  expect(group.querySelector('a')?.getAttribute('aria-current')).toBe('page');
  await expect.element(page.getByRole('button', { name: '财务 展开' })).toBeVisible();
});

describe('breadcrumb text alignment in the real admin shell', () => {
  const cases = [
    { path: '/orders/new', parentHref: '/orders', current: '新建工单' },
    { path: '/sales/bills', parentHref: null, current: '我的货款账单' },
    { path: '/orders', parentHref: null, current: '工单列表' },
    {
      path: '/owner/agent-bills/cabcdefghijklmnopqrstuvwx/credits/czyxwvutsrqponmlkjihgfedcb/new',
      parentHref: '/owner/agent-bills/cabcdefghijklmnopqrstuvwx',
      current: '录入抵扣',
      entityLabel: '2026 年 8 月外部销售货款核对记录及补充说明超长标题',
    },
  ];
  for (const theme of ['light', 'dark']) {
    for (const [width, height] of viewports) {
      it(`${theme} ${width}: aligns linked, layout-only, single and long-title crumbs`, async () => {
        await page.viewport(width, height);
        for (const scenario of cases) {
          route.pathname = scenario.path;
          await renderShell(Role.SALES, theme, 'production', scenario.entityLabel);
          const header = host.querySelector<HTMLElement>('header')!;
          assertBreadcrumbTextAlignment(header);
          const current = header.querySelector<HTMLElement>('[aria-current="page"]')!;
          expect(current.textContent).toBe(scenario.current);
          expect(current.getAttribute('aria-disabled')).toBe('true');
          expect(header.getBoundingClientRect().height).toBe(56);
          expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
          if (scenario.parentHref) {
            const link = header.querySelector<HTMLAnchorElement>(`a[href="${scenario.parentHref}"]`)!;
            expect(link).not.toBeNull();
            link.focus();
            expect(document.activeElement).toBe(link);
            if (scenario.entityLabel) {
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
