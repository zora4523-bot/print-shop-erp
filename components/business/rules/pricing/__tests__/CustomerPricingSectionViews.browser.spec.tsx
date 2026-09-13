import type { ComponentProps } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { commands, page } from 'vitest/browser';
import '@/app/globals.css';
// Link is a framework boundary; Vite does not inject Next's process definitions.
vi.mock('next/link', () => ({
  default: ({ prefetch, ...props }: ComponentProps<'a'> & { prefetch?: boolean }) => {
    void prefetch;
    return <a {...props} />;
  },
  useLinkStatus: () => ({ pending: false }),
}));

import { CustomerBlankPricingSectionView, CustomerTiersPricingSectionView } from '../CustomerPricingSectionViews';

function pricingView(value: number) {
  return (
    <CustomerBlankPricingSectionView
      columns={[{ key: 'middle', label: '中号封' }]}
      rows={[
        {
          key: 'pearl-160',
          paperName: '珠光艳闪',
          weight: 160,
          cells: [
            {
              id: 'stable-price-field',
              columnKey: 'middle',
              value,
              editable: true,
            },
          ],
        },
      ]}
    />
  );
}

async function settleEffects() {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

it('价格快照更新后显示新值且不触发 Base UI 非受控告警', async () => {
  const messages: string[] = [];
  const errorSpy = vi.spyOn(console, 'error').mockImplementation((...args) => {
    messages.push(args.map(String).join(' '));
  });
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);

  try {
    flushSync(() => root.render(pricingView(0.12)));
    await settleEffects();

    flushSync(() => root.render(pricingView(0.13)));
    await settleEffects();

    const input = host.querySelector<HTMLInputElement>(
      '[aria-label="珠光艳闪160g中号封单价"]',
    );

    expect(input?.value).toBe('0.13');
    expect(
      messages.filter((message) =>
        message.includes(
          'changing the default value state of an uncontrolled FieldControl',
        ),
      ),
    ).toEqual([]);
  } finally {
    flushSync(() => root.unmount());
    host.remove();
    errorSpy.mockRestore();
  }
});


for (const editable of [false, true]) {
  for (const dark of [false, true]) {
    for (const [width, height] of [[375, 667], [393, 852], [768, 1024], [1024, 768], [1280, 800], [1920, 1080]]) {
      it(`tier columns ${editable ? 'editing' : 'readonly'} ${dark ? 'dark' : 'light'} ${width}`, async () => {
        await page.viewport(width!, height!);
        document.documentElement.lang = 'zh-CN';
        document.documentElement.classList.toggle('dark', dark);
        const host = document.createElement('div');
        host.dataset.testid = 'tier-columns';
        host.className = 'p-4';
        host.style.width = `${width! >= 1024 ? width! - 256 : width!}px`;
        document.body.append(host);
        const root = createRoot(host);
        try {
          flushSync(() => root.render(<CustomerTiersPricingSectionView rows={[
            { key: 'q1000', name: '1千档', maxQuantity: { id: 'quantity', value: 1999, editable },
              middlePrice: { id: 'middle', value: '0.31', editable },
              largePrice: { id: 'large', value: '0.325', editable } },
          ]} />));
          await settleEffects();
          const headers = [...host.querySelectorAll<HTMLElement>('[role="columnheader"]')];
          expect(headers.map(header => header.textContent)).toEqual([
            '档位', '适用范围（推导）', '数量上界（含）', '中号组单价', '大号组单价',
          ]);
          const cells = [...host.querySelectorAll<HTMLElement>('[role="cell"]')];
          expect(cells).toHaveLength(headers.length);
          for (const index of [3, 4]) {
            const header = headers[index]!.getBoundingClientRect();
            const cell = cells[index]!.getBoundingClientRect();
            const price = cells[index]!.querySelector<HTMLElement>('[data-price-label], input')!;
            expect(cell.left).toBeCloseTo(header.left, 1);
            expect(cell.width).toBeCloseTo(header.width, 1);
            expect(price.getBoundingClientRect().width).toBeCloseTo(cell.width, 1);
          }
          expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width!);
          expect(await commands.checkShellAccessibility('[data-testid="tier-columns"]')).toEqual([]);
        } finally {
          flushSync(() => root.unmount());
          host.remove();
          document.documentElement.classList.remove('dark');
        }
      });
    }
  }
}
