import type { ComponentProps } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
// Link is a framework boundary; Vite does not inject Next's process definitions.
vi.mock('next/link', () => ({
  default: ({ prefetch, ...props }: ComponentProps<'a'> & { prefetch?: boolean }) => {
    void prefetch;
    return <a {...props} />;
  },
  useLinkStatus: () => ({ pending: false }),
}));

import { CustomerBlankPricingSectionView } from '../CustomerPricingSectionViews';

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
