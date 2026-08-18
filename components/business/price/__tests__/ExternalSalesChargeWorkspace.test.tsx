import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Button } from '@/components/ui/button';
import {
  ExternalSalesChargeWorkspace,
  type ExternalSalesChargeWorkspaceProps,
} from '../ExternalSalesChargeWorkspace';

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
    expect(html).toContain('3 项已修改');
    expect(html).toContain('当前价');
    expect(html).toContain('¥0.48 / 个');
    expect(html).toContain('草稿价');
    expect(html).toContain('¥0.52 / 个');
    expect(html).toContain('+¥0.04 / 个');
    expect(html).toContain('其他业务变更');
    expect(html).toContain(
      '数量范围：500–1,000 个 → 501–1,000 个',
    );
    expect(html).toContain('自动计价');
    expect(html).toContain('需人工确认');
    expect(html).toContain('已启用');
    expect(html).toContain('已停用');
    expect(html).toContain('第 2 / 5 页，共 121 项');
    expect(html).toContain('保存修改');
    expect(html).not.toContain('正在编辑调价草稿');
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
    expect(collapsedHtml).toContain('暂无草稿');
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
    expect(html).toContain('xl:grid-cols-[minmax(0,1.45fr)_minmax(20rem,0.8fr)]');
    expect(html).toContain('id="selected-charge-detail"');
    expect(html).toContain('#selected-charge-detail');
    expect(html).not.toContain('order-1');
    expect(html).not.toContain('order-2');
    expect(html).toContain('xl:max-h-[calc(100dvh-2rem)]');
    expect(html).toContain('xl:overflow-y-auto');
    expect(html).not.toContain('xl:sticky');
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
    expect(readOnlyHtml).toContain('当前价格仅供查看');
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
    expect(groupedHtml).toContain('数量范围');
    expect(groupedHtml).toContain('计价方式');
    expect(groupedHtml).toContain('当前价');
    expect(groupedHtml).toContain('草稿价');
    expect(groupedHtml).toContain('价格变化');
  });

  it('shows one product row with compact quantity-price anchors instead of repeated names', () => {
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
    expect(tieredHtml).toContain('aria-label="彩印 · 大号数量价格阶梯"');
    expect(tieredHtml.match(/>1,000 个</g)).toHaveLength(1);
    expect(tieredHtml.match(/>20,000 个</g)).toHaveLength(1);
    expect(tieredHtml).toContain('¥295');
    expect(tieredHtml).toContain('¥2,300');
    expect(tieredHtml).not.toContain('157克双铜纸彩印 大号 1000');
    expect(tieredHtml).not.toContain('数量范围');
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

    expect(html).toContain('没有找到符合条件的收费项目');
    expect(html).toContain('选择一个收费项目后');
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
