import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { OrderItemPricingRoute } from '@/generated/prisma/enums';
import type { OrderChangeCatalogProduct } from '@/lib/order/change-request-catalog-identity';
import { createOrderChangeRequestSchema } from '@/lib/auth/schemas';

vi.mock('@/actions/order', () => ({
  createOrderChangeRequestAction: vi.fn(),
}));

import {
  buildOrderChangeRequestPayload,
  addedItemFoilColors,
  buildSelectedOrderItemChanges,
  knownOrderFoilColors,
  createOrderChangeEditableItem,
  hasOrderItemSemanticChange,
  orderChangeRequestDraftIdentity,
  OrderChangeRequestForm,
} from '../OrderChangeRequestForm';

const sourceItem = {
  id: 'item-1',
  sequence: 1,
  name: '现货大号（产品表!C2）',
  quantity: 2_000,
  productId: 'product-large',
  pricingRoute: OrderItemPricingRoute.STOCK_BLANK,
  specification: '大号90×165（规格表!A4:C4）',
  paperType: '160g珠光艳闪',
  paperWeightGsm: 160,
  frontFoilColors: ['金色'],
  backFoilColors: ['红金'],
  foilColors: ['金色', '红金'],
  isDoubleSided: true,
};

const catalogProducts: OrderChangeCatalogProduct[] = [
  {
    id: 'product-large',
    category: 'BLANK_STOCK',
    specification: '大号封90×165',
    paperType: '160g珠光艳闪',
    weight: null,
    isActive: true,
  },
  {
    id: 'product-mid',
    category: 'BLANK_STOCK',
    specification: '中号封80×115',
    paperType: '160g珠光艳闪',
    weight: null,
    isActive: true,
  },
];

describe('OrderChangeRequestForm 业务语言投影', () => {
  it.each([{ colors: ['哑金'] }, { colors: ['哑金', '亚金'] }, { colors: ['红色', '红金'] }])(
    '历史颜色 $colors 只改名时省略颜色并通过命令校验', ({ colors }) => {
      const item = { ...sourceItem, frontFoilColors: colors, foilColors: colors, backFoilColors: [] };
      const editable = createOrderChangeEditableItem(item);
      editable.selected = true;
      editable.name = '修改后的款名';
      const items = buildSelectedOrderItemChanges([item], { [item.id]: editable });
      expect(items[0]).not.toHaveProperty('frontFoilColors');
      expect(items[0]).not.toHaveProperty('backFoilColors');
      expect(createOrderChangeRequestSchema.safeParse({
        orderId: 'order-1', expectedRevision: 2, expectedWorkOrderVersion: 1,
        type: 'MODIFY', modifyKind: 'OTHER', reason: '核对名称', items,
      }).success).toBe(true);
    },
  );

  it('用户明确换成另一别名仍发送颜色字段', () => {
    const item = { ...sourceItem, frontFoilColors: ['哑金'] };
    const editable = createOrderChangeEditableItem(item);
    editable.selected = true;
    editable.frontFoilColors = '亚金';
    expect(buildSelectedOrderItemChanges([item], { [item.id]: editable })[0]).toMatchObject({
      frontFoilColors: ['亚金'], backFoilColors: ['红金'],
    });
  });

  it('用工单版本和款式事实建立稳定的草稿身份', () => {
    const input = {
      orderId: 'order-1',
      expectedRevision: 4,
      expectedWorkOrderVersion: 2,
      items: [sourceItem],
      catalogProducts,
    };
    const identity = orderChangeRequestDraftIdentity(input);

    expect(
      orderChangeRequestDraftIdentity({ ...input, items: [{ ...sourceItem }] }),
    ).toBe(identity);
    expect(
      orderChangeRequestDraftIdentity({ ...input, expectedRevision: 5 }),
    ).not.toBe(identity);
    expect(
      orderChangeRequestDraftIdentity({
        ...input,
        items: [{ ...sourceItem, quantity: sourceItem.quantity + 1 }],
      }),
    ).not.toBe(identity);
    expect(
      orderChangeRequestDraftIdentity({
        ...input,
        catalogProducts: [...catalogProducts].reverse(),
      }),
    ).toBe(identity);
    expect(
      orderChangeRequestDraftIdentity({
        ...input,
        catalogProducts: catalogProducts.map((product, index) =>
          index === 0 ? { ...product, isActive: false } : product,
        ),
      }),
    ).not.toBe(identity);
    expect(
      orderChangeRequestDraftIdentity({
        ...input,
        catalogProducts: catalogProducts.map((product, index) =>
          index === 0
            ? {
                ...product,
                paperMaterialId: 'paper-1',
                linkedPaper: { isActive: true, outOfStock: true },
              }
            : product,
        ),
      }),
    ).not.toBe(identity);
  });

  it('保留名称提交原值并仅展示安全的目录规格', () => {
    const editable = createOrderChangeEditableItem(sourceItem);
    const html = renderToStaticMarkup(
      <OrderChangeRequestForm
        orderId="order-1"
        expectedRevision={4}
        expectedWorkOrderVersion={2}
        items={[sourceItem]}
        catalogProducts={catalogProducts}
      />,
    );

    expect(editable.displayName).toBe('现货大号');
    expect(editable.name).toBe(sourceItem.name);
    expect(editable.displaySpecification).toBe('大号90×165');
    expect(editable.frontFoilColors).toBe('金色');
    expect(editable.backFoilColors).toBe('红金');
    expect(html).toContain('现货大号');
    expect(html).toContain('正反面烫金颜色');
    expect(html.match(/data-slot="checkbox"/g)).toHaveLength(2);
    expect(html).toContain('aria-label="选择款式 1：现货大号"');
    expect(html).toContain('aria-label="本次申请需要新增一款"');
    expect(html).toContain('目录规格');
    expect(html).toContain('规格只显示与当前计价路线、纸张和克重一致');
    expect(html).not.toContain('class="size-4 shrink-0"');
    expect(html).not.toMatch(/<input[^>]*value="大号90×165"/);
    expect(html).not.toMatch(/产品表!C2|规格表!A4:C4/);
  });

  it('空白封规格变更直接提交纸张克重规格身份', () => {
    const editable = createOrderChangeEditableItem(
      sourceItem,
      catalogProducts,
    );
    editable.selected = true;
    editable.targetProductId = 'product-mid';
    editable.specification = '中号封80×115';

    expect(hasOrderItemSemanticChange(sourceItem, editable)).toBe(true);
    expect(
      buildSelectedOrderItemChanges([sourceItem], {
        [sourceItem.id]: editable,
      }),
    ).toEqual([
      expect.objectContaining({
        operation: 'UPDATE',
        itemId: 'item-1',
        targetBlankIdentity: { paperType: sourceItem.paperType, paperWeightGsm: sourceItem.paperWeightGsm, specification: '中号封80×115' },
      }),
    ]);
  });

  it('新增款式的烫金色与现有款式走同一套显示名反查', () => {
    const known = knownOrderFoilColors(['红色', '黑色'], [
      { frontFoilColors: ['浅色'], foilColors: [] },
    ]);
    expect(known).toEqual(['红色', '黑色', '浅色']);
    // 界面到处展示「红金、黑金」，存库必须是目录名。
    expect(addedItemFoilColors('红金、 黑金，红金', known)).toEqual(['红色', '黑色']);
    // 目录里真有一个叫「红金」的物料时，不把它改写成「红色」。
    expect(addedItemFoilColors('红金', [...known, '红金'])).toEqual(['红金']);
    expect(addedItemFoilColors('  ', known)).toEqual([]);
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

it('packaging membership controls the add-item capability and resets an obsolete draft', () => {
  const props = { orderId: 'order-1', expectedRevision: 4, expectedWorkOrderVersion: 2, items: [sourceItem], catalogProducts };
  const allowed = renderToStaticMarkup(<OrderChangeRequestForm {...props} hasPackagingGroups={false} />);
  const blocked = renderToStaticMarkup(<OrderChangeRequestForm {...props} hasPackagingGroups />);
  expect(allowed).toContain('本次申请需要新增一款');
  expect(blocked).not.toContain('本次申请需要新增一款');
  expect(orderChangeRequestDraftIdentity({ ...props, hasPackagingGroups: true })).not.toBe(orderChangeRequestDraftIdentity({ ...props, hasPackagingGroups: false }));
});

it('submits changed units per bag only for an eligible existing packaging line', () => {
  const item = { ...sourceItem, pack: 10, packagingEditable: true };
  const editable = { ...createOrderChangeEditableItem(item), selected: true, pack: '20' };
  expect(buildSelectedOrderItemChanges([item], { [item.id]: editable })).toEqual([
    expect.objectContaining({ operation: 'UPDATE', itemId: item.id, pack: 20 }),
  ]);
  expect(buildSelectedOrderItemChanges([{ ...item, packagingEditable: false }], { [item.id]: editable })).toEqual([]);
});
it('does not submit an unchanged packaging value or erase missing legacy packaging', () => {
  const item = { ...sourceItem, pack: 10, packagingEditable: true };
  const editable = { ...createOrderChangeEditableItem(item), selected: true, quantity: 3000 };
  expect(buildSelectedOrderItemChanges([item], { [item.id]: editable })[0]).not.toHaveProperty('pack');
});

it('已有地址发货时只提供交期修改：不渲染款式勾选、新增款式与数量类别', () => {
  const props = { orderId: 'order-1', expectedRevision: 4, expectedWorkOrderVersion: 2, items: [sourceItem], catalogProducts };
  const full = renderToStaticMarkup(<OrderChangeRequestForm {...props} />);
  const dueDateOnly = renderToStaticMarkup(<OrderChangeRequestForm {...props} dueDateOnly />);
  expect(full).toContain('选择款式 1');
  expect(full).toContain('<option value="QTY" selected="">数量</option>');
  expect(dueDateOnly).not.toContain('选择款式 1');
  expect(dueDateOnly).not.toContain('本次申请需要新增一款');
  expect(dueDateOnly).not.toContain('<option value="QTY">');
  expect(dueDateOnly).toContain('<option value="DUE_DATE"');
  expect(dueDateOnly).toContain('新的承诺交期');
  expect(dueDateOnly).toContain('工单已有地址发货，本次只能申请调整交期。');
  expect(orderChangeRequestDraftIdentity({ ...props, dueDateOnly: true })).not.toBe(orderChangeRequestDraftIdentity(props));
});
