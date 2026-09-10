import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AccountsTable } from '@/components/business/account/AccountsTable';
import { BomsTable } from '@/components/business/bom/BomsTable';
import { CraftsTable } from '@/components/business/craft/CraftsTable';
import { ProductsTable } from '@/components/business/product/ProductsTable';
import { AdminTableCard } from '../AdminDataTable';

describe('list empty-state ownership', () => {
  it('lets the paginated table card own exactly one empty state', () => {
    const html = renderToStaticMarkup(
      <AdminTableCard
        isEmpty
        emptyTitle="没有符合条件的产品"
        emptyDescription="请清除搜索条件"
      >
        {null}
      </AdminTableCard>,
    );

    expect(html.match(/data-slot="empty-state"/g)).toHaveLength(1);
    expect(html).toContain('没有符合条件的产品');
    expect(html).toContain('请清除搜索条件');
  });

  it('does not let paginated table bodies create a second empty state', () => {
    expect(renderToStaticMarkup(<ProductsTable products={[]} />)).toBe('');
    expect(renderToStaticMarkup(<CraftsTable crafts={[]} />)).toBe('');
    expect(
      renderToStaticMarkup(<BomsTable boms={[]} categoryLabelById={{}} />),
    ).toBe('');
  });

  it('keeps a standalone owner for the unpaginated account list', () => {
    const html = renderToStaticMarkup(<AccountsTable accounts={[]} />);
    expect(html.match(/data-slot="empty-state"/g)).toHaveLength(1);
    expect(html).toContain('data-kind="no-data"');
    expect(html).toContain('暂无账号');
  });
});
