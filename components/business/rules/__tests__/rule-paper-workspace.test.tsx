import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RulePaperWorkspace } from '@/components/business/rules/catalog/RulePaperWorkspace';
import { MaterialCategory } from '@/generated/prisma/enums';
import type { MaterialSummary } from '@/lib/material';

function paper(
  overrides: Partial<MaterialSummary> & Pick<MaterialSummary, 'id' | 'name'>,
): MaterialSummary {
  const { id, name, ...rest } = overrides;
  return {
    id,
    code: `PAPER-${id}`,
    name,
    category: MaterialCategory.PAPER,
    specification: null,
    unit: '张',
    searchPinyin: null,
    searchPinyinInitials: null,
    currentStock: 0,
    safetyStock: null,
    averageCost: null,
    isActive: true,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    ...rest,
  } as MaterialSummary;
}

describe('RulePaperWorkspace', () => {
  it('用真实纸张字段渲染紧凑主数据行，不再输出旧库存十列表', () => {
    const html = renderToStaticMarkup(
      <RulePaperWorkspace
        papers={[
          paper({
            id: 'pearl-160',
            code: 'PAPER-PEARL-160',
            name: '珠光艳闪（烫金!B13）',
            specification: '160g（纸张表!A4:C4）',
            currentStock: 13222 as never,
            safetyStock: 11111 as never,
          }),
          paper({
            id: 'touch-200',
            code: 'PAPER-TOUCH-200',
            name: '200g触感纸',
            isActive: false,
          }),
        ]}
        routeBase="/owner/rules/papers"
        query=""
        hiddenSearchParams={{ pageSize: 20 }}
        pagination={{
          page: 1,
          pageCount: 1,
          total: 2,
          pageSize: 20,
          queryParams: { page: 1, pageSize: 20 },
        }}
      />,
    );

    expect(html).toContain('纸张主数据');
    expect(html).toContain('珠光艳闪');
    expect(html).toContain('PAPER-PEARL-160');
    expect(html).toContain('160g');
    expect(html).toContain('13222 张');
    expect(html).toContain('11111 张');
    expect(html).toContain('建单可选');
    expect(html).toContain('停止新单选用');
    expect(html).toContain('未设置');
    expect(html).toContain('href="/owner/rules/papers/pearl-160"');
    expect(html).toContain('aria-label="编辑纸张：珠光艳闪"');
    expect(html).not.toContain('烫金!B13');
    expect(html).not.toContain('纸张表!A4:C4');
    expect(html).not.toContain('<table');
    expect(html).not.toContain('参考平均成本');
  });

  it('保留真实搜索条件和服务端分页链接', () => {
    const html = renderToStaticMarkup(
      <RulePaperWorkspace
        papers={[
          paper({ id: 'pearl-120', name: '120g珠光艳闪' }),
        ]}
        routeBase="/owner/rules/papers"
        query="珠光"
        hiddenSearchParams={{ pageSize: 20, sort: 'name', dir: 'asc' }}
        pagination={{
          page: 2,
          pageCount: 3,
          total: 42,
          pageSize: 20,
          queryParams: {
            q: '珠光',
            page: 2,
            pageSize: 20,
            sort: 'name',
            dir: 'asc',
          },
        }}
      />,
    );

    expect(html).toContain('role="search"');
    expect(html).toContain('action="/owner/rules/papers"');
    expect(html).toContain('name="q"');
    expect(html).toContain('value="珠光"');
    expect(html).toContain('name="pageSize" value="20"');
    expect(html).toContain('name="sort" value="name"');
    expect(html).toContain('共 42 条');
    expect(html).toContain('第 2 / 3 页');
    expect(html).toContain('page=1');
    expect(html).toContain('page=3');
    expect(html).toContain('清除搜索');
  });
});
