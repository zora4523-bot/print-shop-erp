import { expect, it } from 'vitest';
import { billItemPage } from '../item-list';

const items = Array.from({ length: 65 }, (_, index) => ({
  orderNoSnapshot: `ORDER-${index}`, settledFeeSnapshot: '12.30', order: { customName: '后来改名' },
  settlementDetailSnapshot: { schemaVersion: 1, orderName: `原名称 ${index}`, processingAmount: '12.30', charges: [] },
}));
it('bounds large bills without losing the final page', () => {
  expect(billItemPage(items, {})).toMatchObject({ total: 65, page: 1, pageCount: 3 });
  const last = billItemPage(items, { page: '99999' });
  expect(last.page).toBe(3);
  expect(last.rows).toHaveLength(5);
  expect(last.rows.at(-1)?.orderNoSnapshot).toBe('ORDER-64');
});
it('searches the displayed historical name and number, not a later rename', () => {
  expect(billItemPage(items, { q: '原名称 64' }).rows).toHaveLength(1);
  expect(billItemPage(items, { q: 'order-64' }).rows).toHaveLength(1);
  expect(billItemPage(items, { q: '后来改名' }).rows).toHaveLength(0);
  expect(billItemPage([{ ...items[0], settlementDetailSnapshot: null }], { q: '后来改名' }).rows).toHaveLength(1);
});
