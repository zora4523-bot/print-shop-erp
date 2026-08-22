import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  ExternalSalesQuoteSectionNav,
  resolveExternalSalesQuoteSection,
} from '../ExternalSalesQuoteSectionNav';

describe('ExternalSalesQuoteSectionNav', () => {
  it('keeps all admin price-book areas under one canonical route', () => {
    const html = renderToStaticMarkup(
      <ExternalSalesQuoteSectionNav
        activeSection="logistics"
        perspective="admin"
      />,
    );

    expect(html).toContain('aria-label="外部销售报价内容"');
    expect(html).toContain(
      'href="/owner/prices/external-sales/items?purpose=processing"',
    );
    expect(html).toContain(
      'href="/owner/prices/external-sales/items?purpose=logistics"',
    );
    expect(html).toContain(
      'href="/owner/prices/external-sales/versions"',
    );
    expect(html).toContain('版本与发布');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('min-h-11');
    expect(html).toContain('grid-cols-1');
  });

  it('shows sales only the two quote areas and no admin version area', () => {
    const html = renderToStaticMarkup(
      <ExternalSalesQuoteSectionNav
        activeSection="processing"
        perspective="sales"
      />,
    );

    expect(html).toContain('href="/sales/quote?section=processing"');
    expect(html).toContain('href="/sales/quote?section=logistics"');
    expect(html).not.toContain('section=versions');
  });

  it('fails unknown or disallowed sections closed to processing', () => {
    expect(
      resolveExternalSalesQuoteSection('versions', { allowVersions: false }),
    ).toBe('processing');
    expect(
      resolveExternalSalesQuoteSection('unknown', { allowVersions: true }),
    ).toBe('processing');
    expect(
      resolveExternalSalesQuoteSection(['logistics', 'processing'], {
        allowVersions: true,
      }),
    ).toBe('logistics');
  });
});
