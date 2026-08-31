import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// TextField 曾经把 required 解构出来「只拿去画红星」，没有透传给 <Input>。
// 读屏器于是把「款式名」「数量」念成普通选填输入框。tests/visual 的 axe 门禁
// 结构上覆盖不到这条路径：axe 无从知道哪些字段在业务上是必填的，星号和
// required 不一致它不算违规。所以用 SSR markup 断言把它钉住。
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('@/actions/order', () => ({
  createOrderAction: vi.fn(),
  submitOrderAction: vi.fn(),
}));
vi.mock('@/actions/order-quote', () => ({ quoteOrderItemsAction: vi.fn() }));
vi.mock('@/actions/order-logistics-quote', () => ({
  quoteExternalOrderChargesAction: vi.fn(),
}));
vi.mock('@/actions/order-packaging-quote', () => ({
  quoteOrderPackagingGroupsAction: vi.fn(),
}));
vi.mock('../PendingDesignImages', () => ({
  PendingDesignImages: () => null,
}));
vi.mock('../design-upload-client', () => ({
  uploadOrderItemDesignFile: vi.fn(),
}));

import {
  OrderForm,
  orderServerFieldErrorMessages,
  resolveOrderFormPendingState,
  type CraftOption,
} from '../OrderForm';

const crafts: CraftOption[] = [
  { id: 'craft-1', name: '烫金', isOutsource: false, isLowFrequency: false },
  { id: 'craft-2', name: '击凸', isOutsource: true, isLowFrequency: true },
];

function render() {
  return renderToStaticMarkup(
    <OrderForm
      draftScope="test-user"
      crafts={crafts}
      products={[]}
      settlementLabel="内部结算"
      usesExternalSalesPricing
    />,
  );
}

function tagWithIdSuffix(html: string, suffix: string): string {
  const match = html.match(
    new RegExp(`<[a-z]+[^>]*\\sid="[^"]*${suffix}"[^>]*>`),
  );
  expect(match, `应渲染出 id 以 "${suffix}" 结尾的控件`).not.toBeNull();
  return match![0]!;
}

describe('OrderForm 必填字段的 required 语义', () => {
  it('服务端错误只展示去重后的业务文案，不显示内部字段路径', () => {
    const messages = orderServerFieldErrorMessages({
      'items.0.paperType': ['第 1 款的纸张已停用'],
      'additionalShipments.0.province': ['请重新选择收货地区'],
      'items.1.paperType': ['第 1 款的纸张已停用'],
    });

    expect(messages).toEqual([
      '第 1 款的纸张已停用',
      '请重新选择收货地区',
    ]);
    expect(messages.join('；')).not.toMatch(
      /items\.0\.paperType|additionalShipments\.0\.province/,
    );
  });

  it('款式名与数量把 required / aria-required 透传给控件', () => {
    const html = render();

    const nameTag = tagWithIdSuffix(html, '-custom-name');
    expect(nameTag).toContain('required=""');
    expect(nameTag).toContain('aria-required="true"');

    const quantityTag = tagWithIdSuffix(html, '-quantity');
    expect(quantityTag).toContain('required=""');
    expect(quantityTag).toContain('aria-required="true"');
  });

  it('主收货信息把 required / aria-required 透传给文本域', () => {
    const html = render();

    const receiverAddressTag = tagWithIdSuffix(html, '-receiver-address-paste');
    expect(receiverAddressTag).toContain('required=""');
    expect(receiverAddressTag).toContain('aria-required="true"');
  });

  it('选填字段不能被一刀切标成必填', () => {
    const html = render();

    expect(html).not.toContain('id="customerRef"');
    expect(html).not.toContain('id="expressCode"');
  });

  it('外部销售表单不渲染任何手工价格或物流金额控件', () => {
    const html = render();

    expect(html).not.toContain('id="items.0.unitPrice"');
    expect(html).not.toContain('id="items.0.fixedFee"');
    expect(html).not.toContain('id="items.0.priceOverrideReason"');
    expect(html).not.toContain('id="primary-shipping-fee"');
    expect(html).not.toContain('id="primary-packing-fee"');
    expect(html).not.toContain('id="primary-charge-reason"');
    expect(html).not.toContain('成交单价');
    expect(html).not.toContain('一次性费用');
    expect(html).not.toContain('人工改价说明');
  });

  it('红星带 aria-hidden：必填靠 required 表达，不靠读屏器念星号', () => {
    const html = render();

    const label = html.match(
      /<label[^>]*for="[^"]*-custom-name"[^>]*>([\s\S]*?)<\/label>/,
    );
    expect(label, '工单名称应有关联的 <label>').not.toBeNull();
    const labelInner = label![1]!;
    expect(labelInner).toContain('工单名称');
    expect(labelInner).toMatch(/<span aria-hidden="true"[^>]*>\s*\*/);
  });

  it('加了 required 不等于换回浏览器原生气泡：form 仍是 noValidate', () => {
    expect(render()).toMatch(/<form[^>]*novalidate/i);
  });

  it('B 版自动保存草稿，页面只保留创建并提交主操作', () => {
    const html = render();
    const submitButton = html.match(/<button[^>]*value="submit"[^>]*>/)?.[0];

    expect(html).toContain('草稿未保存');
    expect(html).not.toContain('value="draft"');
    expect(submitButton).toContain('name="creationIntent"');
    expect(submitButton).toContain('disabled=""');
  });

  it.each([
    ['本地草稿尚未就绪', { localDraftReady: false }],
    ['正在创建工单', { submitting: true }],
    ['正在上传设计图', { uploading: true }],
    ['正在计算款式报价', { quoting: true }],
    ['正在计算物流报价', { logisticsQuoting: true }],
  ])('%s 时向读屏器声明表单忙碌', (_label, override) => {
    expect(
      resolveOrderFormPendingState({
        localDraftReady: true,
        submitting: false,
        uploading: false,
        quoting: false,
        logisticsQuoting: false,
        ...override,
      }).busy,
    ).toBe(true);
  });

  it('只在提交或上传这种不可安全离开的阶段锁住返回列表', () => {
    const ready = {
      localDraftReady: true,
      submitting: false,
      uploading: false,
      quoting: false,
      logisticsQuoting: false,
    };

    expect(resolveOrderFormPendingState(ready)).toEqual({
      busy: false,
      lockNavigation: false,
    });
    expect(
      resolveOrderFormPendingState({ ...ready, submitting: true })
        .lockNavigation,
    ).toBe(true);
    expect(
      resolveOrderFormPendingState({ ...ready, uploading: true })
        .lockNavigation,
    ).toBe(true);
    expect(
      resolveOrderFormPendingState({ ...ready, logisticsQuoting: true })
        .lockNavigation,
    ).toBe(false);
  });
});
