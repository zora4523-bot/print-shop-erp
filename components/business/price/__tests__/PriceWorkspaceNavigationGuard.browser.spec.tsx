import type { ComponentProps } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import '@/app/globals.css';
const m = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), forward: vi.fn(), prefetch: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => m }));
import { PriceWorkspaceNavigationGuardProvider, usePriceWorkspaceUnsavedTierChanges } from '../PriceWorkspaceNavigationGuard';

/**
 * 价格工作台的文档级离开保护（迁移到共享导航守卫后）：工作台外的侧栏链接仍弹同一确认层，
 * 浏览器后退 / 前进也经过同一判定（迁移前不拦）。
 */
const followed = vi.fn();
function SidebarLink(props: ComponentProps<'a'>) {
  return <a {...props} onClick={(event) => { event.preventDefault(); followed(props.href); }} />;
}
function Editor({ dirty }: { dirty: number }) {
  usePriceWorkspaceUnsavedTierChanges(dirty);
  return <p>阶梯编辑</p>;
}
let root: Root;
let host: HTMLDivElement;
let originalNavigation: PropertyDescriptor | undefined;
let navigation: EventTarget & { traverseTo: ReturnType<typeof vi.fn> };
function mount(dirty: number) {
  flushSync(() => root.render(<>
    <nav aria-label="侧栏"><SidebarLink href="/owner/rules/customer-pricing?section=print">印刷单价</SidebarLink></nav>
    <PriceWorkspaceNavigationGuardProvider><Editor dirty={dirty} /></PriceWorkspaceNavigationGuardProvider>
  </>));
}
function traversal(key: string, path: string) {
  const event = new Event('navigate', { cancelable: true });
  Object.assign(event, { navigationType: 'traverse', destination: { key, url: new URL(path, location.href).href, sameDocument: true } });
  navigation.dispatchEvent(event);
  return event;
}
const sidebar = () => page.getByRole('link', { name: '印刷单价', exact: true });

beforeEach(() => {
  vi.clearAllMocks();
  originalNavigation = Object.getOwnPropertyDescriptor(window, 'navigation');
  navigation = Object.assign(new EventTarget(), {
    traverseTo: vi.fn(() => ({ committed: Promise.resolve(), finished: Promise.resolve() })),
  });
  Object.defineProperty(window, 'navigation', { configurable: true, value: navigation });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => {
  flushSync(() => root.unmount()); host.remove();
  if (originalNavigation) Object.defineProperty(window, 'navigation', originalNavigation);
  else Reflect.deleteProperty(window, 'navigation');
});

it('asks before a sidebar link discards unsaved tiers, keeps focus on cancel and pushes on confirm', async () => {
  mount(3);
  await sidebar().click();
  await expect.element(page.getByRole('alertdialog')).toHaveTextContent('3 个未保存档位修改将丢失。');
  expect(followed).not.toHaveBeenCalled();
  await page.getByRole('button', { name: '继续编辑', exact: true }).click();
  await expect.element(page.getByRole('alertdialog')).not.toBeInTheDocument();
  await expect.element(sidebar()).toHaveFocus();
  await sidebar().click();
  await page.getByRole('button', { name: '放弃修改并离开', exact: true }).click();
  expect(m.push).toHaveBeenCalledExactlyOnceWith('/owner/rules/customer-pricing?section=print');
  expect(followed).not.toHaveBeenCalled();
});

it('cancels browser back with unsaved tiers and resumes the same history entry on confirm', async () => {
  mount(2);
  // The tier count reaches the provider after the editor's effect; until then nothing is unsaved.
  await expect.poll(() => traversal('previous-entry', '/owner/rules').defaultPrevented).toBe(true);
  await expect.element(page.getByRole('alertdialog')).toHaveTextContent('2 个未保存档位修改将丢失。');
  await page.getByRole('button', { name: '放弃修改并离开', exact: true }).click();
  expect(navigation.traverseTo).toHaveBeenCalledExactlyOnceWith('previous-entry');
  expect(m.push).not.toHaveBeenCalled();
});

it('does not interfere without unsaved tiers', async () => {
  mount(0);
  await expect.element(page.getByText('阶梯编辑')).toBeVisible();
  await sidebar().click();
  expect(traversal('previous-entry', '/owner/rules').defaultPrevented).toBe(false);
  expect(followed).toHaveBeenCalledOnce();
  expect(document.querySelector('[role="alertdialog"]')).toBeNull();
});
