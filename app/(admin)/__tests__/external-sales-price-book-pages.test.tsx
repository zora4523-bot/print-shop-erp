import type { ReactNode } from 'react';
import {
  renderToReadableStream,
  renderToStaticMarkup,
} from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CustomerPriceBookPurpose,
  CustomerPriceCalculationType,
  CustomerPriceRuleKind,
  OrderItemPricingRoute,
  OrderSettlementType,
  Role,
} from '@/generated/prisma/enums';
import { EMPTY_CUSTOMER_RULE_CONDITION_EDITOR_INPUT } from '@/lib/price/customer-rule-condition';

const {
  createDraftActionMock,
  createDraftFormPropsMock,
  draftRuleFormPropsMock,
  tierGroupEditorPropsMock,
  discardDraftActionMock,
  getCatalogMock,
  getDraftMock,
  getPublishPreviewMock,
  getRuleEditorMock,
  getWorkspaceMock,
  getWorkspaceDetailMock,
  listVersionsMock,
  notFoundMock,
  publishDraftActionMock,
  redirectMock,
  refreshMock,
  replaceMock,
  requirePermissionMock,
  updateRuleActionMock,
  updateRuleGroupActionMock,
} = vi.hoisted(() => ({
  createDraftActionMock: vi.fn(),
  createDraftFormPropsMock: vi.fn(),
  draftRuleFormPropsMock: vi.fn(),
  tierGroupEditorPropsMock: vi.fn(),
  discardDraftActionMock: vi.fn(),
  getCatalogMock: vi.fn(),
  getDraftMock: vi.fn(),
  getPublishPreviewMock: vi.fn(),
  getRuleEditorMock: vi.fn(),
  getWorkspaceMock: vi.fn(),
  getWorkspaceDetailMock: vi.fn(),
  listVersionsMock: vi.fn(),
  notFoundMock: vi.fn(),
  publishDraftActionMock: vi.fn(),
  redirectMock: vi.fn(),
  refreshMock: vi.fn(),
  replaceMock: vi.fn(),
  requirePermissionMock: vi.fn(),
  updateRuleActionMock: vi.fn(),
  updateRuleGroupActionMock: vi.fn(),
}));

vi.mock('@/lib/price/customer-price-book', () => ({
  getActiveCustomerPriceBookCatalog: getCatalogMock,
}));

vi.mock('@/lib/price/customer-price-book-admin', () => ({
  getCustomerPriceBookDraft: getDraftMock,
  getCustomerPriceBookDraftPublishPreview: getPublishPreviewMock,
  getCustomerPriceBookDraftRuleEditor: getRuleEditorMock,
  listCustomerPriceBookVersionsAndDrafts: listVersionsMock,
}));

vi.mock('@/lib/price/customer-price-book-workspace', () => ({
  getCustomerPriceRuleGroupWorkspacePage: getWorkspaceMock,
  getCustomerPriceRuleGroupWorkspaceDetail: getWorkspaceDetailMock,
}));

vi.mock('@/actions/customer-price-books', () => ({
  createCustomerPriceBookDraftAction: createDraftActionMock,
  discardCustomerPriceBookDraftAction: discardDraftActionMock,
  publishCustomerPriceBookDraftAction: publishDraftActionMock,
  updateCustomerPriceRuleDraftAction: updateRuleActionMock,
  updateCustomerPriceRuleDraftGroupAction: updateRuleGroupActionMock,
}));

vi.mock(
  '@/components/business/price/ExternalSalesPriceTierGroupEditor',
  () => ({
    ExternalSalesPriceTierGroupEditor: (props: unknown) => {
      tierGroupEditorPropsMock(props);
      return <div data-tier-group-editor="true">产品价格阶梯</div>;
    },
  }),
);

vi.mock(
  '@/components/business/price/ExternalSalesPriceBookDraftForms',
  async (importOriginal) => {
    const actual = await importOriginal<
      typeof import('@/components/business/price/ExternalSalesPriceBookDraftForms')
    >();
    return {
      ...actual,
      CreateCustomerPriceBookDraftForm: (props: {
        purpose: CustomerPriceBookPurpose;
        returnHref?: string;
      }) => {
        createDraftFormPropsMock(props);
        return <div data-create-draft-form="true">创建调价草稿</div>;
      },
      CustomerPriceBookDraftRuleForm: (
        props: Parameters<
          typeof actual.CustomerPriceBookDraftRuleForm
        >[0],
      ) => {
        draftRuleFormPropsMock(props);
        return <actual.CustomerPriceBookDraftRuleForm {...props} />;
      },
    };
  },
);

vi.mock('@/lib/auth/permissions', () => ({
  requirePermission: requirePermissionMock,
}));

vi.mock('next/navigation', () => ({
  notFound: notFoundMock,
  redirect: redirectMock,
  useRouter: () => ({ refresh: refreshMock, replace: replaceMock }),
}));

import LegacyOwnerExternalSalesPriceBookPage from '@/app/(admin)/owner/prices/external-sales/page';
import OwnerExternalSalesChargeItemsPage from '@/app/(admin)/owner/prices/external-sales/items/page';
import OwnerExternalSalesLogisticsPriceBookPage from '@/app/(admin)/owner/prices/external-sales/logistics/page';
import OwnerExternalSalesPriceBookVersionsPage from '@/app/(admin)/owner/prices/external-sales/versions/page';
import OwnerExternalSalesPriceVisualFixturePage from '@/app/(admin)/owner/prices/external-sales/visual-fixture/page';
import SalesQuotePage from '@/app/(admin)/sales/quote/page';
import SalesLogisticsQuotePage from '@/app/(admin)/sales/quote/logistics/page';

async function renderToResolvedMarkup(node: ReactNode): Promise<string> {
  const stream = await renderToReadableStream(node);
  await stream.allReady;
  return (await new Response(stream).text()).replaceAll('<!-- -->', '');
}

function catalog(purpose: CustomerPriceBookPurpose) {
  const processing = purpose === CustomerPriceBookPurpose.PROCESSING;
  return {
    code: processing
      ? 'EXTERNAL_SALES_PROCESSING'
      : 'EXTERNAL_SALES_LOGISTICS',
    name: processing
      ? '外部销售加工费报价单'
      : '外部销售快递与打包耗材报价单',
    version: processing ? 3 : 2,
    settlementType: OrderSettlementType.EXTERNAL_SALES,
    source: {
      fileName: processing ? '长昆-线下报价表.xlsx' : '长昆中通报价表.xlsx',
      sha256: processing ? 'processing-hash' : 'logistics-hash',
    },
    sources: [],
    effectiveFrom: '2026-08-08',
    effectiveTo: null,
    warnings: ['非锚点数量需要人工确认。'],
    categories: [
      {
        code: processing ? 'COLOR_PRINT' : 'EXPRESS',
        name: processing ? '彩印' : '中通快递',
        items: [
          {
            code: processing ? 'COLOR-200G-LARGE-100' : 'ZTO-GUANGDONG',
            name: processing ? '200 克双铜纸大号 · 100 个' : '广东省内',
            product: processing ? '彩印红包' : undefined,
            specification: processing ? '大号' : undefined,
            paper: processing ? '200 克双铜纸' : undefined,
            calculationLabel: processing ? '整批总价' : '首重 + 续重',
            quantityRangeLabel: processing ? '100 个锚点' : '不限数量',
            amountLabel: processing ? '¥ 130.00 / 批' : '首重 ¥5.00',
            source: {
              sheet: processing ? '彩印' : '中通',
              range: processing ? 'C6' : 'A3:D3',
            },
            automation: 'AUTO',
          },
        ],
      },
    ],
  };
}

const versionRows = [
  {
    id: 'processing-draft',
    code: 'EXTERNAL_SALES_PROCESSING',
    name: '外部销售加工费报价单',
    purpose: CustomerPriceBookPurpose.PROCESSING,
    version: 4,
    status: 'DRAFT',
    effectiveFrom: '2026-08-09T00:00:00.000Z',
    effectiveTo: null,
    ruleCount: 2,
    basedOnVersion: 3,
    basedOnBookId: 'processing-current',
    changeReason: '原材料调价',
    ruleSetSha256: null,
    createdById: 'admin-1',
    workflowCreatedAt: '2026-08-09T00:00:00.000Z',
    updatedAt: '2026-08-09T00:30:00.000Z',
  },
  {
    id: 'processing-current',
    code: 'EXTERNAL_SALES_PROCESSING',
    name: '外部销售加工费报价单',
    purpose: CustomerPriceBookPurpose.PROCESSING,
    version: 3,
    status: 'CURRENT',
    effectiveFrom: '2026-08-08T00:00:00.000Z',
    effectiveTo: null,
    ruleCount: 2,
    basedOnVersion: null,
    basedOnBookId: null,
    changeReason: null,
    ruleSetSha256: 'processing-rule-set-hash',
    createdById: null,
    workflowCreatedAt: null,
    updatedAt: '2026-08-08T00:00:00.000Z',
  },
  {
    id: 'processing-historical',
    code: 'EXTERNAL_SALES_PROCESSING',
    name: '外部销售加工费报价单',
    purpose: CustomerPriceBookPurpose.PROCESSING,
    version: 2,
    status: 'HISTORICAL',
    effectiveFrom: '2026-07-01T00:00:00.000Z',
    effectiveTo: '2026-08-08T00:00:00.000Z',
    ruleCount: 2,
    basedOnVersion: null,
    basedOnBookId: null,
    changeReason: null,
    ruleSetSha256: 'historical-rule-set-hash',
    createdById: null,
    workflowCreatedAt: null,
    updatedAt: '2026-08-08T00:00:00.000Z',
  },
  {
    id: 'logistics-scheduled',
    code: 'EXTERNAL_SALES_LOGISTICS',
    name: '外部销售快递耗材报价单',
    purpose: CustomerPriceBookPurpose.LOGISTICS,
    version: 3,
    status: 'SCHEDULED',
    effectiveFrom: '2026-09-01T00:00:00.000Z',
    effectiveTo: null,
    ruleCount: 1,
    basedOnVersion: 2,
    basedOnBookId: 'logistics-current',
    changeReason: '快递旺季调价',
    ruleSetSha256: 'scheduled-rule-set-hash',
    createdById: 'admin-1',
    workflowCreatedAt: '2026-08-09T00:00:00.000Z',
    updatedAt: '2026-08-09T00:00:00.000Z',
  },
  {
    id: 'logistics-current',
    code: 'EXTERNAL_SALES_LOGISTICS',
    name: '外部销售快递耗材报价单',
    purpose: CustomerPriceBookPurpose.LOGISTICS,
    version: 2,
    status: 'CURRENT',
    effectiveFrom: '2026-08-08T00:00:00.000Z',
    effectiveTo: null,
    ruleCount: 1,
    basedOnVersion: null,
    basedOnBookId: null,
    changeReason: null,
    ruleSetSha256: 'logistics-rule-set-hash',
    createdById: null,
    workflowCreatedAt: null,
    updatedAt: '2026-08-08T00:00:00.000Z',
  },
];

const processingDraft = {
  id: 'processing-draft',
  code: 'EXTERNAL_SALES_PROCESSING',
  name: '外部销售加工费报价单',
  purpose: CustomerPriceBookPurpose.PROCESSING,
  version: 4,
  basedOn: {
    id: 'processing-current',
    code: 'EXTERNAL_SALES_PROCESSING',
    version: 3,
  },
  changeReason: '原材料调价',
  createdBy: 'admin-1',
  createdAt: '2026-08-09T00:00:00.000Z',
  ruleSetSha256: null,
  updatedAt: '2026-08-09T00:30:00.000Z',
  categories: [{ id: 'category-1', code: 'COLOR_PRINT', name: '彩印' }],
  products: [{ id: 'product-1', code: 'PRD-1', name: '彩印红包' }],
  rules: [
    {
      id: 'rule-1',
      code: 'COLOR-100',
      name: '彩印 100 个',
      categoryId: 'category-1',
      categoryCode: 'COLOR_PRINT',
      categoryName: '彩印',
      productId: 'product-1',
      productCode: 'PRD-1',
      productName: '彩印红包',
      kind: CustomerPriceRuleKind.BASE,
      calculationType: CustomerPriceCalculationType.FIXED_AMOUNT,
      amount: '130',
      includedUnits: null,
      incrementUnits: null,
      incrementAmount: null,
      minQty: 100,
      maxQty: 100,
      triggerCondition: { craftsAny: ['彩印'] },
      exclusiveGroup: null,
      priority: 100,
      note: '自动报价',
      blocksAutomaticQuote: false,
      isActive: true,
      source: {
        name: '长昆报价表.xlsx',
        sha256: 'source-hash',
        sheet: '彩印',
        range: 'C6',
      },
      updatedAt: '2026-08-09T00:30:00.000Z',
    },
    {
      id: 'rule-2',
      code: 'FOIL-500',
      name: '烫金 500 个',
      categoryId: 'category-1',
      categoryCode: 'COLOR_PRINT',
      categoryName: '彩印',
      productId: null,
      productCode: null,
      productName: null,
      kind: CustomerPriceRuleKind.ADD_ON,
      calculationType: CustomerPriceCalculationType.PER_PIECE,
      amount: '0.2',
      includedUnits: null,
      incrementUnits: null,
      incrementAmount: null,
      minQty: 500,
      maxQty: 500,
      triggerCondition: null,
      exclusiveGroup: null,
      priority: 90,
      note: null,
      blocksAutomaticQuote: false,
      isActive: true,
      source: { name: null, sha256: null, sheet: '烫金', range: 'A2' },
      updatedAt: '2026-08-09T00:30:00.000Z',
    },
  ],
};

const processingPublishPreview = {
  priceBookId: 'processing-draft',
  purpose: CustomerPriceBookPurpose.PROCESSING,
  version: 4,
  basedOnVersion: 3,
  totalRuleCount: 2,
  activeRuleCount: 2,
  changedItemCount: 2,
  changedRuleCount: 2,
  increasedRuleCount: 1,
  decreasedRuleCount: 1,
  deltaPercentMin: '-4.8',
  deltaPercentMax: '8.3',
  changes: [
    {
      draftRuleId: 'rule-1',
      name: '彩印 100 个',
      categoryName: '彩印',
      productName: '彩印红包',
      quantityLabel: '100 个',
      calculationType: CustomerPriceCalculationType.FIXED_AMOUNT,
      current: {
        amount: '120',
        includedUnits: null,
        incrementUnits: null,
        incrementAmount: null,
        isActive: true,
      },
      draft: {
        amount: '130',
        includedUnits: null,
        incrementUnits: null,
        incrementAmount: null,
        isActive: true,
      },
      changedFields: ['价格'],
      direction: 'UP' as const,
      deltaAmount: '10',
      deltaPercent: '8.3',
    },
    {
      draftRuleId: 'rule-2',
      name: '烫金 500 个',
      categoryName: '彩印',
      productName: null,
      quantityLabel: '500 个',
      calculationType: CustomerPriceCalculationType.PER_PIECE,
      current: {
        amount: '0.21',
        includedUnits: null,
        incrementUnits: null,
        incrementAmount: null,
        isActive: true,
      },
      draft: {
        amount: '0.2',
        includedUnits: null,
        incrementUnits: null,
        incrementAmount: null,
        isActive: true,
      },
      changedFields: ['价格'],
      direction: 'DOWN' as const,
      deltaAmount: '-0.01',
      deltaPercent: '-4.8',
    },
  ],
  validation: { status: 'PASS' as const, issues: [] },
};

const processingRuleEditor = {
  context: {
    id: 'processing-draft',
    purpose: CustomerPriceBookPurpose.PROCESSING,
    categories: [{ id: 'category-1', name: '彩印' }],
    products: [{ id: 'product-1', name: '彩印红包' }],
    crafts: [{ value: 'COLOR_PRINT', label: '彩印' }],
  },
  rule: {
    id: 'rule-1',
    name: '彩印 100 个',
    categoryId: 'category-1',
    categoryName: '彩印',
    productId: 'product-1',
    kind: CustomerPriceRuleKind.BASE,
    calculationType: CustomerPriceCalculationType.FIXED_AMOUNT,
    unitsPerSheet: null,
    match: {
      ...EMPTY_CUSTOMER_RULE_CONDITION_EDITOR_INPUT,
      pricingRoutes: [OrderItemPricingRoute.COLOR_PRINT],
    },
    matchValidationErrors: [],
    amount: '130',
    includedUnits: null,
    incrementUnits: null,
    incrementAmount: null,
    minQty: 100,
    maxQty: 100,
    blocksAutomaticQuote: false,
    isActive: true,
    editorMode: 'PROCESSING',
    shippingScopeLabel: null,
    updatedAt: '2026-08-09T00:30:00.000Z',
  },
};

function businessRule(
  id: string,
  purpose: CustomerPriceBookPurpose,
  amount: string,
) {
  const processing = purpose === CustomerPriceBookPurpose.PROCESSING;
  return {
    id,
    name: processing ? '彩印 100 个' : '广东省内中通快递',
    category: {
      id: 'category-1',
      name: processing ? '彩印' : '中通快递',
    },
    product: processing
      ? {
          id: 'product-1',
          name: '157克双铜纸彩印 大号',
          specification: '大号',
          paperType: '157克双铜纸',
        }
      : null,
    kind: CustomerPriceRuleKind.BASE,
    calculationType: CustomerPriceCalculationType.FIXED_AMOUNT,
    unitsPerSheet: null,
    amount,
    includedUnits: processing ? null : '1',
    incrementUnits: processing ? null : '1',
    incrementAmount: processing ? null : '1',
    minQty: processing ? 100 : null,
    maxQty: processing ? 100 : null,
    scopeLabel: processing ? null : '中通 · 广东',
    automation: 'AUTOMATIC',
    blocksAutomaticQuote: false,
    isActive: true,
  };
}

function workspace(purpose: CustomerPriceBookPurpose) {
  const processing = purpose === CustomerPriceBookPurpose.PROCESSING;
  const currentRule = businessRule(
    processing ? 'current-rule-1' : 'logistics-current-rule-1',
    purpose,
    processing ? '120' : '5',
  );
  const draftRule = processing
    ? businessRule('rule-1', purpose, '130')
    : null;
  return {
    purpose,
    currentBook: {
      id: processing ? 'processing-current' : 'logistics-current',
      name: processing ? '外部销售加工费报价单' : '外部销售快递耗材报价单',
      purpose,
      version: processing ? 3 : 2,
      effectiveFrom: '2026-08-08T00:00:00.000Z',
      effectiveTo: null,
    },
    scheduledBook: null,
    draft: processing
      ? {
          id: 'processing-draft',
          name: '外部销售加工费报价单',
          purpose,
          version: 4,
          basedOnVersion: 3,
          changeReason: '原材料调价',
          changedCount: 1,
          updatedAt: '2026-08-09T00:30:00.000Z',
        }
      : null,
    draftCreation: {
      allowed: !processing,
      blockedReason: processing ? '已有未发布调价草稿' : null,
    },
    groups: [
      {
        id: currentRule.id,
        name: currentRule.product?.name ?? currentRule.name,
        category: currentRule.category,
        product: currentRule.product,
        kind: currentRule.kind,
        calculationType: currentRule.calculationType,
        unitsPerSheet: currentRule.unitsPerSheet,
        scopeLabel: currentRule.scopeLabel,
        automation: currentRule.automation,
        blocksAutomaticQuote: currentRule.blocksAutomaticQuote,
        tierCount: 1,
        activeTierCount: 1,
        changed: processing,
        tiers: [
          {
            id: draftRule?.id ?? currentRule.id,
            current: currentRule,
            draft: draftRule,
            changed: processing,
            expectedUpdatedAt: draftRule
              ? '2026-08-09T00:30:00.000Z'
              : null,
          },
        ],
      },
    ],
    filters: {
      categories: [currentRule.category],
      products: currentRule.product ? [currentRule.product] : [],
      provinces: processing ? [] : [{ value: '广东', name: '广东' }],
      kinds: [CustomerPriceRuleKind.BASE],
      calculationTypes: [CustomerPriceCalculationType.FIXED_AMOUNT],
      automations: ['AUTOMATIC', 'MANUAL'],
      activeStates: ['ACTIVE', 'INACTIVE'],
      changedAvailable: processing,
    },
    total: 1,
    page: 1,
    pageSize: 25,
    pageCount: 1,
  };
}

function processingWorkspaceWithoutDraft() {
  const result = workspace(CustomerPriceBookPurpose.PROCESSING);
  const current = result.groups[0]?.tiers[0]?.current;
  if (!current) throw new Error('测试工作区缺少当前收费项目');
  return {
    ...result,
    draft: null,
    draftCreation: { allowed: true, blockedReason: null },
    groups: [
      {
        id: current.id,
        name: current.product?.name ?? current.name,
        category: current.category,
        product: current.product,
        kind: current.kind,
        calculationType: current.calculationType,
        unitsPerSheet: current.unitsPerSheet,
        scopeLabel: current.scopeLabel,
        automation: current.automation,
        blocksAutomaticQuote: current.blocksAutomaticQuote,
        tierCount: 1,
        activeTierCount: 1,
        changed: false,
        tiers: [
          {
            id: current.id,
            current,
            draft: null,
            changed: false,
            expectedUpdatedAt: null,
          },
        ],
      },
    ],
    filters: {
      ...result.filters,
      changedAvailable: false,
    },
  };
}

function htmlHref(href: string): string {
  return `href="${href.replaceAll('&', '&amp;')}"`;
}

beforeEach(() => {
  requirePermissionMock.mockReset();
  getCatalogMock.mockReset();
  createDraftFormPropsMock.mockReset();
  draftRuleFormPropsMock.mockReset();
  tierGroupEditorPropsMock.mockReset();
  getDraftMock.mockReset();
  getPublishPreviewMock.mockReset();
  getRuleEditorMock.mockReset();
  getWorkspaceMock.mockReset();
  getWorkspaceDetailMock.mockReset();
  listVersionsMock.mockReset();
  notFoundMock.mockReset();
  redirectMock.mockReset();
  refreshMock.mockReset();
  replaceMock.mockReset();
  createDraftActionMock.mockReset();
  discardDraftActionMock.mockReset();
  publishDraftActionMock.mockReset();
  updateRuleActionMock.mockReset();
  updateRuleGroupActionMock.mockReset();
  getCatalogMock.mockImplementation(
    (_settlementType: OrderSettlementType, purpose: CustomerPriceBookPurpose) =>
      Promise.resolve(catalog(purpose)),
  );
  listVersionsMock.mockResolvedValue(versionRows);
  getDraftMock.mockResolvedValue(processingDraft);
  getPublishPreviewMock.mockResolvedValue(processingPublishPreview);
  getRuleEditorMock.mockResolvedValue(processingRuleEditor);
  getWorkspaceDetailMock.mockResolvedValue(null);
  getWorkspaceMock.mockImplementation(
    ({ purpose }: { purpose: CustomerPriceBookPurpose }) =>
      Promise.resolve(workspace(purpose)),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('external sales price book pages', () => {
  it('keeps the deterministic visual fixture unavailable in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    notFoundMock.mockImplementation(() => {
      throw new Error('NEXT_NOT_FOUND');
    });

    await expect(
      OwnerExternalSalesPriceVisualFixturePage({
        searchParams: Promise.resolve({ state: 'draft' }),
      }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
    expect(requirePermissionMock).not.toHaveBeenCalled();
  });

  it('keeps processing and logistics in the canonical SALES quote page', async () => {
    requirePermissionMock.mockResolvedValue({ id: 'sales-1', role: Role.SALES });

    const processingHtml = renderToStaticMarkup(
      await SalesQuotePage({
        searchParams: Promise.resolve({ section: 'processing' }),
      }),
    );
    const logisticsHtml = renderToStaticMarkup(
      await SalesQuotePage({
        searchParams: Promise.resolve({ section: 'logistics' }),
      }),
    );

    expect(requirePermissionMock).toHaveBeenCalledWith('order:create');
    expect(getCatalogMock).toHaveBeenCalledWith(
      OrderSettlementType.EXTERNAL_SALES,
      CustomerPriceBookPurpose.PROCESSING,
    );
    expect(getCatalogMock).toHaveBeenCalledWith(
      OrderSettlementType.EXTERNAL_SALES,
      CustomerPriceBookPurpose.LOGISTICS,
    );
    expect(processingHtml).toContain('外部销售报价查询');
    expect(processingHtml).toContain('¥ 130.00 / 批');
    expect(processingHtml).toContain(
      'href="/sales/quote?section=logistics"',
    );
    expect(logisticsHtml).toContain('首重 ¥5.00');
    expect(logisticsHtml).toContain('aria-current="page"');
    expect(logisticsHtml).not.toContain('ZTO-GUANGDONG');
    expect(logisticsHtml).not.toContain('A3:D3');
    expect(logisticsHtml).not.toContain('SHA-256');
  });

  it('renders separate processing and logistics charge workspaces for ADMIN', async () => {
    requirePermissionMock.mockResolvedValue({ id: 'admin-1', role: Role.ADMIN });

    const processingHtml = await renderToResolvedMarkup(
      await OwnerExternalSalesChargeItemsPage({
        searchParams: Promise.resolve({ purpose: 'processing' }),
      }),
    );
    const logisticsHtml = await renderToResolvedMarkup(
      await OwnerExternalSalesChargeItemsPage({
        searchParams: Promise.resolve({
          purpose: 'logistics',
          subject: '广东省',
        }),
      }),
    );

    expect(requirePermissionMock).toHaveBeenCalledWith('dict:price:manage');
    expect(processingHtml).toContain('客户计价规则');
    expect(processingHtml).toContain('加工费与调价');
    expect(processingHtml).toContain('收费项目');
    expect(processingHtml).toContain('当前价区间');
    expect(processingHtml).toContain('整批 ¥120');
    expect(processingHtml).toContain('本次调整');
    expect(processingHtml).toContain('1/1 档已调整');
    expect(processingHtml).not.toContain('已补全');
    expect(processingHtml).toContain('1 项修改');
    expect(processingHtml).toContain('搜索收费项目');
    expect(processingHtml).toContain('更多筛选');
    expect(processingHtml).toContain('href="/owner/rules/price-versions"');
    expect(logisticsHtml).toContain('快递费、打包耗材与调价');
    expect(logisticsHtml).toContain('中通 · 广东');
    expect(logisticsHtml).toContain('value="广东" selected=""');
    expect(logisticsHtml).toContain('首重 1kg ¥5；续重每 1kg ¥1');
    expect(logisticsHtml).toContain('发起调价');
    expect(logisticsHtml).not.toContain('SHA-256');
    expect(logisticsHtml).not.toContain('ZTO-GUANGDONG');
    expect(logisticsHtml).not.toContain('A3:D3');
    expect(getWorkspaceMock).toHaveBeenCalledWith(
      expect.objectContaining({ purpose: CustomerPriceBookPurpose.PROCESSING }),
    );
    expect(getWorkspaceMock).toHaveBeenCalledWith(
      expect.objectContaining({
        purpose: CustomerPriceBookPurpose.LOGISTICS,
        province: '广东',
      }),
    );
    expect(getWorkspaceMock).toHaveBeenCalledTimes(2);
  });

  it('工作台和规则编辑器隐藏来源坐标，同时保留原始匹配提交值', async () => {
    requirePermissionMock.mockResolvedValue({ id: 'admin-1', role: Role.ADMIN });
    const baseWorkspace = workspace(CustomerPriceBookPurpose.PROCESSING);
    const baseGroup = baseWorkspace.groups[0];
    const baseTier = baseGroup?.tiers[0];
    if (!baseGroup || !baseTier?.current || !baseTier.draft) {
      throw new Error('测试工作区缺少可编辑收费项目');
    }

    const product = {
      id: 'product-1',
      name: '空封现货 大号（纸张未标）（产品表!C2/C3）',
      paperType: '纸张未标（烫金!B13/B7/B6）',
      specification: '大号（规格表!A2/A3）',
    };
    const current = { ...baseTier.current, product };
    const draft = { ...baseTier.draft, product };
    const productGroup = {
      ...baseGroup,
      name: product.name,
      product,
      tiers: [{ ...baseTier, current, draft }],
    };
    const scopeCurrent = {
      ...current,
      id: 'scope-current',
      name: '局部烫金（规则表!D4/D5）',
      product: null,
      scopeLabel: '局部烫金（规则表!D4/D5）',
      kind: CustomerPriceRuleKind.ADD_ON,
    };
    const scopeDraft = { ...scopeCurrent, id: 'scope-draft' };
    const scopeGroup = {
      ...productGroup,
      id: 'scope-group',
      name: scopeCurrent.name,
      product: null,
      scopeLabel: scopeCurrent.scopeLabel,
      kind: CustomerPriceRuleKind.ADD_ON,
      changed: false,
      tiers: [
        {
          id: scopeDraft.id,
          current: scopeCurrent,
          draft: scopeDraft,
          changed: false,
          expectedUpdatedAt: '2026-08-09T00:30:00.000Z',
        },
      ],
    };
    getWorkspaceMock.mockResolvedValue({
      ...baseWorkspace,
      groups: [productGroup, scopeGroup],
      total: 2,
      filters: { ...baseWorkspace.filters, products: [product] },
    });
    getRuleEditorMock.mockResolvedValue({
      ...processingRuleEditor,
      context: {
        ...processingRuleEditor.context,
        products: [{ id: product.id, name: product.name }],
      },
      rule: {
        ...processingRuleEditor.rule,
        match: {
          ...processingRuleEditor.rule.match,
          paperTypes: ['纸张未标（烫金!B6）'],
          specifications: ['A4', '大号（烫金!B13/B7/B6）'],
        },
      },
    });

    const html = await renderToResolvedMarkup(
      await OwnerExternalSalesChargeItemsPage({
        searchParams: Promise.resolve({
          purpose: 'processing',
          item: productGroup.id,
        }),
      }),
    );

    expect(html).toContain('空封现货 · 大号');
    expect(html).toContain('纸张未标');
    expect(html).toContain('局部烫金');
    expect(html).not.toContain('空封现货 大号（ ）');
    expect(html).not.toMatch(/产品表!|规格表!|规则表!/);
    expect(html).toMatch(
      /id="price-rule-rule-1-paperTypes"[^>]*value="纸张未标"/,
    );
    expect(html).toMatch(
      /id="price-rule-rule-1-specifications"[^>]*value="A4、大号"/,
    );
    expect(html).toContain(
      'type="hidden" name="match.paperTypes" value="纸张未标（烫金!B6）"',
    );
    expect(html).toContain(
      'type="hidden" name="match.specifications" value="A4、大号（烫金!B13/B7/B6）"',
    );
  });

  it('keeps the charge-workspace header and publish entry while data is pending', async () => {
    requirePermissionMock.mockResolvedValue({ id: 'admin-1', role: Role.ADMIN });
    getWorkspaceMock.mockReturnValue(new Promise(() => {}));

    const html = renderToStaticMarkup(
      await OwnerExternalSalesChargeItemsPage({
        searchParams: Promise.resolve({ purpose: 'processing' }),
      }),
    );

    expect(html).toContain('客户计价规则');
    expect(html).toContain('href="/owner/rules/price-versions"');
    expect(html).toContain('正在加载收费项目工作台');
    expect(getWorkspaceMock).toHaveBeenCalledTimes(1);
  });

  it('preserves the selected current item and normalized filters when starting a draft', async () => {
    requirePermissionMock.mockResolvedValue({ id: 'admin-1', role: Role.ADMIN });
    getWorkspaceMock.mockResolvedValue({
      ...processingWorkspaceWithoutDraft(),
      total: 75,
      page: 2,
      pageCount: 3,
    });

    const html = await renderToResolvedMarkup(
      await OwnerExternalSalesChargeItemsPage({
        searchParams: Promise.resolve({
          purpose: 'processing',
          q: '彩印',
          category: 'category-1',
          subject: 'product-1',
          kind: CustomerPriceRuleKind.BASE,
          calculation: CustomerPriceCalculationType.FIXED_AMOUNT,
          quantity: '1000',
          automation: 'AUTO',
          status: 'ACTIVE',
          page: '2',
          item: 'current-rule-1',
          start: '1',
        }),
      }),
    );
    const expectedQuery = new URLSearchParams({
      purpose: 'processing',
      q: '彩印',
      category: 'category-1',
      subject: 'product-1',
      kind: CustomerPriceRuleKind.BASE,
      calculation: CustomerPriceCalculationType.FIXED_AMOUNT,
      quantity: '1000',
      automation: 'AUTO',
      status: 'ACTIVE',
      page: '2',
      item: 'current-rule-1',
      start: '1',
    });
    const expectedReturnQuery = new URLSearchParams(expectedQuery);
    expectedReturnQuery.delete('start');

    expect(createDraftFormPropsMock).toHaveBeenCalledWith({
      purpose: CustomerPriceBookPurpose.PROCESSING,
      returnHref: `/owner/rules/customer-pricing?${expectedReturnQuery.toString()}`,
    });
    expect(html).not.toContain(
      htmlHref(
        `/owner/rules/customer-pricing?${expectedQuery.toString()}`,
      ),
    );
    expect(html).toContain('open=""');
    expect(html).toContain(
      'href="/owner/rules/customer-pricing?purpose=logistics"',
    );
    expect(html).not.toContain('name="item"');
    expect(html).not.toContain('name="start"');
    expect(html).not.toContain('name="page"');
  });

  it('drops invalid filter and item parameters instead of carrying them into write flows', async () => {
    requirePermissionMock.mockResolvedValue({ id: 'admin-1', role: Role.ADMIN });
    getWorkspaceMock.mockResolvedValue(processingWorkspaceWithoutDraft());

    const html = await renderToResolvedMarkup(
      await OwnerExternalSalesChargeItemsPage({
        searchParams: Promise.resolve({
          purpose: 'processing',
          automation: 'ROOT',
          status: 'DELETED',
          item: '../../another-price-book',
          start: '1',
        }),
      }),
    );

    expect(getRuleEditorMock).not.toHaveBeenCalled();
    expect(createDraftFormPropsMock).toHaveBeenCalledWith({
      purpose: CustomerPriceBookPurpose.PROCESSING,
      returnHref: '/owner/rules/customer-pricing?purpose=processing&page=1',
    });
    expect(html).not.toContain('ROOT');
    expect(html).not.toContain('DELETED');
    expect(html).not.toContain('another-price-book');
  });

  it('clears a stale changed-only filter after the draft is gone', async () => {
    requirePermissionMock.mockResolvedValue({ id: 'admin-1', role: Role.ADMIN });
    getWorkspaceMock.mockResolvedValue(processingWorkspaceWithoutDraft());

    const html = await renderToResolvedMarkup(
      await OwnerExternalSalesChargeItemsPage({
        searchParams: Promise.resolve({
          purpose: 'processing',
          changed: '1',
        }),
      }),
    );

    expect(getWorkspaceMock).toHaveBeenCalledWith(
      expect.objectContaining({ changed: true }),
    );
    expect(html).toContain('筛选结果 1 项');
    expect(html).not.toContain('changed=1');
    expect(html).not.toContain('name="changed"');
    expect(createDraftFormPropsMock).toHaveBeenCalledWith({
      purpose: CustomerPriceBookPurpose.PROCESSING,
      returnHref:
        '/owner/rules/customer-pricing?purpose=processing&page=1',
    });
  });

  it('describes logistics base and increment price changes separately', async () => {
    requirePermissionMock.mockResolvedValue({ id: 'admin-1', role: Role.ADMIN });
    const logisticsWorkspace = workspace(CustomerPriceBookPurpose.LOGISTICS);
    const logisticsGroup = logisticsWorkspace.groups[0];
    const current = logisticsGroup?.tiers[0]?.current;
    if (!logisticsGroup || !current) {
      throw new Error('测试工作区缺少物流当前规则');
    }
    const draft = {
      ...current,
      id: 'logistics-draft-rule-1',
      incrementAmount: '1.5',
    };
    getWorkspaceMock.mockResolvedValue({
      ...logisticsWorkspace,
      draft: {
        id: 'logistics-draft',
        name: '外部销售快递耗材报价单',
        purpose: CustomerPriceBookPurpose.LOGISTICS,
        version: 3,
        basedOnVersion: 2,
        changeReason: '快递续重调价',
        changedCount: 1,
        updatedAt: '2026-08-09T00:30:00.000Z',
      },
      draftCreation: { allowed: false, blockedReason: '已有未发布调价草稿' },
      groups: [
        {
          ...logisticsGroup,
          changed: true,
          tiers: [
            {
              id: draft.id,
              current,
              draft,
              changed: true,
              expectedUpdatedAt: '2026-08-09T00:30:00.000Z',
            },
          ],
        },
      ],
      filters: {
        ...logisticsWorkspace.filters,
        changedAvailable: true,
      },
    });

    const html = await renderToResolvedMarkup(
      await OwnerExternalSalesChargeItemsPage({
        searchParams: Promise.resolve({
          purpose: 'logistics',
          item: logisticsGroup.id,
        }),
      }),
    );

    expect(html).toContain('续重 +¥0.5（+50%）');
    expect(html).not.toContain('¥0（0%）');
  });

  it('shows current-to-draft business changes even when the amount is unchanged', async () => {
    requirePermissionMock.mockResolvedValue({ id: 'admin-1', role: Role.ADMIN });
    const processingWorkspace = workspace(CustomerPriceBookPurpose.PROCESSING);
    const processingGroup = processingWorkspace.groups[0];
    const current = processingGroup?.tiers[0]?.current;
    const draft = processingGroup?.tiers[0]?.draft;
    if (!processingGroup || !current || !draft) {
      throw new Error('测试工作区缺少收费项目');
    }
    const changedDraft = {
      ...draft,
      name: '彩印加急 200 个',
      minQty: 200,
      maxQty: 200,
      amount: current.amount,
      isActive: false,
    };
    getWorkspaceMock.mockResolvedValue({
      ...processingWorkspace,
      groups: [
        {
          ...processingGroup,
          activeTierCount: 0,
          changed: true,
          tiers: [
            {
              ...processingGroup?.tiers[0],
              current,
              draft: changedDraft,
              changed: true,
            },
          ],
        },
      ],
    });

    const html = await renderToResolvedMarkup(
      await OwnerExternalSalesChargeItemsPage({
        searchParams: Promise.resolve({
          purpose: 'processing',
          item: processingGroup.id,
        }),
      }),
    );

    expect(html).toContain('价格未变');
    expect(html).toContain('名称：彩印 100 个 → 彩印加急 200 个');
    expect(html).toContain('数量范围：仅 100 个 → 仅 200 个');
    expect(html).toContain('状态：已启用 → 已停用');
    expect(html).toContain('1/1 档已调整');
  });

  it('shows sheet capacity and rule semantics when the per-sheet amount is unchanged', async () => {
    requirePermissionMock.mockResolvedValue({ id: 'admin-1', role: Role.ADMIN });
    const processingWorkspace = workspace(CustomerPriceBookPurpose.PROCESSING);
    const processingGroup = processingWorkspace.groups[0];
    const current = processingGroup?.tiers[0]?.current;
    const draft = processingGroup?.tiers[0]?.draft;
    if (!processingGroup || !current || !draft) {
      throw new Error('测试工作区缺少收费项目');
    }
    const currentPerSheet = {
      ...current,
      kind: CustomerPriceRuleKind.BASE,
      calculationType: CustomerPriceCalculationType.PER_SHEET,
      unitsPerSheet: 2,
      amount: '0.18',
      blocksAutomaticQuote: false,
    };
    const draftPerSheet = {
      ...draft,
      kind: CustomerPriceRuleKind.REFERENCE,
      calculationType: CustomerPriceCalculationType.PER_SHEET,
      unitsPerSheet: 4,
      amount: '0.18',
      automation: 'MANUAL' as const,
      blocksAutomaticQuote: true,
    };
    getWorkspaceMock.mockResolvedValue({
      ...processingWorkspace,
      groups: [
        {
          ...processingGroup,
          kind: draftPerSheet.kind,
          calculationType: draftPerSheet.calculationType,
          unitsPerSheet: draftPerSheet.unitsPerSheet,
          automation: draftPerSheet.automation,
          blocksAutomaticQuote: draftPerSheet.blocksAutomaticQuote,
          changed: true,
          tiers: [
            {
              ...processingGroup?.tiers[0],
              current: currentPerSheet,
              draft: draftPerSheet,
              changed: true,
            },
          ],
        },
      ],
    });

    const html = await renderToResolvedMarkup(
      await OwnerExternalSalesChargeItemsPage({
        searchParams: Promise.resolve({
          purpose: 'processing',
          item: processingGroup.id,
        }),
      }),
    );

    expect(html).toContain('aria-label="彩印 · 大号价格对比"');
    expect(html).toContain('>当前<');
    expect(html).toContain('>草稿<');
    expect(html).toContain('¥0.18 / 张');
    expect(html).toContain('折算单价 ¥0.09/个 → ¥0.045/个（-50%）');
    expect(html).not.toContain('价格未变');
    expect(html).toContain('每张含几个：2 个 → 4 个');
    expect(html).toContain('收费类型：基础价 → 人工参考');
    expect(html).toContain('处理方式：自动计价 → 需人工确认');
    expect(html).toContain(
      '自动报价限制：不阻止自动报价 → 阻止自动报价',
    );
    expect(html).not.toContain('触发条件（JSON）');
  });

  it('fails closed while a scheduled version is waiting to become effective', async () => {
    requirePermissionMock.mockResolvedValue({ id: 'admin-1', role: Role.ADMIN });
    const scheduledWorkspace = processingWorkspaceWithoutDraft();
    getWorkspaceMock.mockResolvedValue({
      ...scheduledWorkspace,
      scheduledBook: {
        id: 'processing-scheduled',
        name: '外部销售加工费报价单',
        purpose: CustomerPriceBookPurpose.PROCESSING,
        version: 4,
        effectiveFrom: '2026-09-01T00:00:00.000Z',
        effectiveTo: null,
      },
      // Page rendering must remain read-only even if an upstream DTO regresses.
      draftCreation: { allowed: true, blockedReason: null },
    });

    const html = await renderToResolvedMarkup(
      await OwnerExternalSalesChargeItemsPage({
        searchParams: Promise.resolve({
          purpose: 'processing',
          item: 'current-rule-1',
          start: '1',
        }),
      }),
    );

    expect(html).toContain('查看计划生效版本');
    expect(html).toContain('等待生效');
    expect(html).not.toContain('当前生效');
    expect(html).toContain(
      'href="/owner/rules/price-versions#price-book-history-PROCESSING"',
    );
    expect(html).toContain('生效前不能再发起新调价');
    expect(createDraftFormPropsMock).not.toHaveBeenCalled();
    expect(html).not.toContain('start=1');
    expect(getRuleEditorMock).not.toHaveBeenCalled();
  });

  it('keeps publishing and version history in a dedicated ADMIN page', async () => {
    requirePermissionMock.mockResolvedValue({ id: 'admin-1', role: Role.ADMIN });

    const versionsHtml = await renderToResolvedMarkup(
      await OwnerExternalSalesPriceBookVersionsPage({
        searchParams: Promise.resolve({}),
      }),
    );

    expect(versionsHtml).toContain('价格版本与发布');
    expect(versionsHtml).toContain('external-sales-price-book-version-manager');
    expect(versionsHtml).toContain('加工费');
    expect(versionsHtml).toContain('物流费');
    expect(versionsHtml).toContain('当前生效');
    expect(versionsHtml).toContain('草稿');
    expect(versionsHtml).toContain('计划生效');
    expect(versionsHtml).toContain('历史');
    expect(versionsHtml).toContain('编辑收费项目');
    expect(versionsHtml).toContain('准备发布');
    expect(versionsHtml).not.toContain('版本发布说明');
    expect(versionsHtml).toContain(
      '已有计划生效版本，待该版本生效后再创建下一份调价草稿',
    );
    expect(versionsHtml).not.toContain('SHA-256');
    expect(versionsHtml).not.toContain('processing-rule-set-hash');
    expect(listVersionsMock).toHaveBeenCalledTimes(1);
    expect(getDraftMock).not.toHaveBeenCalled();
    expect(getPublishPreviewMock).not.toHaveBeenCalled();
  });

  it('keeps the publish-center header available while version history is pending', async () => {
    requirePermissionMock.mockResolvedValue({ id: 'admin-1', role: Role.ADMIN });
    listVersionsMock.mockReturnValue(new Promise(() => {}));

    const html = renderToStaticMarkup(
      await OwnerExternalSalesPriceBookVersionsPage({
        searchParams: Promise.resolve({}),
      }),
    );

    expect(html).toContain('价格版本与发布');
    expect(html).toContain('href="/owner/rules/customer-pricing"');
    expect(html).toContain('正在加载内容');
    expect(listVersionsMock).toHaveBeenCalledTimes(1);
  });

  it('maps a selected current rule to its cloned draft rule editor', async () => {
    requirePermissionMock.mockResolvedValue({ id: 'admin-1', role: Role.ADMIN });

    const html = await renderToResolvedMarkup(
      await OwnerExternalSalesChargeItemsPage({
        searchParams: Promise.resolve({
          purpose: 'processing',
          item: 'current-rule-1',
        }),
      }),
    );

    expect(getRuleEditorMock).toHaveBeenCalledWith(
      'processing-draft',
      'rule-1',
    );
    expect(getWorkspaceMock).toHaveBeenCalledTimes(1);
    expect(getRuleEditorMock).toHaveBeenCalledTimes(1);
    expect(getDraftMock).not.toHaveBeenCalled();
    expect(draftRuleFormPropsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        successHref:
          '/owner/rules/customer-pricing?purpose=processing&item=current-rule-1#selected-charge-detail',
      }),
    );
    expect(html).toContain('aria-label="正在编辑：彩印 · 大号"');
    expect(html).toContain('aria-label="编辑收费项目：彩印 100 个"');
    expect(html).toContain('aria-label="彩印 · 大号价格对比"');
    expect(html).toContain('>当前<');
    expect(html).toContain('整批 ¥120');
    expect(html).toContain('>草稿<');
    expect(html).toContain('整批 ¥130');
    expect(html).toContain('>变化<');
    expect(html).toContain('+¥10（+8.33%）');
    expect(html).toContain('启用此规则');
    expect(html).toContain('#selected-charge-detail');
    expect(html.match(/保存草稿/g)).toHaveLength(1);
    expect(html).toContain('费用分类');
    expect(html).toContain('适用产品');
    expect(html).toContain('金额（元）');
    expect(html).not.toContain('高级条件与审计信息');
    expect(html).not.toContain('SHA-256');
    expect(html).not.toContain('触发条件（JSON）');
    expect(html).not.toContain('name="triggerCondition"');
    expect(html).not.toContain('name="exclusiveGroup"');
    expect(html).not.toContain('name="priority"');
    expect(html).not.toContain('source-hash');
    expect(html).not.toContain('COLOR-100');
  });

  it('groups matching paper products and opens all exact quantity tiers in one editor', async () => {
    requirePermissionMock.mockResolvedValue({ id: 'admin-1', role: Role.ADMIN });
    const baseWorkspace = workspace(CustomerPriceBookPurpose.PROCESSING);
    const makeGroup = (
      processName: string,
      productId: string,
      quantities: number[],
      calculationType: CustomerPriceCalculationType =
        CustomerPriceCalculationType.FIXED_AMOUNT,
      amounts?: string[],
    ) => {
      const product = {
        id: productId,
        name: `157克双铜纸${processName} 大号`,
        specification: '大号',
        paperType: '157克双铜纸',
      };
      const tiers = quantities.map((quantity, index) => {
        const current = {
          ...businessRule(
            `current-${productId}-${quantity}`,
            CustomerPriceBookPurpose.PROCESSING,
            amounts?.[index] ?? String(295 + index * 100),
          ),
          name: `${product.name} ${quantity}个固定总额`,
          product,
          calculationType,
          minQty: quantity,
          maxQty: quantity,
        };
        const draft = {
          ...current,
          id: `draft-${productId}-${quantity}`,
          amount: index === 1 ? String(300 + index * 100) : current.amount,
        };
        return {
          id: draft.id,
          current,
          draft,
          changed: draft.amount !== current.amount,
          expectedUpdatedAt: `2026-08-09T00:30:${String(index).padStart(
            2,
            '0',
          )}.000Z`,
        };
      });
      return {
        id: tiers[0]!.current.id,
        name: product.name,
        category: tiers[0]!.current.category,
        product,
        kind: CustomerPriceRuleKind.BASE,
        calculationType,
        unitsPerSheet: null,
        scopeLabel: null,
        automation: 'AUTOMATIC' as const,
        blocksAutomaticQuote: false,
        tierCount: tiers.length,
        activeTierCount: tiers.length,
        changed: tiers.some((tier) => tier.changed),
        tiers,
      };
    };
    const colorGroup = makeGroup(
      '彩印',
      'product-157-color',
      [1_000, 2_000, 3_000, 4_000, 5_000, 10_000, 20_000],
    );
    const foilGroup = makeGroup(
      '专版单色平烫',
      'product-157-color-foil',
      [500, 1_000],
      CustomerPriceCalculationType.PER_PIECE,
      ['0.52', '0.325'],
    );
    getWorkspaceMock.mockResolvedValue({
      ...baseWorkspace,
      groups: [colorGroup, foilGroup],
      total: 2,
      filters: {
        ...baseWorkspace.filters,
        products: [colorGroup.product, foilGroup.product],
      },
    });

    const html = await renderToResolvedMarkup(
      await OwnerExternalSalesChargeItemsPage({
        searchParams: Promise.resolve({
          purpose: 'processing',
          item: colorGroup.id,
        }),
      }),
    );

    expect(html).toContain('aria-label="正在编辑：彩印 · 大号"');
    expect(html).toContain('aria-label="编辑收费项目：专版单色平烫 · 大号"');
    expect(html).toContain('7 档');
    expect(html).toContain('当前价区间');
    expect(html).toContain('¥295–¥895');
    expect(html).toContain('1/7 档已调整');
    expect(html).toContain('2 档');
    expect(html).toContain('¥0.325–¥0.52');
    expect(html).toContain('data-tier-group-editor="true"');
    expect(getRuleEditorMock).not.toHaveBeenCalled();
    expect(tierGroupEditorPropsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        productTitle: '157克双铜纸彩印 大号',
        paperLabel: '157克双铜纸',
        sizeLabel: '大号',
        calculationType: CustomerPriceCalculationType.FIXED_AMOUNT,
        priceBookId: 'processing-draft',
        anchorRuleId: 'draft-product-157-color-1000',
        tiers: expect.arrayContaining([
          expect.objectContaining({ quantity: 1_000 }),
          expect.objectContaining({ quantity: 20_000 }),
        ]),
        saveAction: updateRuleGroupActionMock,
        successHref:
          `/owner/rules/customer-pricing?purpose=processing&item=${colorGroup.id}#selected-charge-detail`,
      }),
    );
  });

  it('keeps a saved rule detail reachable after it no longer matches list filters', async () => {
    requirePermissionMock.mockResolvedValue({ id: 'admin-1', role: Role.ADMIN });
    const filteredWorkspace = workspace(CustomerPriceBookPurpose.PROCESSING);
    const selectedGroup = filteredWorkspace.groups[0];
    const selected = selectedGroup?.tiers[0];
    if (!selectedGroup || !selected?.current || !selected.draft) {
      throw new Error('测试工作区缺少可编辑收费项目');
    }
    getWorkspaceMock.mockResolvedValue({
      ...filteredWorkspace,
      groups: [],
      total: 0,
      page: 1,
      pageCount: 0,
    });
    getWorkspaceDetailMock.mockResolvedValue({
      purpose: CustomerPriceBookPurpose.PROCESSING,
      priceBookId: filteredWorkspace.draft?.id ?? 'processing-draft',
      editable: true,
      group: selectedGroup,
      categories: filteredWorkspace.filters.categories,
      products: filteredWorkspace.filters.products,
    });

    const html = await renderToResolvedMarkup(
      await OwnerExternalSalesChargeItemsPage({
        searchParams: Promise.resolve({
          purpose: 'processing',
          q: '修改前名称',
          status: 'ACTIVE',
          page: '4',
          item: selected.draft.id,
        }),
      }),
    );

    expect(getWorkspaceDetailMock).toHaveBeenCalledWith({
      purpose: CustomerPriceBookPurpose.PROCESSING,
      groupId: selected.draft.id,
    });
    expect(getWorkspaceMock).toHaveBeenCalledTimes(1);
    expect(getWorkspaceDetailMock).toHaveBeenCalledTimes(1);
    expect(getRuleEditorMock).toHaveBeenCalledWith(
      filteredWorkspace.draft?.id,
      selected.draft.id,
    );
    expect(getRuleEditorMock).toHaveBeenCalledTimes(1);
    expect(draftRuleFormPropsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        successHref:
          `/owner/rules/customer-pricing?purpose=processing&item=${selectedGroup.id}#selected-charge-detail`,
      }),
    );
    expect(html).toContain('aria-label="编辑收费项目：彩印 100 个"');
    expect(html).toContain('没有符合条件的收费项目');
  });

  it('publishes only a listed draft and keeps destructive actions secondary', async () => {
    requirePermissionMock.mockResolvedValue({ id: 'admin-1', role: Role.ADMIN });

    const html = await renderToResolvedMarkup(
      await OwnerExternalSalesPriceBookVersionsPage({
        searchParams: Promise.resolve({
          draft: 'processing-draft',
        }),
      }),
    );

    expect(getDraftMock).toHaveBeenCalledWith('processing-draft');
    expect(getPublishPreviewMock).toHaveBeenCalledWith('processing-draft');
    expect(listVersionsMock).toHaveBeenCalledTimes(1);
    expect(getDraftMock).toHaveBeenCalledTimes(1);
    expect(getPublishPreviewMock).toHaveBeenCalledTimes(1);
    expect(html).toContain('发布加工费草稿 · 第 4 版');
    expect(html).toContain('本次修改');
    expect(html).toContain('发布影响');
    expect(html).toContain('发布检查');
    expect(html).toContain('发布说明（必填）');
    expect(html).toContain('彩印红包');
    expect(html).toContain('+8.3%');
    expect(html).toContain('aria-label="发布价目草稿"');
    expect(html).toContain('name="effectiveFrom"');
    expect(html).toContain('生效时间（上海时间）');
    expect(html).toContain(
      'name="expectedDraftUpdatedAt" value="2026-08-09T00:30:00.000Z"',
    );
    expect(html).toContain('更多草稿操作');
    expect(html).toContain('aria-label="放弃价目草稿"');
    expect(html).not.toContain('COLOR-100');
    expect(html).not.toContain('source-hash');
  });

  it('does not query or disclose an unlisted draft id', async () => {
    requirePermissionMock.mockResolvedValue({ id: 'admin-1', role: Role.ADMIN });

    const html = await renderToResolvedMarkup(
      await OwnerExternalSalesPriceBookVersionsPage({
        searchParams: Promise.resolve({ draft: 'not-a-listed-draft' }),
      }),
    );

    expect(getDraftMock).not.toHaveBeenCalled();
    expect(getPublishPreviewMock).not.toHaveBeenCalled();
    expect(html).toContain('草稿不存在或不可编辑');
    expect(html).not.toContain('not-a-listed-draft');
  });

  it('defaults unknown sections to processing', async () => {
    requirePermissionMock.mockResolvedValue({ id: 'sales-1', role: Role.SALES });

    const html = renderToStaticMarkup(
      await SalesQuotePage({
        searchParams: Promise.resolve({ section: 'versions' }),
      }),
    );

    expect(html).toContain('¥ 130.00 / 批');
    expect(html).not.toContain('section=versions');
  });

  it('redirects legacy ADMIN URLs to the workspace and publish center', async () => {
    redirectMock.mockImplementation((url: string) => {
      throw new Error(`REDIRECT:${url}`);
    });

    await expect(
      LegacyOwnerExternalSalesPriceBookPage({
        searchParams: Promise.resolve({ section: 'processing' }),
      }),
    ).rejects.toThrow(
      'REDIRECT:/owner/rules/customer-pricing?purpose=processing',
    );
    await expect(
      LegacyOwnerExternalSalesPriceBookPage({
        searchParams: Promise.resolve({
          section: 'versions',
          draft: 'processing-draft',
        }),
      }),
    ).rejects.toThrow(
      'REDIRECT:/owner/rules/price-versions?draft=processing-draft',
    );
    expect(() => OwnerExternalSalesLogisticsPriceBookPage()).toThrow(
      'REDIRECT:/owner/rules/customer-pricing?purpose=logistics',
    );
    expect(() => SalesLogisticsQuotePage()).toThrow(
      'REDIRECT:/sales/quote?section=logistics',
    );
  });
});
