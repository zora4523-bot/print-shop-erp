import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requirePermissionMock } = vi.hoisted(() => ({
  requirePermissionMock: vi.fn(),
}));

vi.mock('@/lib/auth/permissions', () => ({
  requirePermission: requirePermissionMock,
}));

import RuleCenterPage from '@/app/(admin)/owner/rules/page';

beforeEach(() => {
  requirePermissionMock.mockReset().mockResolvedValue({ id: 'admin-1' });
});

describe('rule center entry', () => {
  it('checks price-management permission before rendering the overview', async () => {
    const html = renderToStaticMarkup(await RuleCenterPage());

    expect(requirePermissionMock).toHaveBeenCalledOnce();
    expect(requirePermissionMock).toHaveBeenCalledWith('dict:price:manage');
    expect(html).toContain('规则配置中心');
  });

  it('groups current rule domains without exposing retired internal pricing', async () => {
    const html = renderToStaticMarkup(await RuleCenterPage());

    expect(html).toContain('客户计价规则');
    expect(html).toContain('建单主数据');
    expect(html).toContain('员工薪酬规则');
    expect(html).not.toContain('可建单产品组合');
    expect(html).toContain('href="/owner/rules/customer-pricing?section=blank"');
    expect(html).not.toContain('href="/owner/rules/stock-skus"');
    expect(html).toContain('href="/owner/rules/employee-pay"');
    expect(html).not.toContain('内部计价');
    expect(html).not.toContain('/owner/rules/internal-pricing');
  });

  it('links to the implemented piecework editor', async () => {
    const html = renderToStaticMarkup(await RuleCenterPage());

    expect(html).toContain('维护计件工价、标准工时与加班起点');
    expect(html.match(/href="\/owner\/rules\/employee-pay"/g)).toHaveLength(1);
    expect(html).not.toContain('不在这里配置');
    expect(html).not.toContain('未开放配置');
    expect(html).not.toContain('piecework-rules');
  });
});
