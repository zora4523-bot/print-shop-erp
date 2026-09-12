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
    expect(html).toContain('返回首页');
    expect(html).toContain('href="/"');
    expect(html).not.toContain('href="/owner"');
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
});
