import type { AnchorHTMLAttributes } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({
    href,
    children,
    className,
  }: AnchorHTMLAttributes<HTMLAnchorElement> & {
    href: string;
    prefetch?: boolean;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

vi.mock('@/actions/foreman-cdr', () => ({
  createBundleAction: vi.fn(),
}));

import { CreateBundleForm } from '../CreateBundleForm';

async function settleEffects() {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

it('CDR 全选在部分勾选时保留 mixed 语义与 FormData', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);

  try {
    flushSync(() =>
      root.render(
        <CreateBundleForm
          from="2026-08-24"
          to="2026-08-24"
          eligible={[
            {
              id: 'order-1',
              orderNo: '20260824001',
              customName: '中秋礼盒',
              externalSalesName: '桂林',
              submittedAt: '2026-08-24T01:00:00.000Z',
              cdrCount: 2,
            },
            {
              id: 'order-2',
              orderNo: '20260824002',
              customName: null,
              externalSalesName: '桂林',
              submittedAt: '2026-08-24T02:00:00.000Z',
              cdrCount: 3,
            },
          ]}
        />,
      ),
    );
    await settleEffects();

    const form = host.querySelector<HTMLFormElement>('#cdr-bundle-form');
    const selectAll = host.querySelector<HTMLElement>(
      '[role="checkbox"][aria-label="全选 / 全不选"]',
    );
    const firstOrder = host.querySelector<HTMLElement>(
      '[role="checkbox"][aria-label="选择工单 20260824001"]',
    );

    expect(form).not.toBeNull();
    expect(
      [...host.querySelectorAll('tbody tr')].map(
        (row) => row.querySelectorAll('td')[2]?.textContent,
      ),
    ).toEqual(['中秋礼盒 · 桂林', '未命名工单 · 桂林']);
    expect(selectAll?.getAttribute('aria-checked')).toBe('true');
    expect(new FormData(form!).getAll('orderIds')).toEqual([
      'order-1',
      'order-2',
    ]);

    firstOrder?.click();
    await settleEffects();

    expect(selectAll?.getAttribute('aria-checked')).toBe('mixed');
    expect(selectAll?.hasAttribute('data-indeterminate')).toBe(true);
    expect(new FormData(form!).getAll('orderIds')).toEqual(['order-2']);

    selectAll?.click();
    await settleEffects();
    expect(selectAll?.getAttribute('aria-checked')).toBe('true');

    selectAll?.click();
    await settleEffects();
    expect(selectAll?.getAttribute('aria-checked')).toBe('false');
    expect(new FormData(form!).getAll('orderIds')).toEqual([]);
  } finally {
    flushSync(() => root.unmount());
    host.remove();
  }
});
