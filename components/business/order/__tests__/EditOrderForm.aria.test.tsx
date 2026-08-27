import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// 逐字段错误的 aria 连线只有在「提交失败」之后才存在于 DOM，而
// tests/visual 的 axe 门禁跑的是页面加载态——那时错误元素根本没渲染，
// 所以 axe 永远走不到这条路径。这个测试注入 invalid 状态把它钉住。
const { actionState } = vi.hoisted(() => ({
  actionState: {
    current: {
      status: 'invalid' as const,
      fieldErrors: { customName: ['工单名称不能为空'] } as Record<
        string,
        string[]
      >,
    },
  },
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useActionState: () => [actionState.current, vi.fn(), false],
  };
});

vi.mock('@/actions/order', () => ({
  updateOrderAction: Object.assign(vi.fn(), { bind: () => vi.fn() }),
}));

import { EditOrderForm } from '../EditOrderForm';

const initial = {
  customName: null,
  customerRef: null,
  receiverAddress: null,
  expressCode: null,
  packageRequirement: null,
  remark: null,
  promisedDate: null,
  isUrgent: false,
};

function render() {
  return renderToStaticMarkup(
    <EditOrderForm orderId="order-1" fieldset="FULL" initial={initial} />,
  );
}

describe('EditOrderForm 字段错误的 aria 连线', () => {
  it('出错的字段标 aria-invalid，未出错的不标', () => {
    const html = render();
    // customName 有错
    expect(html).toMatch(/id="customName"[^>]*aria-invalid="true"/);
    // customerRef 无错——不能被误标
    expect(html).not.toMatch(/id="customerRef"[^>]*aria-invalid="true"/);
  });

  it('aria-describedby 指向的 id 真实存在于输出里', () => {
    const html = render();
    const m = html.match(/id="customName"[^>]*aria-describedby="([^"]+)"/);
    expect(m, 'customName 应带 aria-describedby').not.toBeNull();
    const referenced = m![1]!;
    // 这是关键断言：引用的 id 必须真的有元素定义，否则读屏器读不到原因
    expect(html).toContain(`id="${referenced}"`);
    // 且那个元素承载的就是错误文案
    expect(html).toMatch(
      new RegExp(`id="${referenced}"[^>]*>[^<]*工单名称不能为空`),
    );
  });

  it('逐字段错误不使用 role="alert"（避免每次校验抢播报）', () => {
    const html = render();
    const m = html.match(/id="customName"[^>]*aria-describedby="([^"]+)"/);
    const referenced = m![1]!;
    const errorTag = html.match(new RegExp(`<[^>]*id="${referenced}"[^>]*>`))![0];
    expect(errorTag).not.toContain('role="alert"');
  });

  it('收货地址在普通编辑表单中保持 HTML 与读屏必填语义', () => {
    const html = render();
    const tag = html.match(/<textarea[^>]*id="receiverAddress"[^>]*>/)?.[0];
    expect(tag).toBeDefined();
    expect(tag).toContain('required=""');
    expect(tag).toContain('aria-required="true"');
  });
});
