import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const { usePathnameMock } = vi.hoisted(() => ({
  usePathnameMock: vi.fn<() => string>(),
}));

vi.mock('next/navigation', () => ({
  usePathname: usePathnameMock,
}));

import { AdminBreadcrumb, resolveSegmentLabel } from '../AdminBreadcrumb';

// 面包屑最后一段今天直接把 25 位 cuid 印出来，等于什么都没说。
// resolveSegmentLabel 是这部分逻辑的纯函数出口，单测直接调。
const CUID = 'cmey8k3s10000abcdefghijkl';

describe('resolveSegmentLabel', () => {
  it('已知段名走中文标签表', () => {
    expect(resolveSegmentLabel('orders', null)).toBe('工单');
  });

  it('/orders/<id>/edit 的最后一段不再显示英文 edit', () => {
    expect(resolveSegmentLabel('edit', null)).toBe('编辑');
  });

  it('id 段在详情页还没交上业务编号时显示占位「详情」', () => {
    expect(resolveSegmentLabel(CUID, null)).toBe('详情');
  });

  it('id 段拿到业务编号后显示编号本身', () => {
    expect(resolveSegmentLabel(CUID, 'GD-260821-001')).toBe('GD-260821-001');
  });

  it('uuid 形态的段同样识别为 id', () => {
    expect(
      resolveSegmentLabel('3f2504e0-4f89-11d3-9a0c-0305e82c3301', null),
    ).toBe('详情');
  });

  it('非 id 的未知段原样显示', () => {
    // tests/visual/admin-responsive.spec.ts 会 goto /orders/e2e-admin-ui-missing
    // 跑 404 用例；这个段带连字符、不匹配 cuid 正则，行为与今天一致。
    expect(resolveSegmentLabel('e2e-admin-ui-missing', null)).toBe(
      'e2e-admin-ui-missing',
    );
    expect(resolveSegmentLabel('e2e-admin-ui-missing', 'GD-260821-001')).toBe(
      'e2e-admin-ui-missing',
    );
  });
});

/** 去掉标签，只留渲染出来的可见文本。 */
function visibleText(html: string): string {
  return html.replace(/<[^>]*>/g, '');
}

describe('AdminBreadcrumb SSR', () => {
  it('不把 cuid 印到面包屑上', () => {
    usePathnameMock.mockReturnValue(`/orders/${CUID}/edit`);

    const html = renderToStaticMarkup(<AdminBreadcrumb />);

    // href 里当然还得带 id（那是链接目标），断言落在可见文本上。
    expect(visibleText(html)).not.toContain(CUID);
    expect(html).toContain(`href="/orders/${CUID}"`);
    expect(visibleText(html)).toContain('工单');
    expect(visibleText(html)).toContain('详情');
    expect(visibleText(html)).toContain('编辑');
  });

  it('根路径显示首页', () => {
    usePathnameMock.mockReturnValue('/');

    expect(renderToStaticMarkup(<AdminBreadcrumb />)).toContain('首页');
  });
});
