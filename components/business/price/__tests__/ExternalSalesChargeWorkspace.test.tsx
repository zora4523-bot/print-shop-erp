import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { Button } from '@/components/ui/button';
import {
  RulePriceWorkbench,
  externalSalesChargeListHref,
  type ExternalSalesChargeWorkspaceItem,
  type ExternalSalesChargeWorkspaceProps,
} from '../RulePriceWorkbench';

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

const processingItems: ExternalSalesChargeWorkspaceItem[] = [
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
      '/owner/rules/customer-pricing?purpose=processing&item=item-1#selected-charge-detail',
  },
  {
    id: 'item-2',
    name: '非标尺寸加工',
    categoryLabel: '特殊加工',
    subjectLabel: '通用',
    quantityLabel: '不限数量',
    calculationLabel: '人工报价',
    currentAmountLabel: '人工确认',
    draftAmountLabel: null,
    automation: 'MANUAL',
    status: 'INACTIVE',
    changed: false,
    detailHref:
      '/owner/rules/customer-pricing?purpose=processing&item=item-2#selected-charge-detail',
  },
];

function props(
  overrides: Partial<ExternalSalesChargeWorkspaceProps> = {},
): ExternalSalesChargeWorkspaceProps {
  return {
    purpose: 'processing',
    searchAction: '/owner/rules/customer-pricing',
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
      '/owner/rules/customer-pricing?purpose=processing',
    items: processingItems,
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
      compareHref: '/owner/rules/price-versions?changed=1',
      publishHref: '/owner/rules/price-versions?publish=1',
    },
    pagination: {
      page: 2,
      pageCount: 5,
      total: 121,
      previousHref:
        '/owner/rules/customer-pricing?purpose=processing&page=1',
      nextHref:
        '/owner/rules/customer-pricing?purpose=processing&page=3',
    },
    ...overrides,
  };
}

function render(
  overrides: Partial<ExternalSalesChargeWorkspaceProps> = {},
): string {
  return renderToStaticMarkup(
    <RulePriceWorkbench {...props(overrides)} />,
  );
}

describe('RulePriceWorkbench', () => {
  it('renders the reference-style compact matrix and the selected editor inline', () => {
    const html = render({
      paneTitle: '局部烫金 · 空白封现货单价',
      paneDescription: '空格表示转人工，0 元与无报价不是一回事。',
      basisLabel: '元 / 个 · 真实价目',
    });

    expect(html).toContain('data-slot="rule-price-workbench"');
    expect(html).toContain('局部烫金 · 空白封现货单价');
    expect(html).toContain('元 / 个 · 真实价目');
    expect(html).not.toContain('aria-label="客户计价规则类型"');
    expect(html).toContain('aria-label="客户计价规则矩阵"');
    for (const heading of [
      '收费项目',
      '适用范围',
      '数量与档位',
      '当前价',
      '草稿价',
      '状态',
      '操作',
    ]) {
      expect(html).toContain(`>${heading}<`);
    }
    expect(html).toContain(
      'aria-label="正在编辑收费项目：中号专版双面烫金"',
    );
    expect(html).toContain('id="selected-charge-detail"');
    expect(html).toContain('>直接编辑<');
    expect(html).toContain('aria-label="编辑收费项目"');
    expect(html).toContain('编辑中号专版双面烫金');
    expect(html).toContain('保存修改');
    expect(html).toMatch(
      /<\/table><\/div><div class="mt-3 min-w-0"><section id="selected-charge-detail"/,
    );
    expect(html).not.toContain('colSpan="7"');
    expect(html.indexOf('id="selected-charge-detail"')).toBeGreaterThan(
      html.indexOf('非标尺寸加工'),
    );
    expect(html).toContain(
      'href="/owner/rules/customer-pricing?purpose=processing#rule-price-matrix-heading"',
    );

    expect(html).not.toContain('返回收费项目列表');
    expect(html).not.toContain('选择一个收费项目');
    expect(html).not.toContain(
      'xl:grid-cols-[minmax(0,1fr)_minmax(30rem,31.25rem)]',
    );
  });

  it('shows real draft state beside current and draft prices', () => {
    const html = render();

    expect(html).toContain('aria-label="调价草稿状态"');
    expect(html).toContain('调价草稿 v4');
    expect(html).toContain('3 处未发布');
    expect(html).toContain('原材料与人工成本调整');
    expect(html).toContain('最近保存 2026/08/11 09:30');
    expect(html).toContain('审阅变更');
    expect(html).toContain('校验并发布');
    expect(html).toContain('href="/owner/rules/price-versions?changed=1"');
    expect(html).toContain('href="/owner/rules/price-versions?publish=1"');
    expect(html).toContain('¥0.48 / 个');
    expect(html).toContain('¥0.52 / 个');
    expect(html).toContain('aria-label="本次已修改"');
    expect(html).toContain('1/1 档已调整');
    expect(html).toContain('其他业务变更');
    expect(html).toContain(
      '数量范围：500–1,000 个 → 501–1,000 个',
    );
  });

  it('keeps a read-only quantity ladder compact and distinguishes no quote from zero', () => {
    const tieredItem: ExternalSalesChargeWorkspaceItem = {
      ...processingItems[0]!,
      id: 'tiered-item',
      name: '彩印 · 大号',
      subjectLabel: '157克双铜纸',
      quantityLabel: '2 个数量档 · 1,000–2,000 个',
      currentAmountLabel: '¥295–¥420 / 单',
      draftAmountLabel: '¥310 / 单起',
      detailHref:
        '/owner/rules/customer-pricing?purpose=processing&item=tiered-item#selected-charge-detail',
      priceTiers: [
        {
          quantityLabel: '1,000 个',
          currentAmountLabel: '¥295',
          draftAmountLabel: '¥310',
          changed: true,
        },
        {
          quantityLabel: '2,000 个',
          currentAmountLabel: '¥420',
          draftAmountLabel: null,
          changed: false,
        },
      ],
    };
    const html = render({
      items: [tieredItem],
      selectedItem: tieredItem,
      selectedItemId: tieredItem.id,
      selectedEditor: undefined,
      pagination: { page: 1, pageCount: 1, total: 1 },
    });

    expect(html).toContain('aria-label="彩印 · 大号价格阶梯"');
    expect(html).toContain('>数量档<');
    expect(html).toContain('>当前价<');
    expect(html).toContain('>草稿价<');
    expect(html).toContain('>变化<');
    expect(html).toContain('>1,000 个<');
    expect(html).toContain('>2,000 个<');
    expect(html).toContain('>¥310<');
    expect(html).toContain('>— 转人工<');
    expect(html).not.toContain('>¥0<');
    expect(html).toContain(
      '该项目不在当前调价草稿内，只能查看生效价',
    );
  });

  it('presents manual pricing as an intentional business state, not an incomplete draft', () => {
    const manualItem = processingItems[1]!;
    const html = render({
      items: [manualItem],
      selectedItem: manualItem,
      selectedItemId: manualItem.id,
      selectedEditor: undefined,
      pagination: { page: 1, pageCount: 1, total: 1 },
    });

    expect(html).toContain('非标尺寸加工');
    expect(html).toContain('人工报价');
    expect(html).toContain('人工确认');
    expect(html).toContain('需人工确认');
    expect(html).toContain('已停用');
    expect(html).not.toContain('待补全');
    expect(html).not.toContain('— 转人工');
  });

  it('separates read-only current prices from draft editing', () => {
    const html = render({
      draft: null,
      selectedEditor: undefined,
      createDraftHref: '/owner/rules/customer-pricing?start=1',
      pagination: { page: 1, pageCount: 1, total: 2 },
    });

    expect(html).toContain('aria-label="价格状态"');
    expect(html).toContain('当前生效');
    expect(html).toContain('用于之后的新工单计价。');
    expect(html).toContain('发起调价');
    expect(html).toContain(
      'aria-label="正在查看收费项目：中号专版双面烫金"',
    );
    expect(html).toContain('aria-label="查看收费项目：非标尺寸加工"');
    expect(html).not.toContain('>草稿价<');
    expect(html).not.toContain('编辑收费项目：非标尺寸加工');
    expect(html).not.toContain('校验并发布');
  });

  it('opens the compact filter area only when filters are active and preserves the others in clear links', () => {
    const collapsedHtml = render({
      draft: null,
      selectedEditor: undefined,
      pagination: { page: 1, pageCount: 1, total: 2 },
    });

    expect(collapsedHtml).toMatch(
      /<details\b(?![^>]*\bopen(?:=|\s|>))[^>]*>/,
    );
    expect(collapsedHtml).toContain('筛选定位');
    expect(collapsedHtml).toContain(
      'placeholder="搜索项目、类目或产品"',
    );

    const filteredHtml = render({
      filters: {
        ...props().filters,
        category: 'foil',
        kind: 'ADD_ON',
        automation: 'AUTO',
        changedOnly: true,
      },
    });

    expect(filteredHtml).toMatch(/<details\b[^>]*\bopen=""/);
    expect(filteredHtml).toContain('>4 项<');
    expect(filteredHtml).toContain('value="foil" selected=""');
    expect(filteredHtml).toContain('value="ADD_ON" selected=""');
    expect(filteredHtml).toContain('value="AUTO" selected=""');
    expect(filteredHtml).toContain('checked=""');
    expect(filteredHtml).toContain('data-slot="checkbox"');
    expect(filteredHtml).toContain('aria-label="只看本次修改"');
    expect(filteredHtml).toContain(
      'aria-label="已启用的收费项目筛选"',
    );
    expect(filteredHtml).toContain('类目：烫金加工');
    expect(filteredHtml).toContain('类型：附加费');
    expect(filteredHtml).toContain('处理：自动计价');
    expect(filteredHtml).toContain('只看本次修改');
    expect(filteredHtml).toContain(
      'aria-label="清除筛选：类目：烫金加工"',
    );
    expect(filteredHtml).toContain(
      'href="/owner/rules/customer-pricing?purpose=processing&amp;kind=ADD_ON&amp;automation=AUTO&amp;changed=1"',
    );
  });

  it('keeps server pagination next to the matrix without duplicating item cards', () => {
    const html = render();

    expect(html).toContain('aria-label="收费项目分页"');
    expect(html).toContain('第 2 / 5 页，共 121 项');
    expect(html).toContain(
      'href="/owner/rules/customer-pricing?purpose=processing&amp;page=1"',
    );
    expect(html).toContain(
      'href="/owner/rules/customer-pricing?purpose=processing&amp;page=3"',
    );
    expect(html.match(/aria-label="客户计价规则矩阵"/g)).toHaveLength(1);
    expect(html.match(/<table\b/g)).toHaveLength(1);
  });

  it('retains external-sales packaging, carton and express-fee semantics', () => {
    const logisticsItems: ExternalSalesChargeWorkspaceItem[] = [
      {
        id: 'bag-fee',
        name: '单款入袋费',
        categoryLabel: '包装耗材',
        subjectLabel: '外部销售工单',
        quantityLabel: '按实际袋数',
        calculationLabel: '按袋',
        currentAmountLabel: '¥0.10 / 袋',
        draftAmountLabel: '¥0.12 / 袋',
        automation: 'AUTO',
        status: 'ACTIVE',
        changed: true,
        detailHref: '#bag-fee',
      },
      {
        id: 'carton-fee',
        name: '纸箱耗材费',
        categoryLabel: '纸箱耗材',
        subjectLabel: '整单',
        quantityLabel: '按订单总数量分档',
        calculationLabel: '整批固定金额',
        currentAmountLabel: '¥1–¥8 / 单',
        draftAmountLabel: '¥1–¥8 / 单',
        automation: 'AUTO',
        status: 'ACTIVE',
        changed: false,
        detailHref: '#carton-fee',
      },
      {
        id: 'express-fee',
        name: '中通快递费',
        categoryLabel: '快递费',
        subjectLabel: '上海',
        quantityLabel: '自动计费重量',
        calculationLabel: '首重 + 续重',
        currentAmountLabel: '首重 1kg ¥2.80；续重每 1kg ¥3.50',
        draftAmountLabel: '首重 1kg ¥2.80；续重每 1kg ¥3.50',
        automation: 'AUTO',
        status: 'ACTIVE',
        changed: false,
        detailHref: '#express-fee',
      },
    ];
    const html = render({
      purpose: 'logistics',
      hiddenSearchFields: { purpose: 'logistics' },
      items: logisticsItems,
      selectedItemId: undefined,
      selectedEditor: undefined,
      pagination: { page: 1, pageCount: 1, total: 3 },
    });

    expect(html).toContain('包装、纸箱与快递规则');
    expect(html).not.toContain('aria-label="客户计价规则类型"');
    expect(html).toContain('单款入袋费');
    expect(html).toContain('¥0.10 / 袋');
    expect(html).toContain('纸箱耗材费');
    expect(html).toContain('¥1–¥8 / 单');
    expect(html).toContain('中通快递费');
    expect(html).toContain('首重 + 续重');
    expect(html).toContain('首重 1kg ¥2.80；续重每 1kg ¥3.50');
    expect(html).toContain('自动计费重量');
  });

  it('keeps unknown filters and imported coordinates out of business copy', () => {
    const sourceItem: ExternalSalesChargeWorkspaceItem = {
      ...processingItems[0]!,
      name: '空封现货基础价（A4:C4）',
      categoryLabel: '基础加工费（价格表!B6）',
      subjectLabel: '纸张未标（烫金!B13）',
    };
    const html = render({
      items: [sourceItem],
      selectedItem: sourceItem,
      selectedItemId: sourceItem.id,
      selectedEditor: undefined,
      filters: {
        ...props().filters,
        category: 'INTERNAL_CATEGORY_TOKEN',
      },
      pagination: { page: 1, pageCount: 1, total: 1 },
    });

    expect(html).toContain('空封现货基础价');
    expect(html).toContain('纸张未标');
    expect(html).toContain('类目：未识别选项');
    expect(html).not.toMatch(
      /A4:C4|价格表!B6|烫金!B13|INTERNAL_CATEGORY_TOKEN/,
    );
    expect(html).not.toContain('triggerCondition');
    expect(html).not.toContain('SHA-256');
  });

  it('uses separate no-data and filtered no-result states', () => {
    const emptyHtml = render({
      draft: null,
      items: [],
      selectedItemId: undefined,
      selectedEditor: undefined,
      pagination: { page: 1, pageCount: 0, total: 0 },
    });
    expect(emptyHtml).toContain('data-kind="no-data"');
    expect(emptyHtml).toContain('暂无收费项目');

    const noResultHtml = render({
      draft: null,
      filters: { ...props().filters, query: '不存在的项目' },
      items: [],
      selectedItemId: undefined,
      selectedEditor: undefined,
      pagination: { page: 1, pageCount: 0, total: 0 },
    });
    expect(noResultHtml).toContain('data-kind="no-result"');
    expect(noResultHtml).toContain('没有匹配的收费项目');
    expect(noResultHtml).toContain('清除条件');
    expect(noResultHtml).toContain(
      'href="/owner/rules/customer-pricing?purpose=processing"',
    );
  });

  it('does not mislabel scheduled or unavailable workspaces as current', () => {
    const scheduledHtml = render({
      workspaceStatus: 'SCHEDULED',
      draft: null,
      selectedEditor: undefined,
      createDraftHref: undefined,
      createDraftBlockedReason:
        '第 3 版已安排计划生效；生效前不能再发起新调价。',
    });
    expect(scheduledHtml).toContain('等待生效');
    expect(scheduledHtml).toContain('生效前不能再发起新调价');
    expect(scheduledHtml).not.toContain('>当前生效<');
    expect(scheduledHtml).not.toContain('>发起调价</a>');

    const unavailableHtml = render({
      workspaceStatus: 'UNAVAILABLE',
      draft: null,
      items: [],
      selectedItemId: undefined,
      selectedEditor: undefined,
      createDraftHref: undefined,
      createDraftBlockedReason: '当前没有可复制的生效价格版本',
      pagination: { page: 1, pageCount: 0, total: 0 },
    });
    expect(unavailableHtml).toContain('暂无生效价');
    expect(unavailableHtml).not.toContain('>当前生效<');
    expect(unavailableHtml).not.toContain('>等待生效<');
  });

  it('builds the inline-detail return URL without keeping the selected item', () => {
    expect(
      externalSalesChargeListHref(
        '/owner/rules/customer-pricing?purpose=processing&item=item-1&page=2#selected-charge-detail',
      ),
    ).toBe(
      '/owner/rules/customer-pricing?purpose=processing&page=2#rule-price-matrix-heading',
    );
    expect(externalSalesChargeListHref('#selected-charge-detail')).toBe(
      '#rule-price-matrix-heading',
    );
  });
});
