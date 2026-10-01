import type { ComponentProps } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { Role } from '@/generated/prisma/enums';
import { ADMIN_ROLE_BADGE, getAdminMenuItems } from '@/lib/navigation/admin-menu';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import '@/app/globals.css';

const route = vi.hoisted(() => ({ pathname: '/workbench', search: '' }));
vi.mock('next/navigation', () => ({
  usePathname: () => route.pathname,
  useSearchParams: () => new URLSearchParams(route.search),
}));
vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ prefetch: _prefetch, ...props }: ComponentProps<'a'> & { prefetch?: boolean | null }) => {
    void _prefetch;
    return <a {...props} />;
  },
  useLinkStatus: () => ({ pending: false }),
}));

import { AppSidebar } from '../AppSidebar';

let host: HTMLDivElement;
let root: Root;
// The mocked Link is a plain anchor; keep the test page itself from navigating.
const preventNavigation = (event: MouseEvent) => {
  if ((event.target as Element | null)?.closest('a[href]')) event.preventDefault();
};

beforeEach(async () => {
  await page.viewport(375, 667);
  localStorage.removeItem('print-shop-erp:admin-sidebar-collapsed');
  route.pathname = '/workbench';
  route.search = '';
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  document.addEventListener('click', preventNavigation);
});

afterEach(() => {
  document.removeEventListener('click', preventNavigation);
  flushSync(() => root.unmount());
  host.remove();
});

async function frames() {
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

async function render() {
  flushSync(() => root.render(
    <SidebarProvider className="admin-viewport">
      <AppSidebar menuGroups={getAdminMenuItems({ role: Role.ADMIN })} roleBadge={ADMIN_ROLE_BADGE[Role.ADMIN]} />
      <SidebarInset id="admin-main">
        <SidebarTrigger aria-label="打开导航" />
      </SidebarInset>
    </SidebarProvider>,
  ));
  await frames();
}

function mobileSheet() {
  return document.querySelector('[data-slot="sidebar"][data-mobile="true"]');
}

async function openSheet() {
  await page.getByRole('button', { name: '打开导航' }).click();
  await vi.waitFor(() => expect(mobileSheet()).not.toBeNull());
}

it('keeps the mobile drawer (and its pending indicator) open until the route changes', async () => {
  await render();
  await openSheet();

  const link = mobileSheet()!.querySelector<HTMLAnchorElement>('a[href="/orders"]');
  expect(link).not.toBeNull();
  link!.click();
  await frames();
  // Tapping no longer hides the drawer before the server answers.
  expect(mobileSheet()).not.toBeNull();

  // The navigation commits: the drawer closes on the new location.
  route.pathname = '/orders';
  await render();
  await vi.waitFor(() => expect(mobileSheet()).toBeNull());
});

it('closes immediately when the tapped item is the current page', async () => {
  route.pathname = '/orders';
  await render();
  await openSheet();

  mobileSheet()!.querySelector<HTMLAnchorElement>('a[href="/orders"]')!.click();
  await vi.waitFor(() => expect(mobileSheet()).toBeNull());
});
