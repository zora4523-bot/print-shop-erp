import type { ComponentProps } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import '@/app/globals.css';
import { PendingButton } from '../PendingButton';

/** 提交中离开（PendingButton，迁移到共享导航守卫后）：站内链接与浏览器后退都先确认。 */
const followed = vi.fn();
function ShellLink(props: ComponentProps<'a'>) {
  return <a {...props} onClick={(event) => { event.preventDefault(); followed(props.href); }} />;
}
let root: Root;
let host: HTMLDivElement;
let originalNavigation: PropertyDescriptor | undefined;
let navigation: EventTarget & { traverseTo: ReturnType<typeof vi.fn> };
function mount(pending: boolean) {
  flushSync(() => root.render(<>
    <nav aria-label="侧栏"><ShellLink href="/owner/products">产品</ShellLink></nav>
    <form onSubmit={(event) => event.preventDefault()}><PendingButton pending={pending}>保存产品</PendingButton></form>
  </>));
}
function traversal(key: string, path: string) {
  const event = new Event('navigate', { cancelable: true });
  Object.assign(event, { navigationType: 'traverse', destination: { key, url: new URL(path, location.href).href, sameDocument: true } });
  navigation.dispatchEvent(event);
  return event;
}
const shellLink = () => page.getByRole('link', { name: '产品', exact: true });
const dialog = () => page.getByRole('alertdialog');

beforeEach(() => {
  followed.mockReset();
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

it('asks before following a site link while the submission is in flight and returns focus on stay', async () => {
  mount(true);
  await shellLink().click();
  await expect.element(dialog()).toHaveTextContent('当前操作仍在提交，仍要离开');
  expect(followed).not.toHaveBeenCalled();
  await dialog().getByRole('button', { name: '留在当前页面', exact: true }).click();
  await expect.element(dialog()).not.toBeInTheDocument();
  await expect.element(shellLink()).toHaveFocus();
  const unload = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(true);
});

it('asks before browser back while the submission is in flight and resumes the same entry', async () => {
  mount(true);
  expect(traversal('previous-entry', '/owner/products').defaultPrevented).toBe(true);
  await expect.element(dialog()).toHaveTextContent('当前操作仍在提交，仍要离开');
  await dialog().getByRole('button', { name: '仍要离开', exact: true }).click();
  expect(navigation.traverseTo).toHaveBeenCalledExactlyOnceWith('previous-entry');
});

it('does nothing once the submission has settled', async () => {
  mount(false);
  await shellLink().click();
  expect(followed).toHaveBeenCalledOnce();
  expect(traversal('previous-entry', '/owner/products').defaultPrevented).toBe(false);
  const unload = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(false);
});
