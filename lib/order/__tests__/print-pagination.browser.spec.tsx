import { afterEach, describe, expect, it } from 'vitest';
import { paginatePrintDocument } from '../print-pagination';

let host: HTMLElement | undefined;
afterEach(() => {
  host?.remove();
  delete document.documentElement.dataset.printPagination;
});

describe('print pagination preserves detail rows with totals', () => {
  it.each([10, 30])('keeps all %i rows in order and the total after a nonempty final table', (count) => {
    host = document.createElement('main');
    host.className = 'work-order-document';
    host.innerHTML = `<style>
      .pagination-test { width: 210mm; }
      .pagination-test .hd, .pagination-test .ft { height: 100px; }
      .pagination-test table { border-collapse: collapse; width: 100%; }
      .pagination-test td { padding: 0; border: 0; }
      .pagination-test tbody td { height: 80px; }
      .pagination-test tfoot td { height: 150px; }
    </style><section class="sheet pagination-test"><header class="hd"></header>
      <section class="sec"><table><tbody>${Array.from({ length: count }, (_, i) => `<tr><td>款式 ${i + 1}</td></tr>`).join('')}</tbody><tfoot><tr><td>合计</td></tr></tfoot></table></section>
      <footer class="ft"><span></span></footer></section>`;
    document.body.append(host);
    expect(paginatePrintDocument(document)).toBe(true);
    expect([...host.querySelectorAll('tbody tr')].map((row) => row.textContent)).toEqual(
      Array.from({ length: count }, (_, i) => `款式 ${i + 1}`),
    );
    expect(host.querySelectorAll('tfoot')).toHaveLength(1);
    for (const body of host.querySelectorAll('tbody')) expect(body.rows.length).toBeGreaterThan(0);
    const tables = host.querySelectorAll('table');
    expect(tables[tables.length - 1].tFoot?.textContent).toBe('合计');
    const pageCount = host.querySelectorAll('.sheet').length;
    expect(pageCount).toBeGreaterThan(1);
    expect(paginatePrintDocument(document)).toBe(true);
    expect(host.querySelectorAll('.sheet')).toHaveLength(pageCount);
  });
});
