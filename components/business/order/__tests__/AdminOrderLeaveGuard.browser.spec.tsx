import { useState, type ComponentProps } from 'react';
import { Input } from '@/components/ui/input';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { Button } from '@/components/ui/button';
import {
  useAdminOrderLeaveGuard,
  type PendingOrderEditorNavigation,
} from '../use-admin-order-leave-guard';

// Native anchors let this harness observe event replay independently of a router.
function NavigationFixtureLink(props: ComponentProps<'a'>) {
  return <a {...props} />;
}

let host: HTMLDivElement;
let root: Root;
let originalNavigation: PropertyDescriptor | undefined;
let navigation: EventTarget & { traverseTo: ReturnType<typeof vi.fn> };
const pushed = vi.fn();

function Fixture() {
  const [dirty, setDirty] = useState(true);
  const [blocked, setBlocked] = useState<PendingOrderEditorNavigation | null>(null);
  const { allowNavigation } = useAdminOrderLeaveGuard({
    protectedLeave: dirty,
    onBlocked: setBlocked,
  });
  return (
    <>
      <Input aria-label="草稿" defaultValue="未保存的数量" />
      <NavigationFixtureLink href="/orders/another-order" onClick={(event) => {
        event.preventDefault();
        pushed('/orders/another-order');
      }}>另一张工单</NavigationFixtureLink>
      <a href="#same-page">本页信息</a>
      <a href="/orders/export" download>导出</a>
      <Button onClick={() => setDirty(false)}>还原全部</Button>
      <Button onClick={() => { allowNavigation(); pushed('/orders/saved'); }}>保存成功</Button>
      {blocked ? (
        <div role="dialog" aria-label="离开确认">
          <Button onClick={() => setBlocked(null)}>继续编辑</Button>
          <Button onClick={() => { blocked.resume(); setBlocked(null); }}>放弃修改并离开</Button>
        </div>
      ) : null}
    </>
  );
}

function traversal(key: string, url: string, cancelable = true) {
  const event = new Event('navigate', { cancelable });
  Object.assign(event, {
    navigationType: 'traverse',
    destination: { key, url, sameDocument: true },
  });
  navigation.dispatchEvent(event);
  return event;
}

beforeEach(() => {
  pushed.mockReset();
  originalNavigation = Object.getOwnPropertyDescriptor(window, 'navigation');
  navigation = Object.assign(new EventTarget(), {
    traverseTo: vi.fn(() => ({ committed: Promise.resolve(), finished: Promise.resolve() })),
  });
  // Vitest mounts its browser tests in an iframe where native traversals are
  // not cancellable. Exercise the top-level Navigation API contract here.
  Object.defineProperty(window, 'navigation', { configurable: true, value: navigation });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  flushSync(() => root.render(<Fixture />));
});

afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
  if (originalNavigation) Object.defineProperty(window, 'navigation', originalNavigation);
  else Reflect.deleteProperty(window, 'navigation');
});

describe('admin order draft navigation', () => {
  it('cancels back without rewriting history and keeps the draft when editing continues', async () => {
    const before = { length: history.length, state: history.state, href: location.href };
    const event = traversal('previous-entry', new URL('/orders', location.href).href);
    expect(event.defaultPrevented).toBe(true);
    await expect.element(page.getByRole('dialog', { name: '离开确认' })).toBeVisible();
    await page.getByRole('button', { name: '继续编辑' }).click();
    await expect.element(page.getByRole('textbox', { name: '草稿' })).toHaveValue('未保存的数量');
    expect(navigation.traverseTo).not.toHaveBeenCalled();
    expect({ length: history.length, state: history.state, href: location.href }).toEqual(before);
  });

  it.each(['previous-entry', 'forward-entry'])('resumes %s by original entry key after confirmation', async (key) => {
    traversal(key, new URL('/orders/destination', location.href).href);
    await page.getByRole('button', { name: '放弃修改并离开' }).click();
    expect(navigation.traverseTo).toHaveBeenCalledExactlyOnceWith(key);
    // Replaying the traversal must not reopen the confirmation dialog.
    expect(traversal(key, new URL('/orders/destination', location.href).href).defaultPrevented).toBe(false);
  });

  it('replays a confirmed link once and preserves its own navigation handler', async () => {
    await page.getByRole('link', { name: '另一张工单' }).click();
    expect(pushed).not.toHaveBeenCalled();
    await page.getByRole('button', { name: '放弃修改并离开' }).click();
    expect(pushed).toHaveBeenCalledExactlyOnceWith('/orders/another-order');
  });

  it('does not trap navigation after successful save or after restoring the draft', async () => {
    await page.getByRole('button', { name: '保存成功' }).click();
    expect(pushed).toHaveBeenCalledExactlyOnceWith('/orders/saved');
    expect(traversal('saved-back', new URL('/orders', location.href).href).defaultPrevented).toBe(false);
    const unload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(false);
    await page.getByRole('button', { name: '还原全部' }).click();
    expect(traversal('clean-back', new URL('/orders', location.href).href).defaultPrevented).toBe(false);
  });

  it('retains full-document protection when Navigation API is unavailable and removes it on unmount', async () => {
    flushSync(() => root.unmount());
    Object.defineProperty(window, 'navigation', { configurable: true, value: undefined });
    root = createRoot(host);
    flushSync(() => root.render(<Fixture />));
    const unload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
    await page.getByRole('link', { name: '另一张工单' }).click();
    await expect.element(page.getByRole('dialog', { name: '离开确认' })).toBeVisible();
    flushSync(() => root.unmount());
    root = createRoot(host);
    const afterUnmount = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(afterUnmount);
    expect(afterUnmount.defaultPrevented).toBe(false);
  });

  it('leaves same-page history, downloads and modified clicks alone', () => {
    expect(traversal('hash', `${location.href}#section`).defaultPrevented).toBe(false);
    for (const [text, init] of [
      ['本页信息', {}],
      ['导出', {}],
      ['另一张工单', { ctrlKey: true }],
      ['另一张工单', { button: 1 }],
    ] as const) {
      const anchor = [...host.querySelectorAll('a')].find((link) => link.textContent === text)!;
      // Inspect at capture: the anchor's own handler may prevent default later.
      let guardCancelled = false;
      anchor.addEventListener('click', (event) => { guardCancelled = event.defaultPrevented; }, { once: true, capture: true });
      const event = new MouseEvent('click', { bubbles: true, cancelable: true, ...init });
      anchor.addEventListener('click', (click) => click.preventDefault(), { once: true });
      anchor.dispatchEvent(event);
      expect(guardCancelled).toBe(false);
    }
  });
});
