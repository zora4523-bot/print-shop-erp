import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { usePathnameMock, useSearchParamsMock } = vi.hoisted(() => ({
  usePathnameMock: vi.fn<() => string>(),
  useSearchParamsMock: vi.fn<() => URLSearchParams>(),
}));

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
  usePathnameMock.mockReset().mockReturnValue('/owner/rules/customer-pricing');
  useSearchParamsMock
    .mockReset()
    .mockReturnValue(new URLSearchParams('section=blank'));
});

describe('rule center layout', () => {
  it('uses one content column and does not render a second workspace menu', () => {
    const html = renderToStaticMarkup(
      <RuleCenterLayout>
        <div>规则正文</div>
      </RuleCenterLayout>,
    );

    expect(html).toContain('规则正文');
    expect(html).toContain('aria-label="规则中心版本与发布"');
    expect(html).not.toContain('aria-label="规则配置工作区导航"');
    expect(html).not.toContain('md:grid-cols-[196px_minmax(0,1fr)]');
    expect(html).not.toContain('对客计价');
    expect(html).not.toContain('基础事实');
    expect(html).not.toContain('内部结算');
  });

  it('keeps the price command bar out of non-price rule pages', () => {
    usePathnameMock.mockReturnValue('/owner/rules/papers');
    useSearchParamsMock.mockReturnValue(new URLSearchParams());

    const html = renderToStaticMarkup(
      <RuleCenterLayout>
        <div>纸张规则正文</div>
      </RuleCenterLayout>,
    );

    expect(html).toContain('纸张规则正文');
    expect(html).not.toContain('aria-label="规则中心版本与发布"');
    expect(html).not.toContain('aria-label="规则配置工作区导航"');
  });
});
