import { Role } from '@/generated/prisma/enums';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { usePathnameMock, useSearchParamsMock, requireSessionMock } = vi.hoisted(() => ({
  requireSessionMock: vi.fn(),
  usePathnameMock: vi.fn<() => string>(),
  useSearchParamsMock: vi.fn<() => URLSearchParams>(),
}));

vi.mock('@/lib/auth/session', () => ({ requireSession: requireSessionMock }));

vi.mock('next/navigation', () => ({
  usePathname: usePathnameMock,
  useSearchParams: useSearchParamsMock,
}));

vi.mock('@/components/business/rules/RuleCenterPriceWorkspaceData', () => ({
  getRuleCenterPriceVersionSummary: vi.fn().mockResolvedValue({
    state: 'hidden',
    streams: [],
  }),
}));

import RuleCenterLayout from '@/app/(admin)/owner/rules/layout';

beforeEach(() => {
  requireSessionMock.mockReset().mockResolvedValue({ user: { role: Role.ADMIN } });
  usePathnameMock.mockReset().mockReturnValue('/owner/rules/customer-pricing');
  useSearchParamsMock
    .mockReset()
    .mockReturnValue(new URLSearchParams('section=blank'));
});

describe('rule center layout', () => {
  it('omits unauthorized directory entries and propagates session failures', async () => {
    requireSessionMock.mockResolvedValue({ user: { role: Role.SALES } });
    const html = renderToStaticMarkup(await RuleCenterLayout({ children: <div>正文</div> }));
    expect(html).not.toContain('aria-label="规则模块导航"');
    requireSessionMock.mockRejectedValue(new Error('unauthorized'));
    await expect(RuleCenterLayout({ children: null })).rejects.toThrow('unauthorized');
  });
  it('uses the existing overview instead of a duplicate directory at the root', async () => {
    usePathnameMock.mockReturnValue('/owner/rules');
    const html = renderToStaticMarkup(await RuleCenterLayout({ children: <div>总览</div> }));
    expect(html).not.toContain('aria-label="规则模块导航"');
  });
  it('keeps one content column with a collapsed authorized module directory', async () => {
    const html = renderToStaticMarkup(
      await RuleCenterLayout({ children: <div>规则正文</div> }),
    );

    expect(html).toContain('规则正文');
    expect(html).toContain('aria-label="规则中心版本与发布"');
    expect(html).not.toContain('aria-label="规则配置工作区导航"');
    expect(html).not.toContain('md:grid-cols-[196px_minmax(0,1fr)]');
    expect(html).toContain('aria-label="规则模块导航"');
    expect(html).toContain('客户计价规则');
    expect(html).toContain('建单主数据');
    expect(html).toContain('员工薪酬规则');
    expect(html).not.toMatch(/<details[^>]*\sopen/);
  });

  it('keeps the price command bar out of non-price rule pages', async () => {
    usePathnameMock.mockReturnValue('/owner/rules/papers');
    useSearchParamsMock.mockReturnValue(new URLSearchParams());

    const html = renderToStaticMarkup(
      await RuleCenterLayout({ children: <div>纸张规则正文</div> }),
    );

    expect(html).toContain('纸张规则正文');
    expect(html).not.toContain('aria-label="规则中心版本与发布"');
    expect(html).not.toContain('aria-label="规则配置工作区导航"');
  });
});
