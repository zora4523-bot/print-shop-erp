import { readFileSync } from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { Button } from '@/components/ui/button';
import {
  ExternalSalesChargeWorkspace,
  externalSalesChargeListHref,
  type ExternalSalesChargeWorkspaceProps,
} from '../ExternalSalesChargeWorkspace';

const { pushMock, replaceMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  replaceMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: pushMock,
    replace: replaceMock,
  }),
}));

function props(
  overrides: Partial<ExternalSalesChargeWorkspaceProps> = {},
): ExternalSalesChargeWorkspaceProps {
  return {
    purpose: 'processing',
    purposeHrefs: {
      processing: '/owner/prices/external-sales/items?purpose=processing',
      logistics: '/owner/prices/external-sales/items?purpose=logistics',
    },
    searchAction: '/owner/prices/external-sales/items',
    hiddenSearchFields: { purpose: 'processing' },
    filters: {
      query: '',
      category: '',
      subject: '',
      kind: '',
      calculation: '',
      quantity: '',
      automation: '',
      status: '',
      changedOnly: false,
    },
    filterOptions: {
      categories: [
        { value: 'foil', label: '烫金加工', count: 18 },
        { value: 'print', label: '彩印加工', count: 12 },
      ],
      subjects: [{ value: 'red-packet', label: '红包', count: 24 }],
      calculations: [{ value: 'fixed', label: '整批固定金额' }],
    },
    clearFiltersHref:
      '/owner/prices/external-sales/items?purpose=processing',
    items: [
      {
        id: 'item-1',
        name: '中号专版双面烫金',
        categoryLabel: '烫金加工',
        subjectLabel: '中号红包',
        quantityLabel: '500–1,000 个',
        calculationLabel: '按个',
        currentAmountLabel: '¥0.48 / 个',
        draftAmountLabel: '¥0.52 / 个',
        priceChangeLabel: '+¥0.04 / 个',
        changeSummaryLabels: [
          '数量范围：500–1,000 个 → 501–1,000 个',
        ],
        automation: 'AUTO',
        status: 'ACTIVE',
        changed: true,
        detailHref:
          '/owner/prices/external-sales/items?purpose=processing&item=item-1#selected-charge-detail',
      },
      {
        id: 'item-2',
        name: '非标尺寸加工',
        categoryLabel: '特殊加工',
        subjectLabel: '通用',
        quantityLabel: '不限数量',
        calculationLabel: '人工报价',
        currentAmountLabel: '待确认',
        draftAmountLabel: null,
        automation: 'MANUAL',
        status: 'INACTIVE',
        changed: false,
        detailHref:
          '/owner/prices/external-sales/items?purpose=processing&item=item-2#selected-charge-detail',
      },
    ],
    selectedItemId: 'item-1',
    selectedEditor: (
      <form aria-label="编辑中号专版双面烫金">
        <Button type="submit">保存修改</Button>
      </form>
    ),
    draft: {
      version: 4,
      changeReason: '原材料与人工成本调整',
      changedCount: 3,
      lastSavedLabel: '2026/08/11 09:30',
      compareHref: '/owner/prices/external-sales/versions?changed=1',
      publishHref: '/owner/prices/external-sales/versions?publish=1',
    },
    pagination: {
      page: 2,
      pageCount: 5,
      total: 121,
      previousHref:
        '/owner/prices/external-sales/items?purpose=processing&page=1',
      nextHref:
        '/owner/prices/external-sales/items?purpose=processing&page=3',
    },
    ...overrides,
  };
}

describe('ExternalSalesChargeWorkspace', () => {
  it('renders the daily pricing workflow in business language', () => {
    const html = renderToStaticMarkup(<ExternalSalesChargeWorkspace {...props()} />);

    expect(html).toContain('aria-label="外部销售收费类型"');
    expect(html).toContain('加工费');
    expect(html).toContain('快递与打包耗材');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('调价草稿');
    expect(html).toContain('本轮调价 · 第 4 版');
    expect(html).toContain('3 项已写入草稿');
    expect(html).toContain('当前价区间');
    expect(html).toContain('¥0.48 / 个');
    expect(html).toContain('调整进度');
    expect(html).toContain('1/1 档已调整');
    expect(html).toContain('待补全');
    expect(html).toContain('其他业务变更');
    expect(html).toContain(
      '数量范围：500–1,000 个 → 501–1,000 个',
    );
    expect(html).toContain('第 2 / 5 页，共 121 项');
    expect(html).toContain('保存修改');
    expect(html).not.toContain('正在编辑调价草稿');
    expect(html).toContain('admin-sticky-below-header sticky z-[5]');
  });

  it('uses different read-only copy when the selected item is outside the current draft', () => {
    const html = renderToStaticMarkup(
      <ExternalSalesChargeWorkspace
        {...props({
          selectedEditor: undefined,
        })}
      />,
    );

    expect(html).toContain('该项目不在当前调价草稿内，只能查看生效价');
    expect(html).not.toContain('当前为生效价，发起调价后才能改');
  });

  it('keeps optional filters collapsed until a manager uses them', () => {
    const collapsedHtml = renderToStaticMarkup(
      <ExternalSalesChargeWorkspace
        {...props({
          draft: null,
          selectedEditor: undefined,
          createDraftHref: '/owner/prices/external-sales/versions?create=1',
          pagination: {
            page: 1,
            pageCount: 1,
            total: 2,
          },
        })}
      />,
    );

    expect(collapsedHtml).toMatch(/<details\b(?![^>]*\bopen(?:=|\s|>))[^>]*>/);
    expect(collapsedHtml).toContain('（使用时展开）');
    expect(collapsedHtml).toContain('当前生效');
    expect(collapsedHtml).toContain('当前价格正在用于工单计价');
    expect(collapsedHtml).toContain('发起调价');
    expect(collapsedHtml).toContain('当前为生效价，发起调价后才能改');
    expect(collapsedHtml).not.toContain('该项目不在当前调价草稿内，只能查看生效价');
    expect(collapsedHtml).not.toContain('上一页');

    const filteredHtml = renderToStaticMarkup(
      <ExternalSalesChargeWorkspace
        {...props({
          filters: {
            ...props().filters,
            category: 'foil',
            kind: 'ADD_ON',
            automation: 'AUTO',
            changedOnly: true,
          },
        })}
      />,
    );

    expect(filteredHtml).toMatch(/<details\b[^>]*\bopen=""/);
    expect(filteredHtml).toContain('4 项已选');
    expect(filteredHtml).toContain('value="foil" selected=""');
    expect(filteredHtml).toContain('value="AUTO" selected=""');
    expect(filteredHtml).toContain('value="ADD_ON" selected=""');
    expect(filteredHtml).toContain('checked=""');
    expect(filteredHtml).toContain('打开更多筛选，已启用 4 项');
    expect(filteredHtml).toContain('aria-label="已启用的收费项目筛选"');
    expect(filteredHtml).toContain('类目：烫金加工');
    expect(filteredHtml).toContain('类型：附加费');
    expect(filteredHtml).toContain('处理：自动计价');
    expect(filteredHtml).toContain('只看本次修改');
    expect(filteredHtml).toContain(
      'aria-label="清除筛选：类目：烫金加工"',
    );
    expect(filteredHtml).toContain(
      'href="/owner/prices/external-sales/items?purpose=processing&amp;kind=ADD_ON&amp;automation=AUTO&amp;changed=1"',
    );
  });

  it('uses the shared bottom sheet contract for mobile advanced filters', () => {
    const source = readFileSync(
      path.join(
        process.cwd(),
        'components',
        'business',
        'price',
        'ExternalSalesChargeWorkspace.tsx',
      ),
      'utf8',
    );

    expect(source).toContain('<SheetContent');
    expect(source).toContain('side="bottom"');
    expect(source).toContain('max-h-[80dvh]');
    expect(source).toContain('overflow-y-auto overscroll-contain');
    expect(source).toContain('env(safe-area-inset-bottom,0px)');
    expect(source).toContain('className="group hidden');
  });

  it('uses responsive, keyboard-accessible controls without exposing implementation data', () => {
    const html = renderToStaticMarkup(<ExternalSalesChargeWorkspace {...props()} />);

    expect(html).toContain('role="search"');
    expect(html).toContain('aria-label="查找加工费收费项目"');
    expect(html).toContain('aria-label="收费项目分页"');
    expect(html).toContain('aria-label="正在编辑：中号专版双面烫金"');
    expect(html).toContain('aria-label="编辑收费项目：非标尺寸加工"');
    expect(html).toContain('返回收费项目列表');
    expect(html).toContain('min-h-11');
    expect(html).toContain('grid-cols-1');
    expect(html).toContain('xl:grid-cols-[minmax(0,1fr)_minmax(30rem,31.25rem)]');
    expect(html).toContain('id="selected-charge-detail"');
    expect(html).toContain('#selected-charge-detail');
    expect(html).toContain('xl:order-1');
    expect(html).toContain('xl:order-2');
    expect(html).toContain('max-xl:hidden');
    expect(html).toContain(
      'xl:max-h-[calc(100dvh_-_var(--admin-header-offset)_-_1rem)]',
    );
    expect(html).toContain('xl:overflow-y-auto');
    expect(html).toContain('admin-sticky-below-header');
    expect(html).toContain('admin-scroll-target');
    expect(html).toContain(
      'href="/owner/prices/external-sales/items?purpose=processing#external-charge-list"',
    );
    expect(html.indexOf('id="selected-charge-detail"')).toBeLessThan(
      html.indexOf('id="external-charge-list"'),
    );
    expect(html).toContain('admin-wrap-anywhere');
    expect(html).not.toContain('RULE-CODE');
    expect(html).not.toContain('triggerCondition');
    expect(html).not.toContain('JSON');
    expect(html).not.toContain('SHA-256');
    expect(html).not.toContain('A18:B20');
    expect(html).not.toContain('来源报价表');
  });

  it('separates read-only viewing from draft editing', () => {
    const readOnlyHtml = renderToStaticMarkup(
      <ExternalSalesChargeWorkspace
        {...props({
          draft: null,
          selectedEditor: undefined,
          createDraftHref: '/owner/prices/external-sales/items?start=1',
          pagination: {
            page: 1,
            pageCount: 1,
            total: 2,
          },
        })}
      />,
    );

    expect(readOnlyHtml).toContain('aria-label="正在查看：中号专版双面烫金"');
    expect(readOnlyHtml).toContain('aria-label="查看详情：非标尺寸加工"');
    expect(readOnlyHtml).toContain('当前为生效价，发起调价后才能改');
    expect(readOnlyHtml).not.toContain('查看 / 编辑');
    expect(readOnlyHtml).not.toContain('编辑收费项目：非标尺寸加工');
  });

  it('groups the current server page into compact business sections', () => {
    const baseItems = props().items;
    const groupedHtml = renderToStaticMarkup(
      <ExternalSalesChargeWorkspace
        {...props({
          items: [
            baseItems[0],
            {
              ...baseItems[0],
              id: 'item-1b',
              name: '中号专版单面烫金',
              quantityLabel: '1,001–2,000 个',
              detailHref:
                '/owner/prices/external-sales/items?purpose=processing&item=item-1b#selected-charge-detail',
            },
            baseItems[1],
          ],
          pagination: {
            page: 1,
            pageCount: 1,
            total: 3,
          },
        })}
      />,
    );

    expect(groupedHtml).toContain('id="external-charge-group-0"');
    expect(groupedHtml).toContain('id="external-charge-group-1"');
    expect(groupedHtml).toContain('中号红包');
    expect(groupedHtml).toContain('烫金加工');
    expect(groupedHtml).toContain('2 项');
    expect(groupedHtml).toContain('档数');
    expect(groupedHtml).toContain('当前价区间');
    expect(groupedHtml).toContain('调整进度');
    expect(groupedHtml).toContain('待补全');
  });

  it('shows one product row with a range summary instead of repeated quantity-price pills', () => {
    const tieredHtml = renderToStaticMarkup(
      <ExternalSalesChargeWorkspace
        {...props({
          draft: null,
          selectedItemId: undefined,
          selectedEditor: undefined,
          items: [
            {
              ...props().items[0],
              id: 'color-157-large',
              name: '彩印 · 大号',
              subjectLabel: '157克双铜纸',
              quantityLabel: '7 个数量档 · 1,000–20,000 个',
              currentAmountLabel: '¥295–¥2,300',
              draftAmountLabel: null,
              changed: false,
              changeSummaryLabels: [],
              priceTiers: [
                ['1,000 个', '¥295'],
                ['2,000 个', '¥420'],
                ['3,000 个', '¥530'],
                ['4,000 个', '¥680'],
                ['5,000 个', '¥800'],
                ['10,000 个', '¥1,400'],
                ['20,000 个', '¥2,300'],
              ].map(([quantityLabel, currentAmountLabel]) => ({
                quantityLabel: quantityLabel!,
                currentAmountLabel: currentAmountLabel!,
                changed: false,
              })),
            },
          ],
          pagination: { page: 1, pageCount: 1, total: 1 },
        })}
      />,
    );

    expect(tieredHtml).toContain('157克双铜纸');
    expect(tieredHtml).toContain('彩印 · 大号');
    expect(tieredHtml).not.toContain('aria-label="彩印 · 大号数量价格阶梯"');
    expect(tieredHtml).not.toContain('>1,000 个<');
    expect(tieredHtml).not.toContain('>20,000 个<');
    expect(tieredHtml).toContain('7 档');
    expect(tieredHtml).toContain('¥295–¥2,300');
    expect(tieredHtml).toContain('未发起调整');
    expect(tieredHtml).not.toContain('157克双铜纸彩印 大号 1000');
    expect(tieredHtml).not.toContain('数量范围');
  });

  it('builds a mobile return URL without keeping the selected item', () => {
    expect(
      externalSalesChargeListHref(
        '/owner/prices/external-sales/items?purpose=processing&item=item-1&page=2#selected-charge-detail',
      ),
    ).toBe(
      '/owner/prices/external-sales/items?purpose=processing&page=2#external-charge-list',
    );
    expect(externalSalesChargeListHref('#selected-charge-detail')).toBe(
      '#external-charge-list',
    );
  });

  it('在列表汇总待补全档位，不展开重复价格胶囊', () => {
    const item = props().items[0];
    const html = renderToStaticMarkup(
      <ExternalSalesChargeWorkspace
        {...props({
          selectedItemId: undefined,
          selectedEditor: undefined,
          items: [
            {
              ...item,
              currentAmountLabel: '2 档 · ¥100–¥200',
              priceTiers: [
                {
                  quantityLabel: '1,000 个',
                  currentAmountLabel: '¥100',
                  draftAmountLabel: '¥105',
                  changed: true,
                },
                {
                  quantityLabel: '2,000 个',
                  currentAmountLabel: '¥200',
                  draftAmountLabel: '待人工确认',
                  changed: false,
                },
              ],
            },
          ],
          pagination: { page: 1, pageCount: 1, total: 1 },
        })}
      />,
    );

    expect(html).toContain('¥100–¥200');
    expect(html).toContain('1/2 档已调整');
    expect(html).toContain('待补全 1 档');
    expect(html).not.toContain('>1,000 个<');
    expect(html).not.toContain('>2,000 个<');
  });

  it('shows a useful empty state and keeps the selected detail optional', () => {
    const html = renderToStaticMarkup(
      <ExternalSalesChargeWorkspace
        {...props({
          items: [],
          selectedItemId: undefined,
          selectedEditor: undefined,
          pagination: {
            page: 1,
            pageCount: 1,
            total: 0,
          },
        })}
      />,
    );

    expect(html).toContain('还没有收费项目');
    expect(html).toContain('选择一个收费项目');
    expect(html).toContain('筛选结果 0 项');
  });

  it('does not offer a doomed draft action while a version is scheduled', () => {
    const html = renderToStaticMarkup(
      <ExternalSalesChargeWorkspace
        {...props({
          workspaceStatus: 'SCHEDULED',
          draft: null,
          selectedEditor: undefined,
          createDraftHref: undefined,
          createDraftBlockedReason:
            '第 3 版已安排计划生效；生效前不能再发起新调价。',
        })}
      />,
    );

    expect(html).toContain('等待生效');
    expect(html).toContain('已有一轮价格等待生效');
    expect(html).toContain('生效前不能再发起新调价');
    expect(html).not.toContain('当前生效');
    expect(html).not.toContain('>发起调价</a>');
  });

  it('does not claim a current price when no usable version exists', () => {
    const html = renderToStaticMarkup(
      <ExternalSalesChargeWorkspace
        {...props({
          workspaceStatus: 'UNAVAILABLE',
          draft: null,
          items: [],
          selectedItemId: undefined,
          selectedEditor: undefined,
          createDraftHref: undefined,
          createDraftBlockedReason: '当前没有可复制的生效价格版本',
          pagination: { page: 1, pageCount: 0, total: 0 },
        })}
      />,
    );

    expect(html).toContain('暂无生效价');
    expect(html).toContain('当前没有可用的收费价格');
    expect(html).not.toContain('当前生效');
    expect(html).not.toContain('已有一轮价格等待生效');
  });
});
