import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const { fieldState } = vi.hoisted(() => ({ fieldState: { errors: {} as Record<string, { type: string; message: string }> } }));
vi.mock('react-hook-form', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-hook-form')>();
  return { ...actual, useForm: (...args: Parameters<typeof actual.useForm>) => {
    const form = actual.useForm(...args);
    return { ...form, formState: { ...form.formState, errors: fieldState.errors } };
  } };
});

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
vi.mock('@/actions/create-order-quote', () => ({
  quoteExternalCreateOrderAction: vi.fn(),
  quoteSampleOrderAction: vi.fn(),
}));
vi.mock('@/actions/workbench', () => ({ quoteWorkbenchItemAction: vi.fn() }));
vi.mock('@/actions/design-upload', () => ({ deleteOrderItemDesignAction: vi.fn() }));
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

function render(salesActor = true) {
  return renderToStaticMarkup(
    <OrderForm
      draftScope="test-user"
      crafts={crafts}
      products={[]}
      externalSalesAccounts={
        salesActor
          ? undefined
          : [{ id: 'sales-1', displayName: '外部销售甲', username: 'sales-a' }]
      }
      externalCreateOrderOptions={{
        products: [],
        papers: [],
        specifications: [],
        foilColors: [
          {
            id: 'foil-1',
            code: 'MATTE_GOLD',
            name: '品牌金',
            displayColor: '#b98f2c',
            displayImage: null,
            sortOrder: 1,
          },
        ],
      }}
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
  it.each([true, false])('两种建单身份均可添加第 2 个收货地址：%s', (external) => {
    expect(render(external)).toContain('添加地址 2');
  });
  it('管理员代建必须选择外部销售，不再提供工厂直接业务选项', () => {
    const html = render(false);
    const select = tagWithIdSuffix(html, 'externalSalesUserId');
    expect(select).toContain('required');
    expect(select).toContain('aria-required="true"');
    expect(html).toContain('关联外部销售');
    expect(html).toContain('请选择外部销售');
    expect(html).toContain('外部销售甲 · sales-a');
    expect(html).not.toContain('工厂直接业务');
  });
  it('外部销售本人建单不显示关联外部销售', () => {
    expect(render(true)).not.toContain('externalSalesUserId');
  });
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

  it('管理员端同样渲染 B 表单，按外部销售结算并必须选择外部销售', () => {
    const html = render(false);

    expect(html).toContain('data-slot="order-form-b"');
    expect(html).toContain('外部销售应付工厂');
    expect(html).not.toContain('id="customerRef"');
    expect(html).toContain('id="externalSalesUserId"');
    expect(html).not.toContain('id="expressCode"');
    expect(html).not.toContain('id="items.0.manualQuoteReason"');
    expect(html).not.toContain('需人工核价的要求（选填）');
    expect(html).toContain('id="items.0.artworkVersion"');
    expect(html).not.toContain('id="items.0.plateGroupId"');
    expect(html).not.toContain('id="items.0.pricingGroup"');
    expect(html).not.toContain('id="items.0.remark"');
    expect(tagWithIdSuffix(html, '-custom-name')).toContain('required=""');
  });

  it('管理员急单使用统一 44px 复选框并保留表单语义', () => {
    const html = render(false);

    expect(html).toContain('data-slot="urgent-order-field"');
    expect(html).toContain('data-slot="urgent-order-title"');
    expect(html).toContain('data-slot="urgent-order-description"');
    expect(html).toContain('data-slot="checkbox"');
    expect(html).toContain('role="checkbox"');
    expect(html).toContain('id="urgent-order-accessible-label"');
    expect(html).toContain('aria-labelledby="urgent-order-accessible-label"');
    expect(html).toContain('name="isUrgent"');
    expect(html).toContain('size-11');
    // 承诺交期固定窄列，急单并排在右侧（不再单独占一整行）。
    expect(html).toContain('data-slot="order-form-schedule"');
    expect(html).toContain('grid-cols-[minmax(0,11rem)_minmax(0,1fr)]');
    expect(html).not.toContain('class="size-4 shrink-0"');
  });

  it('内部建单不再渲染产品下拉、动态材料或创建页人工价格控件', () => {
    const html = render(false);

    expect(html).not.toContain('报价产品');
    expect(html).not.toContain('自定义规格');
    expect(html).not.toContain('自定义纸张');
    expect(html).not.toContain('手动输入克重');
    expect(html).not.toContain('改尺寸（转管理员终价）');
    expect(html).not.toContain('id="items.0.unitPrice"');
    expect(html).not.toContain('id="items.0.fixedFee"');
    expect(html).not.toContain('id="items.0.priceOverrideReason"');
    expect(html).not.toContain('成交单价');
    expect(html).not.toContain('一次性费用');
    expect(html).not.toContain('人工改价说明');
    expect(html).not.toMatch(/<button[^>]*>\s*重新核价\s*<\/button>/u);
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
    // 星号是 aria-hidden 元素上的 CSS 生成内容：既不进无障碍名称，也不进 label 文本。
    expect(labelInner).toMatch(
      /<span aria-hidden="true" data-slot="required-mark"[^>]*after:content-\[&#x27;\*&#x27;\][^>]*><\/span>/,
    );
    expect(labelInner.replace(/<[^>]*>/g, '')).toBe('工单名称');
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


it.each([true, false])('shows one optional order note after shipping for external=%s', (external) => {
  const html = render(external);
  expect(html.match(/id="remark"/g)).toHaveLength(1);
  expect(html).toContain('工单备注（选填）');
  expect(html).toMatch(/<textarea[^>]*id="remark"[^>]*maxLength="1000"/i);
  expect(html.indexOf('id="remark"')).toBeGreaterThan(html.indexOf('多地址发货'));
});

it('field validation keeps aria links without interrupting screen readers', () => {
  fieldState.errors = { remark: { type: 'maxLength', message: '工单备注过长' } };
  try {
    const html = render(false);
    expect(html).toMatch(/<textarea[^>]*id="remark"[^>]*aria-invalid="true"[^>]*aria-describedby="order-remark-error"/);
    const tag = html.match(/<p[^>]*id="order-remark-error"[^>]*>/)?.[0];
    expect(tag).toBeDefined();
    expect(tag).not.toContain('role="alert"');
    expect(html).toContain('工单备注过长');
  } finally { fieldState.errors = {}; }
});

it('paper and foil field errors keep their accessible description without alerts', async () => {
  const { PillPicker } = await import('../order-form-b/OrderFieldPrimitives');
  const { OrderFoilSwatchPicker } = await import('../order-form-b/OrderFoilSwatchPicker');
  for (const element of [
    <PillPicker key="paper" id="paper" label="纸张材质" value="" options={[]} onChange={() => {}} error="请选择纸张" />,
    <OrderFoilSwatchPicker key="foil" id="foil" value={[]} options={[]} onChange={() => {}} error="请选择烫金色" />,
  ]) {
    const html = renderToStaticMarkup(element);
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-describedby=');
    expect(html).not.toContain('role="alert"');
  }
});
