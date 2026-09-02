import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/actions/order', () => ({
  createOrderChangeRequestAction: vi.fn(),
}));

import {
  buildOrderChangeRequestPayload,
  buildSelectedOrderItemChanges,
  createOrderChangeEditableItem,
  hasOrderItemSemanticChange,
  OrderChangeRequestForm,
} from '../OrderChangeRequestForm';

const sourceItem = {
  id: 'item-1',
  sequence: 1,
  name: '现货大号（产品表!C2）',
  quantity: 2_000,
  specification: '大号90×165（规格表!A4:C4）',
  frontFoilColors: ['金色'],
  backFoilColors: ['红金'],
  foilColors: ['金色', '红金'],
  isDoubleSided: true,
};

describe('OrderChangeRequestForm 业务语言投影', () => {
  it('保留名称提交原值并只读展示规格', () => {
    const editable = createOrderChangeEditableItem(sourceItem);
    const html = renderToStaticMarkup(
      <OrderChangeRequestForm
        orderId="order-1"
        expectedRevision={4}
        expectedWorkOrderVersion={2}
        items={[sourceItem]}
      />,
    );

    expect(editable.displayName).toBe('现货大号');
    expect(editable.name).toBe(sourceItem.name);
    expect(editable.displaySpecification).toBe('大号90×165');
    expect(editable.frontFoilColors).toBe('金色');
    expect(editable.backFoilColors).toBe('红金');
    expect(html).toContain('现货大号');
    expect(html).toContain('正反面烫金颜色');
    expect(html).toContain('继承规格、纸张、工艺和计价参数');
    expect(html.match(/data-slot="checkbox"/g)).toHaveLength(2);
    expect(html).toContain('aria-label="选择款式 1：现货大号"');
    expect(html).toContain('aria-label="本次申请需要新增一款"');
    expect(html).not.toContain('可改款式名、数量、规格');
    expect(html).not.toContain('class="size-4 shrink-0"');
    expect(html).not.toMatch(/<input[^>]*value="大号90×165"/);
    expect(html).not.toMatch(/产品表!C2|规格表!A4:C4/);
  });

  it('把烫色按集合比较，顺序和重复值不产生虚假修改', () => {
    const item = {
      ...sourceItem,
      frontFoilColors: ['金色', '银色'],
      backFoilColors: ['红金', '蓝色'],
      foilColors: ['金色', '银色', '红金', '蓝色'],
    };
    const editable = createOrderChangeEditableItem(item);
    editable.selected = true;
    editable.frontFoilColors = '银色、金色、银色';
    editable.backFoilColors = '蓝色，红金';

    expect(hasOrderItemSemanticChange(item, editable)).toBe(false);
    expect(buildSelectedOrderItemChanges([item], { [item.id]: editable })).toEqual(
      [],
    );
  });

  it('只构造真正变化的已选款式，并携带页面快照版本', () => {
    const unchanged = createOrderChangeEditableItem(sourceItem);
    unchanged.selected = true;
    const changedItem = { ...sourceItem, id: 'item-2', sequence: 2 };
    const changed = createOrderChangeEditableItem(changedItem);
    changed.selected = true;
    changed.quantity = 2_500;

    const items = buildSelectedOrderItemChanges(
      [sourceItem, changedItem],
      {
        [sourceItem.id]: unchanged,
        [changedItem.id]: changed,
      },
    );
    expect(items).toEqual([
      {
        operation: 'UPDATE',
        itemId: 'item-2',
        name: sourceItem.name,
        quantity: 2_500,
        frontFoilColors: ['金色'],
        backFoilColors: ['红金'],
      },
    ]);
    expect(
      buildOrderChangeRequestPayload({
        orderId: 'order-1',
        expectedRevision: 4,
        expectedWorkOrderVersion: 2,
        modifyKind: 'QTY',
        reason: '客户调整数量',
        items,
      }),
    ).toEqual({
      orderId: 'order-1',
      expectedRevision: 4,
      expectedWorkOrderVersion: 2,
      type: 'MODIFY',
      modifyKind: 'QTY',
      reason: '客户调整数量',
      items,
    });
  });
});
