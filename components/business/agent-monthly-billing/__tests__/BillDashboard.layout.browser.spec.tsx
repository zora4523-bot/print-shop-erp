import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import '@/app/globals.css';
import { BillDashboard } from '../BillDashboard';
import { collectGeometryIssues } from '@/tests/visual/ui-gates-geometry';

let host: HTMLElement;
let root: Root;
beforeEach(() => {
  host = document.createElement('main');
  host.style.width = '296px';
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
});

it('keeps the currency with the amount after opening the narrow dashboard table', async () => {
  flushSync(() => root.render(<BillDashboard expanded accounts={[]} data={{
    accounts: [],
    periods: [{ period: '2026-09', draft: '110400.00', confirmed: '22990.50', paid: '9912.60', total: '143303.10' }],
  }} />));
  await userEvent.click(page.getByText('查看账期数据表', { exact: true }));
  expect(host.querySelector('table')!.checkVisibility()).toBe(true);
  expect(collectGeometryIssues().filter((issue) => issue.startsWith('table-money-split') || issue.startsWith('number-split'))).toEqual([]);
  const region = host.querySelector<HTMLElement>('[aria-label="账期金额数据"]')!;
  expect(region.scrollWidth).toBeGreaterThan(region.clientWidth);
});
