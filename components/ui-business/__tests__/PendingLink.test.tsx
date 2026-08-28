import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { PendingLink } from '@/components/ui-business/PendingLink';
import { RULE_CENTER_HREFS } from '@/lib/navigation/rule-center';

const newStockSkuHref = `${RULE_CENTER_HREFS.stockSkus}/new`;

describe('PendingLink', () => {
  it('keeps its href but removes pending navigation from the tab order', () => {
    const html = renderToStaticMarkup(
      <PendingLink href={newStockSkuHref} pending className="custom-link">
        新建产品
      </PendingLink>,
    );

    expect(html).toContain(`href="${newStockSkuHref}"`);
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain('pointer-events-none');
    expect(html).toContain('cursor-not-allowed');
    expect(html).toContain('opacity-50');
    expect(html).toContain('custom-link');
  });

  it('prevents both click and client navigation while pending', () => {
    const link = PendingLink({ href: newStockSkuHref, pending: true });
    const clickPreventDefault = vi.fn();
    const navigatePreventDefault = vi.fn();

    link.props.onClick({ preventDefault: clickPreventDefault });
    link.props.onNavigate({ preventDefault: navigatePreventDefault });

    expect(clickPreventDefault).toHaveBeenCalledOnce();
    expect(navigatePreventDefault).toHaveBeenCalledOnce();
  });

  it('leaves an idle link as an ordinary navigable link', () => {
    const html = renderToStaticMarkup(
      <PendingLink href={newStockSkuHref} pending={false}>
        新建产品
      </PendingLink>,
    );

    expect(html).toContain(`href="${newStockSkuHref}"`);
    expect(html).not.toContain('aria-disabled');
    expect(html).not.toContain('tabindex');
    expect(html).not.toContain('pointer-events-none');
    expect(html).not.toContain('cursor-not-allowed');
    expect(html).not.toContain('opacity-50');

    const link = PendingLink({ href: newStockSkuHref, pending: false });
    expect(link.props.onClick).toBeUndefined();
    expect(link.props.onNavigate).toBeUndefined();
  });
});
