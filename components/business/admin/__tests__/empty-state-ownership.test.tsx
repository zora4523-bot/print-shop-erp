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
    // 空时保留表头（ui 审查 #44：不再返回 null 留下空壳），空态仍只由 AdminTableCard 负责。
    for (const html of [
      renderToStaticMarkup(<ProductsTable products={[]} />),
      renderToStaticMarkup(<CraftsTable crafts={[]} />),
      renderToStaticMarkup(<BomsTable boms={[]} categoryLabelById={{}} />),
    ]) {
      expect(html).toContain('<thead');
      expect(html).not.toMatch(/<tbody[^>]*>[\s\S]*<tr/);
      expect(html).not.toContain('data-slot="empty-state"');
    }
  });

  it('keeps a standalone owner for the unpaginated account list', () => {
    const html = renderToStaticMarkup(<AccountsTable accounts={[]} />);
    expect(html.match(/data-slot="empty-state"/g)).toHaveLength(1);
    expect(html).toContain('data-kind="no-data"');
    expect(html).toContain('暂无账号');
  });
});
