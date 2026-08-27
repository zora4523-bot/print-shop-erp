import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock('@/actions/order', () => ({
  createOrderChangeRequestAction: vi.fn(),
}));

import {
  createOrderChangeEditableItem,
  OrderChangeRequestForm,
} from '../OrderChangeRequestForm';

const sourceItem = {
  id: 'item-1',
  sequence: 1,
  name: '现货大号（产品表!C2）',
  quantity: 2_000,
  specification: '大号90×165（规格表!A4:C4）',
  foilColors: ['金色'],
};

describe('OrderChangeRequestForm 业务语言投影', () => {
  it('清理可见名称但保留未编辑的提交原值', () => {
    const editable = createOrderChangeEditableItem(sourceItem);
    const html = renderToStaticMarkup(
      <OrderChangeRequestForm orderId="order-1" items={[sourceItem]} />,
    );

    expect(editable.displayName).toBe('现货大号');
    expect(editable.name).toBe(sourceItem.name);
    expect(editable.displaySpecification).toBe('大号90×165');
    expect(editable.specification).toBe(sourceItem.specification);
    expect(html).toContain('现货大号');
    expect(html).not.toMatch(/产品表!C2|规格表!A4:C4/);
  });
});
