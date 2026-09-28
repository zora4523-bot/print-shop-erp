import { afterEach, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import type { ComponentProps } from 'react';
import type { OutsourceMutationResult } from '@/actions/outsource.types';

const mocked = vi.hoisted(() => ({ create: vi.fn(), push: vi.fn() }));
vi.mock('@/actions/outsource', () => ({ createOutsourceAction: mocked.create }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocked.push }) }));
vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ prefetch, onNavigate, ...props }: ComponentProps<'a'> & { prefetch?: boolean; onNavigate?: unknown }) => {
    void prefetch; void onNavigate;
    return <a {...props} />;
  },
}));
import { CreateOutsourceForm } from '../CreateOutsourceForm';

let root: Root;
let host: HTMLDivElement;
afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
});

it('blocks the return link while creating, restores it on failure and keeps the success destination', async () => {
  let finish!: (result: OutsourceMutationResult) => void;
  mocked.create.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  flushSync(() => root.render(<CreateOutsourceForm orderId="order" orderNo="GD-TEST"
    items={[{ id: 'item', sequence: 1, name: '测试款', quantity: 100 }]}
    initialIdempotencyKey="outsource-test" />));
  await page.getByRole('checkbox').click();
  await page.getByLabelText('外协厂名 *', { exact: true }).fill('测试外协厂');
  await page.getByRole('button', { name: '创建外协单', exact: true }).click();
  const back = page.getByRole('link', { name: '返回工单详情', exact: true });
  await expect.element(back).toHaveAttribute('href', '/orders/order');
  await expect.element(back).toHaveAttribute('aria-disabled', 'true');
  await expect.element(back).toHaveAttribute('tabindex', '-1');
  expect(host.querySelector('a')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))).toBe(false);
  finish({ status: 'error', message: '本次未保存，请重试' });
  await expect.element(page.getByRole('alert')).toHaveTextContent('本次未保存');
  await expect.element(back).not.toHaveAttribute('aria-disabled');
  await expect.element(page.getByLabelText('外协厂名 *', { exact: true })).toHaveValue('测试外协厂');
  expect(mocked.push).not.toHaveBeenCalled();
  await page.getByRole('button', { name: '创建外协单', exact: true }).click();
  await expect.element(back).toHaveAttribute('aria-disabled', 'true');
  finish({ status: 'success', id: 'created-outsource' });
  await vi.waitFor(() => expect(mocked.push).toHaveBeenCalledExactlyOnceWith('/foreman/outsource/created-outsource'));
});
