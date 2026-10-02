import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { InventoryCountClient } from '../InventoryCountClient';
import type { InventoryCountMaterialRow } from '@/lib/inventory-count';
import '@/app/globals.css';

let host: HTMLDivElement; let root: Root;
const rows = (stock: string): InventoryCountMaterialRow[] => [{ id: 'm1', code: 'M1', name: '测试物料', specification: null, category: 'OTHER', unit: '个', isActive: true, currentStock: stock, safetyStock: null,
  locations: [{ id: 'stock1', locationId: 'l1', locationName: '一号库位', locationCode: 'L1', warehouseName: '仓库', warehouseCode: 'W1', currentStock: stock }] }];
beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(() => { flushSync(() => root.unmount()); host.remove(); vi.restoreAllMocks(); });
it('refreshes server rows and restores unedited baselines without overwriting an entered count', async () => {
  const fetch = vi.spyOn(window, 'fetch').mockResolvedValue(new Response(JSON.stringify({ materials: rows('20') }), { headers: { 'Content-Type': 'application/json' } }));
  flushSync(() => root.render(<InventoryCountClient action={vi.fn()} initialIdempotencyKey="test" initialRows={rows('10')} />));
  await expect.element(page.getByRole('cell', { name: '20 个', exact: true })).toBeVisible();
  const input = page.getByRole('textbox').nth(1);
  await input.fill('18');
  fetch.mockResolvedValue(new Response(JSON.stringify({ materials: rows('30') }), { headers: { 'Content-Type': 'application/json' } }));
  window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
  await expect.element(page.getByText('当前账面 30')).toBeVisible();
  expect(JSON.parse(host.querySelector<HTMLInputElement>('input[name="items"]')!.value)).toEqual([{ materialId: 'm1', locationId: 'l1', bookQuantity: '20', countedQuantity: '18.00' }]);
});
