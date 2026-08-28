import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

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

import { RuleCenterPageHeader } from '@/components/business/rules/RuleCenterPageHeader';
import { RuleCenterWorkspaceBar } from '@/components/business/rules/RuleCenterWorkspaceBar';
import {
  RULE_CENTER_DEFAULT_HREF,
  RULE_CENTER_HREFS,
} from '@/lib/navigation/rule-center';

function visibleText(html: string): string {
  return html.replace(/<[^>]*>/g, '');
}

describe('rule center workspace UI', () => {
  it('opens the first concrete price editor without a second workspace menu', () => {
    expect(RULE_CENTER_DEFAULT_HREF).toBe(
      '/owner/rules/customer-pricing?section=blank',
    );
  });

  it('renders the page title and effective mode without explanatory grouping', () => {
    const html = renderToStaticMarkup(
      <RuleCenterPageHeader
        title="纸张"
        effect="immediate"
        subtitle="维护建单可选纸张。"
      />,
    );

    expect(html).toContain('<h1');
    expect(html).toContain('纸张');
    expect(html).not.toContain('基础事实');
    expect(html).not.toContain('对客计价');
    expect(html).not.toContain('内部结算');
    expect(html).toContain('保存后即时生效');
    expect(html).toContain('维护建单可选纸张。');
  });

  it('renders separate processing and logistics version streams safely', () => {
    usePathnameMock.mockReturnValue(RULE_CENTER_HREFS.customerPricing);
    useSearchParamsMock.mockReturnValue(new URLSearchParams('section=blank'));

    const html = renderToStaticMarkup(
      <RuleCenterWorkspaceBar
        priceVersionSummary={{
          state: 'ready',
          streams: [
            {
              key: 'processing',
              label: '加工费',
              currentVersion: 3,
              draftVersion: 4,
              draftId: 'processing-draft',
              scheduledVersion: null,
            },
            {
              key: 'logistics',
              label: '物流费',
              currentVersion: 6,
              draftVersion: null,
              draftId: null,
              scheduledVersion: 7,
            },
          ],
        }}
      />,
    );

    expect(visibleText(html)).toContain('规则配置中心/ 空白封单价');
    expect(visibleText(html)).toContain('加工费当前 v3草稿 v4');
    expect(visibleText(html)).toContain('物流费当前 v6计划 v7');
    expect(html).toContain('aria-label="规则中心版本与发布"');
    expect(html).toContain('aria-label="审阅价格版本变更"');
    expect(html).toContain('aria-label="进入价格版本发布"');
    expect(html).toContain('draft=processing-draft');
    expect(visibleText(html)).not.toContain('当前生效 v3');
  });
});
