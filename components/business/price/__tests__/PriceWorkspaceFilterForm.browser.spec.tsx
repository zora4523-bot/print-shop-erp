import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { RouterContext } from 'next/dist/shared/lib/router-context.shared-runtime';
import type { NextRouter } from 'next/router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import '@/app/globals.css';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
const m = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), forward: vi.fn(), prefetch: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => m }));
import { PriceWorkspaceFilterForm, PriceWorkspaceNavigationGuardProvider, usePriceWorkspaceUnsavedTierChanges } from '../PriceWorkspaceNavigationGuard';
let root: Root; let host: HTMLDivElement; let originalUrl: string;
function Editor({ dirty }: { dirty: number }) {
  usePriceWorkspaceUnsavedTierChanges(dirty);
  return <PriceWorkspaceFilterForm action="/owner/rules/customer-pricing" prefetch={false}>
    <input type="hidden" name="section" defaultValue="charges" />
    <Input name="q" aria-label="筛选名称" defaultValue="物流 & 包装" />
    <Button type="submit">应用筛选</Button>
  </PriceWorkspaceFilterForm>;
}
function mount(dirty: number) {
  flushSync(() => root.render(<RouterContext.Provider value={m as unknown as NextRouter}><PriceWorkspaceNavigationGuardProvider><Editor dirty={dirty} /></PriceWorkspaceNavigationGuardProvider></RouterContext.Provider>));
}
beforeEach(() => {
  vi.clearAllMocks(); originalUrl = window.location.href;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { flushSync(() => root.unmount()); host.remove(); });
it('guards the real Next Form submission, cancels in place and confirms the encoded destination', async () => {
  mount(2);
  await page.getByRole('button', { name: '应用筛选', exact: true }).click();
  await expect.element(page.getByRole('alertdialog')).toBeVisible();
  expect(m.push).not.toHaveBeenCalled();
  expect(window.location.href).toBe(originalUrl);
  await page.getByRole('button', { name: '继续编辑', exact: true }).click();
  await expect.element(page.getByRole('alertdialog')).not.toBeInTheDocument();
  expect(window.location.href).toBe(originalUrl);
  expect(m.push).not.toHaveBeenCalled();
  await page.getByRole('button', { name: '应用筛选', exact: true }).click();
  await page.getByRole('button', { name: '放弃修改并离开', exact: true }).click();
  expect(m.push).toHaveBeenCalledOnce();
  const destination = new URL(m.push.mock.calls[0][0], window.location.href);
  expect(destination.pathname).toBe('/owner/rules/customer-pricing');
  expect([...destination.searchParams]).toEqual([['section', 'charges'], ['q', '物流 & 包装']]);
});
it('lets the real Next Form soft-navigate directly when there are no unsaved tiers', async () => {
  mount(0);
  await page.getByRole('button', { name: '应用筛选', exact: true }).click();
  expect(m.push).toHaveBeenCalledOnce();
  await expect.element(page.getByRole('alertdialog')).not.toBeInTheDocument();
  const destination = new URL(m.push.mock.calls[0][0], window.location.href);
  expect(destination.pathname).toBe('/owner/rules/customer-pricing');
  expect(destination.searchParams.get('q')).toBe('物流 & 包装');
});
