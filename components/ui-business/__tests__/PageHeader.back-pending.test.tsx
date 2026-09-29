import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PageHeader } from '@/components/ui-business/PageHeader';
import { PendingLink } from '@/components/ui-business/PendingLink';
import {
  FormPendingScope,
  ScopedPageHeader,
} from '@/components/business/form/FormPendingScope';

const back = { href: '/owner/boms', label: '返回用料清单' };

function backTag(html: string) {
  return html.match(/<a[^>]*data-slot="page-header-back"[^>]*>/)?.[0] ?? '';
}

describe('PageHeader back pending', () => {
  it('locks the back link while pending, like PendingLink', () => {
    const tag = backTag(renderToStaticMarkup(<PageHeader title="新建" back={{ ...back, pending: true }} />));
    expect(tag).toContain('href="/owner/boms"');
    expect(tag).toContain('aria-disabled="true"');
    expect(tag).toContain('tabindex="-1"');
    expect(tag).toContain('pointer-events-none');
  });

  it('reuses PendingLink for the pending-aware back entry', () => {
    const header = PageHeader({ title: '新建', back: { ...back, pending: true } });
    const link = (header.props.children as React.ReactElement[])[1] as React.ReactElement<{ pending: boolean }>;
    expect(link.type).toBe(PendingLink);
    expect(link.props.pending).toBe(true);
  });

  it('leaves idle and pending-less back links navigable', () => {
    for (const b of [{ ...back, pending: false }, back]) {
      const tag = backTag(renderToStaticMarkup(<PageHeader title="新建" back={b} />));
      expect(tag).toContain('href="/owner/boms"');
      expect(tag).not.toContain('aria-disabled');
      expect(tag).not.toContain('tabindex');
    }
  });

  it('ScopedPageHeader renders an unlocked back link on the server (zero-JS safe)', () => {
    const tag = backTag(
      renderToStaticMarkup(
        <FormPendingScope>
          <ScopedPageHeader title="新建" back={back} />
        </FormPendingScope>,
      ),
    );
    expect(tag).toContain('href="/owner/boms"');
    expect(tag).not.toContain('aria-disabled');
  });
});
