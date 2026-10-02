import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { AdminPagination } from '../AdminDataTable';

it('retains the CDR target and filters on both pagination directions', () => {
  const html = renderToStaticMarkup(<AdminPagination basePath="/owner" anchor="cdr-download" page={2} pageCount={3} total={250} pageSize={100} pageParam="cdrPage" queryParams={{ cdrQ: '测试' }} />);
  const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map(match => new URL(match[1].replaceAll('&amp;', '&'), 'http://localhost'));
  expect(hrefs).toHaveLength(2);
  expect(hrefs.map(url => url.searchParams.get('cdrPage'))).toEqual(['1', '3']);
  for (const href of hrefs) { expect(href.hash).toBe('#cdr-download'); expect(href.searchParams.get('cdrQ')).toBe('测试'); }
});
