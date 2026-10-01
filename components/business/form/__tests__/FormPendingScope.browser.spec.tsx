import type { AnchorHTMLAttributes } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { Button } from '@/components/ui/button';

vi.mock('next/link', () => ({
  __esModule: true,
  default: (
    props: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string },
  ) => (
    <a
      href={props.href}
      data-slot={(props as unknown as Record<string, string>)['data-slot']}
      aria-disabled={props['aria-disabled']}
      tabIndex={props.tabIndex}
      onClick={props.onClick}
      className={props.className}
    >
      {props.children}
    </a>
  ),
}));

const route = vi.hoisted(() => ({ pathname: '/owner/rules/crafts/new' }));
vi.mock('next/navigation', () => ({ usePathname: () => route.pathname }));

import {
  FormPendingScope,
  ScopedPageHeader,
  useReportFormPending,
} from '../FormPendingScope';
import { AdminBreadcrumb } from '@/components/business/admin/AdminBreadcrumb';
import { BreadcrumbEntityProvider, BreadcrumbParent } from '@/components/business/admin/breadcrumb-entity';

function FakeForm({ pending }: { pending: boolean }) {
  useReportFormPending(pending);
  return <Button type="submit">保存</Button>;
}

function Page({ pending }: { pending: boolean }) {
  return (
    <FormPendingScope>
      <ScopedPageHeader title="新建工艺" back={{ href: '/rules/crafts', label: '返回工艺' }} />
      <FakeForm pending={pending} />
    </FormPendingScope>
  );
}

it('locks the page-header back link while the scoped form is pending', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  flushSync(() => root.render(<Page pending={false} />));
  const link = () => host.querySelector<HTMLAnchorElement>('[data-slot="page-header-back"]')!;

  expect(link().getAttribute('aria-disabled')).toBeNull();

  flushSync(() => root.render(<Page pending />));
  await vi.waitFor(() => expect(link().getAttribute('aria-disabled')).toBe('true'));
  expect(link().tabIndex).toBe(-1);
  const click = new MouseEvent('click', { bubbles: true, cancelable: true });
  link().dispatchEvent(click);
  expect(click.defaultPrevented).toBe(true);

  flushSync(() => root.render(<Page pending={false} />));
  await vi.waitFor(() => expect(link().getAttribute('aria-disabled')).toBeNull());

  root.unmount();
  host.remove();
});

// 业主 2026-10-02「请保持一致性」：二级页页头不再给返回链接，面包屑父级是唯一返回入口。
// 原先页头返回的「提交中锁定」随 FormPendingScope 交给父级，不能因去掉页头返回而丢失。
function ShellPage({ pending }: { pending: boolean }) {
  return (
    <BreadcrumbEntityProvider>
      <AdminBreadcrumb role="ADMIN" />
      <FormPendingScope>
        <ScopedPageHeader title="新建工艺" />
        <FakeForm pending={pending} />
      </FormPendingScope>
    </BreadcrumbEntityProvider>
  );
}

it('locks the breadcrumb parent — the only return entry — while the scoped form is pending', async () => {
  route.pathname = '/owner/rules/crafts/new';
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  flushSync(() => root.render(<ShellPage pending={false} />));
  const parent = () => host.querySelector<HTMLAnchorElement>('[data-slot="breadcrumb-link"][href="/owner/rules/crafts"]')!;

  expect(host.querySelector('[data-slot="page-header-back"]')).toBeNull();
  expect(parent()).not.toBeNull();
  expect(parent().getAttribute('aria-disabled')).toBeNull();

  flushSync(() => root.render(<ShellPage pending />));
  await vi.waitFor(() => expect(parent().getAttribute('aria-disabled')).toBe('true'));
  expect(parent().tabIndex).toBe(-1);
  const click = new MouseEvent('click', { bubbles: true, cancelable: true });
  parent().dispatchEvent(click);
  expect(click.defaultPrevented).toBe(true);

  flushSync(() => root.render(<ShellPage pending={false} />));
  await vi.waitFor(() => expect(parent().getAttribute('aria-disabled')).toBeNull());
  expect(parent().tabIndex).not.toBe(-1);

  root.unmount();
  host.remove();
});

it('carries list context onto the breadcrumb parent only for the same parent path', async () => {
  route.pathname = '/owner/agent-bills/cabcdefghijklmnopqrstuvwx';
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const render = (href: string | null) => flushSync(() => root.render(
    <BreadcrumbEntityProvider>
      <AdminBreadcrumb role="ADMIN" />
      <BreadcrumbParent href={href} />
    </BreadcrumbEntityProvider>,
  ));
  const parent = () => host.querySelectorAll<HTMLAnchorElement>('[data-slot="breadcrumb-link"]');
  const parentHref = () => [...parent()].at(-1)!.getAttribute('href');

  render('/owner/agent-bills?period=2026-08&status=OPEN&page=2');
  await vi.waitFor(() => expect(parentHref()).toBe('/owner/agent-bills?period=2026-08&status=OPEN&page=2'));
  render('/owner/purchases?page=2');
  await vi.waitFor(() => expect(parentHref()).toBe('/owner/agent-bills'));
  render(null);
  await vi.waitFor(() => expect(parentHref()).toBe('/owner/agent-bills'));

  root.unmount();
  host.remove();
});
