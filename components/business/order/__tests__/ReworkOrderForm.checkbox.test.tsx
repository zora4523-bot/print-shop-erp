import { readFileSync } from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@/actions/order', () => ({
  createReworkOrderAction: vi.fn(),
}));

import { ReworkOrderForm } from '../ReworkOrderForm';

describe('ReworkOrderForm 复选框契约', () => {
  it('款式和工艺都使用共享 44/20px 复选框', () => {
    const html = renderToStaticMarkup(
      <ReworkOrderForm
        sourceOrderId="order-1"
        items={[
          {
            id: 'item-1',
            sequence: 1,
            name: '局部烫金款',
            quantity: 1_000,
            crafts: [{ id: 'craft-1', name: '局部烫金', isOutsource: false }],
          },
        ]}
      />,
    );
    const source = readFileSync(
      path.join(
        process.cwd(),
        'components',
        'business',
        'order',
        'ReworkOrderForm.tsx',
      ),
      'utf8',
    );

    expect(html).toContain('data-slot="checkbox"');
    expect(html).toContain('data-slot="checkbox-indicator"');
    expect(html).toContain('aria-label="选择重做款式 1：局部烫金款"');
    expect(source.match(/<Checkbox\b/g)).toHaveLength(2);
    expect(source).not.toContain('type="checkbox"');
  });
});
