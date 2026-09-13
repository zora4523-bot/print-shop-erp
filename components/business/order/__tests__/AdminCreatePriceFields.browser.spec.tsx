import { useState } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { commands, page } from 'vitest/browser';
import '@/app/globals.css';
import { AdminCreatePriceFields } from '../AdminCreatePriceFields';
import type { CreateOrderInput } from '@/lib/auth/schemas';
import { Button } from '@/components/ui/button';

type Price = NonNullable<CreateOrderInput['items'][number]['adminPrice']>;
let host: HTMLDivElement;
let root: Root;
function Fixture() {
  const [value, setValue] = useState<Price>();
  const [facts, setFacts] = useState('original');
  return (
    <>
      <AdminCreatePriceFields
        value={value}
        onChange={setValue}
        factsKey={facts}
        disabled={false}
        suggestedAmount="123.45"
        error={
          value && value.factsKey !== facts
            ? '款式条件已变化，请重新确认人工价格'
            : undefined
        }
      />
      <Button
        className="mt-4 min-h-11 px-4"
        onClick={() => setFacts('changed')}
      >
        修改数量
      </Button>
    </>
  );
}
beforeEach(() => {
  document.documentElement.lang = 'zh-CN';
  host = document.createElement('div');
  host.dataset.testid = 'price-fixture';
  host.className = 'p-4';
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
  document.documentElement.classList.remove('dark');
});
describe('administrator create pricing', () => {
  for (const theme of ['light', 'dark'])
    for (const [width, height] of [
      [375, 667],
      [393, 852],
      [768, 1024],
      [1024, 768],
      [1280, 800],
      [1920, 1080],
    ]) {
      it(`${width}x${height} ${theme}: manual price, stale acknowledgement, overflow, touch and axe`, async () => {
        await page.viewport(width, height);
        document.documentElement.classList.toggle('dark', theme === 'dark');
        flushSync(() => root.render(<Fixture />));
        await page
          .getByRole('button', { name: '人工定价', exact: true })
          .click();
        await page.getByRole('textbox', { name: '本款加工费（元）' }).fill('0');
        await page
          .getByRole('textbox', { name: '定价原因' })
          .fill('协议免加工费');
        await page.getByRole('button', { name: '修改数量' }).click();
        await expect
          .element(page.getByRole('status'))
          .toHaveTextContent('重新确认');
        await page.getByRole('button', { name: '确认当前人工价格' }).click();
        await expect.element(page.getByRole('status')).toHaveTextContent('');
        expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
        for (const element of host.querySelectorAll('button,input')) {
          const box = element.getBoundingClientRect();
          expect(box.height).toBeGreaterThanOrEqual(44);
          expect(box.width).toBeGreaterThanOrEqual(44);
        }
        expect(
          await commands.checkShellAccessibility(
            '[data-testid="price-fixture"]',
          ),
        ).toEqual([]);
        await page
          .getByRole('button', { name: '自动计价', exact: true })
          .click();
        await expect
          .element(page.getByRole('textbox', { name: '本款加工费（元）' }))
          .not.toBeInTheDocument();
      });
    }
});
