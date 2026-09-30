import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { OrderListQuery } from '@/lib/order/list-query';
import { SalesOrderListFilters } from '../SalesOrderListFilters';

describe('SalesOrderListFilters', () => {
  it('renders the seven sales views, scoped search and business summary', () => {
    const query = salesQuery({ q: '福明', view: 'todo' });
    const html = renderToStaticMarkup(
      <SalesOrderListFilters
        query={query}
        summary={{
          all: 18,
          todo: 3,
          doing: 8,
          shipped: 2,
          done: 4,
          cancelled: 0,
          draft: 1,
          shippedThisMonth: 6,
        }}
        issues={[]}
      />,
    );

    expect(html).toContain('data-slot="sales-order-list-filters"');
    for (const label of [
      '全部',
      '需关注',
      '进行中',
      '已发货',
      '已结算',
      '已取消',
      '草稿',
    ]) {
      expect(html).toContain(label);
    }
    expect(html).toContain('3 单需关注 · 本月已发 6 单');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('name="q"');
    expect(html).toContain('aria-label="搜索工单名或工单号"');
    expect(html).toContain('placeholder="搜工单名 / 单号"');
    expect(html).not.toContain('客户');
    expect(html).toContain('value="福明"');
    expect(html).toContain('name="view" value="todo"');
    // 清除入口统一「清除筛选」，并指向同一张搜索表单（§8.2）。
    expect(html).toContain('id="sales-order-filters"');
    expect(html).toContain('>清除筛选');
    expect(html).toContain('href="/orders?view=todo"');
    expect(html).not.toContain('清除搜索');
    expect(html).not.toContain('rounded-full px-4');
    expect(html).not.toContain('全部师傅');
    expect(html).not.toContain('导出工单');
  });

  it('announces rejected URL values without rendering administrator controls', () => {
    const html = renderToStaticMarkup(
      <SalesOrderListFilters
        query={salesQuery()}
        summary={{
          all: 0,
          todo: 0,
          doing: 0,
          shipped: 0,
          done: 0,
          cancelled: 0,
          draft: 0,
          shippedThisMonth: 0,
        }}
        issues={['保存视图不合法']}
      />,
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain('保存视图不合法');
    expect(html).not.toContain('高级筛选');
  });
});

function salesQuery(
  input: { q?: string; view?: OrderListQuery['view'] } = {},
): OrderListQuery {
  return {
    filters: { q: input.q } as OrderListQuery['filters'],
    page: 1,
    pageSize: 20,
    sort: 'createdAt',
    dir: 'desc',
    view: input.view,
  };
}
