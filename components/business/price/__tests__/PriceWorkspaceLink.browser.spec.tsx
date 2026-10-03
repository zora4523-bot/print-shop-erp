import type { ComponentProps } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import '@/app/globals.css';

/**
 * PriceWorkspaceLink 自带确认：确认后重放链接本身（保留 replace / scroll 与 Link 的 pending 状态），
 * 而不是改用 router.push；确认只覆盖这一次点击。next/link 替身按 Next 语义调用 onNavigate。
 */
const m = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), forward: vi.fn(), prefetch: vi.fn() },
  navigations: [] as string[],
}));
vi.mock('next/navigation', () => ({ useRouter: () => m.router }));
vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, onNavigate, replace, scroll, prefetch: _prefetch, ...props }: ComponentProps<'a'> & {
    prefetch?: boolean; replace?: boolean; scroll?: boolean; onNavigate?: (event: { preventDefault(): void }) => void;
  }) => {
    void _prefetch;
    return <a {...props} href={String(href)} onClick={(event) => {
      event.preventDefault();
      let prevented = false;
      onNavigate?.({ preventDefault: () => { prevented = true; } });
      if (!prevented) m.navigations.push(`${replace ? 'replace' : 'push'}:${String(href)}:${scroll === false ? 'keep-scroll' : 'scroll'}`);
    }} />;
  },
}));
import {
  PriceWorkspaceLink,
  PriceWorkspaceNavigationGuardProvider,
  usePriceWorkspaceUnsavedTierChanges,
} from '../PriceWorkspaceNavigationGuard';

function Editor({ dirty }: { dirty: number }) {
  usePriceWorkspaceUnsavedTierChanges(dirty);
  return <PriceWorkspaceLink href="/owner/rules/customer-pricing?section=tiers&q=" replace scroll={false}>清除筛选</PriceWorkspaceLink>;
}
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.clearAllMocks(); m.navigations.length = 0;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { flushSync(() => root.unmount()); host.remove(); });
const link = () => page.getByRole('link', { name: '清除筛选', exact: true });

it('replays the link itself after confirmation and asks again next time', async () => {
  flushSync(() => root.render(<PriceWorkspaceNavigationGuardProvider><Editor dirty={2} /></PriceWorkspaceNavigationGuardProvider>));
  await expect.poll(async () => {
    await link().click();
    return document.querySelector('[role="alertdialog"]') !== null;
  }).toBe(true);
  expect(m.navigations).toEqual([]);
  await page.getByRole('button', { name: '放弃修改并离开', exact: true }).click();
  expect(m.navigations).toEqual(['replace:/owner/rules/customer-pricing?section=tiers&q=:keep-scroll']);
  expect(m.router.push).not.toHaveBeenCalled();
  expect(m.router.replace).not.toHaveBeenCalled();
  await link().click();
  await expect.element(page.getByRole('alertdialog')).toBeVisible();
  expect(m.navigations).toHaveLength(1);
});
