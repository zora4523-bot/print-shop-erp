import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AdminRouteError } from '../AdminRouteError';
import { AdminRouteLoading } from '../AdminRouteLoading';

describe('admin route states', () => {
  it('uses the shared page error fallback inside real error.tsx boundaries', () => {
    const html = renderToStaticMarkup(
      <AdminRouteError error={new Error('boom')} retry={vi.fn()} />,
    );

    expect(html).toContain('data-slot="admin-route-error"');
    expect(html).toContain('data-scope="page"');
    expect(html).toContain('role="alert"');
    expect(html).toContain('重试当前页面');
    expect(html).toContain('重新加载页面');
    expect(html).toContain('返回首页');
    expect(html).toContain('href="/"');
    expect(html).not.toContain('href="/owner"');
  });

  it.each([
    Object.assign(new Error('private chunk path'), { name: 'ChunkLoadError' }),
    new Error('Loading chunk 123 failed.'),
    new Error('Failed to load chunk /_next/static/chunks/private.js'),
    new TypeError('Failed to fetch dynamically imported module: private-url'),
    new TypeError('Importing a module script failed.'),
    new TypeError('error loading dynamically imported module: private-url'),
  ])('offers a document reload for a failed module without exposing internals', (error) => {
    const html = renderToStaticMarkup(<AdminRouteError error={error} retry={vi.fn()} />);
    expect(html).toContain('重新加载页面');
    expect(html).not.toContain('重试当前页面');
    expect(html).not.toContain(error.message);
  });

  it('uses the shared skeleton contract without replacing persistent chrome', () => {
    const html = renderToStaticMarkup(
      <AdminRouteLoading label="正在加载管理页面" />,
    );

    expect(html).toContain('data-slot="admin-route-loading"');
    expect(html).toContain('data-slot="content-skeleton"');
    expect(html).toContain('data-keep-chrome="false"');
    expect(html).toContain('正在加载管理页面');
  });

  it.each(['detail', 'form'] as const)('%s 变体画页头 + 卡片，不画表格骨架', (variant) => {
    const html = renderToStaticMarkup(
      <AdminRouteLoading variant={variant} label="正在加载采购单" />,
    );

    expect(html).toContain(`data-variant="${variant}"`);
    expect(html).not.toContain('data-variant="table"');
    expect(html).toContain('role="status"');
    expect(html).toContain('正在加载采购单');
    expect(html).not.toContain('正在加载正在加载');
    if (variant === 'form') expect(html).toContain('max-w-3xl');
  });

  // 骨架形状与目标页一致（审查 #26）：工单详情页头没有返回入口（由顶栏面包屑承担），
  // 骨架也不能先画一条返回占位再在内容到达时消失。
  it('detail 骨架默认画返回占位，withBack={false} 时不画', () => {
    const backPlaceholder = /data-slot="skeleton" class="[^"]*\bh-5 w-24\b/g;
    const withBack = renderToStaticMarkup(<AdminRouteLoading variant="detail" label="正在加载采购单" />);
    const withoutBack = renderToStaticMarkup(
      <AdminRouteLoading variant="detail" label="正在加载工单详情" withBack={false} />,
    );
    expect(withBack.match(backPlaceholder)).toHaveLength(1);
    expect(withoutBack.match(backPlaceholder)).toBeNull();
    expect(withoutBack).toContain('data-variant="detail"');
  });
});
