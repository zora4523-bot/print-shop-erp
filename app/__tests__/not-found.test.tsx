import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import RootNotFound from '@/app/not-found';

describe('root not-found UI', () => {
  it('uses the shared non-enumerating state and returns through the role dispatcher', () => {
    const html = renderToStaticMarkup(<RootNotFound />);

    expect(html).toContain('data-kind="no-access"');
    expect(html).toContain('找不到这个页面，或你没有访问权限');
    expect(html).toContain('href="/"');
    expect(html).toContain('回我的工作台');
    expect(html.match(/<h1\b/g)).toHaveLength(1);
  });
});

describe('admin shell not-found UI', () => {
  it('returns through the role dispatcher instead of /owner', async () => {
    const { default: AdminNotFound } = await import('@/app/(admin)/not-found');
    const html = renderToStaticMarkup(<AdminNotFound />);

    expect(html).toContain('href="/"');
    expect(html).not.toContain('href="/owner"');
    expect(html).toContain('返回首页');
  });
});
