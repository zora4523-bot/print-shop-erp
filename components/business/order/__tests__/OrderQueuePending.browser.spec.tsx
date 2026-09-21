import { createContext, useContext, useState } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import '@/app/globals.css';
import { Button } from '@/components/ui/button';

// Browser Mode has no App Router. Only its per-Link status context is mocked;
// actual navigation ordering is covered by admin-workspace-filter.spec.ts.
const Status = createContext(false);
vi.mock('next/link', () => ({
  useLinkStatus: () => ({ pending: useContext(Status) }),
}));

import { OrderQueuePending } from '../OrderQueuePending';
import { OrderQueueResults } from '../OrderQueueResults';
import styles from '../AdminOrderWorkspace.module.css';

let host: HTMLDivElement;
let root: Root;
function Fixture() {
  const [pending, setPending] = useState('');
  return (
    <div className={styles.surface}>
      <nav aria-label="工单队列">
        {['待打印', '生产中'].map((label) => (
          <Status.Provider key={label} value={pending === label}><a href={`/orders?queue=${label}`}
            onClick={(event) => { event.preventDefault(); setPending(label); }}>
            {label}<OrderQueuePending label={label} />
          </a></Status.Provider>
        ))}
      </nav>
      <Button type="button" onClick={() => setPending('')}>完成请求</Button>
      <OrderQueueResults><p>切换前的工单</p></OrderQueueResults>
    </div>
  );
}
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  flushSync(() => root.render(<Fixture />));
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
});

it('delays the inline spinner and never adds a notice or moves old results', async () => {
  const row = page.getByText('切换前的工单');
  const top = row.element().getBoundingClientRect().top;
  const notice = page.getByText('正在切换，当前仍显示切换前的结果', { exact: true });
  await expect.element(notice).not.toBeInTheDocument();
  expect(host.getAnimations({ subtree: true }).filter((animation) => animation.effect?.getTiming().iterations === Infinity)).toHaveLength(0);
  await page.getByRole('link', { name: '待打印', exact: true }).click();
  const spinner = host.querySelector('svg')!;
  expect(getComputedStyle(spinner).visibility).toBe('hidden');
  await expect.poll(() => getComputedStyle(spinner).visibility).toBe('visible');
  await expect.element(notice).not.toBeInTheDocument();
  await expect.element(row).toBeVisible();
  expect(row.element().getBoundingClientRect().top).toBe(top);
  expect(getComputedStyle(row.element().parentElement!).outlineStyle).toBe('none');
  await page.getByRole('button', { name: '完成请求' }).click();
  await expect.element(notice).not.toBeInTheDocument();
  expect(host.getAnimations({ subtree: true }).filter((animation) => animation.effect?.getTiming().iterations === Infinity)).toHaveLength(0);
  expect(row.element().getBoundingClientRect().top).toBe(top);
});

it('keeps keyboard focus and moves the announcement to the latest pending link', async () => {
  await userEvent.tab();
  await expect.element(page.getByRole('link', { name: '待打印', exact: true })).toHaveFocus();
  await userEvent.keyboard('{Enter}');
  await expect.element(page.getByRole('status').filter({ hasText: '正在切换至待打印' })).toHaveTextContent('正在切换至待打印');
  await userEvent.tab();
  await expect.element(page.getByRole('link', { name: '生产中', exact: true })).toHaveFocus();
  await userEvent.keyboard('{Enter}');
  expect(host.querySelectorAll('[data-order-queue-pending="true"]')).toHaveLength(1);
  await expect.element(page.getByRole('status').filter({ hasText: '正在切换至生产中' })).toHaveTextContent('正在切换至生产中');
  expect(host.textContent).not.toContain('正在切换至待打印');
  await expect.element(page.getByRole('link', { name: /^生产中/ })).toHaveFocus();
});

it('cancels the delayed indicator when a fast navigation completes', async () => {
  await page.getByRole('link', { name: '待打印', exact: true }).click();
  await page.getByRole('button', { name: '完成请求' }).click();
  await new Promise((resolve) => setTimeout(resolve, 350));
  expect(host.querySelector('[data-order-queue-pending="true"]')).toBeNull();
  expect(getComputedStyle(host.querySelector('svg')!).visibility).toBe('hidden');
  expect(host.getAnimations({ subtree: true })).toHaveLength(0);
});
