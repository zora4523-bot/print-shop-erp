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
  Role,
} from '@/generated/prisma/enums';
import { EMPTY_CUSTOMER_RULE_CONDITION_EDITOR_INPUT } from '@/lib/price/customer-rule-condition';

const {
  createDraftActionMock,
  createDraftFormPropsMock,
  draftRuleFormPropsMock,
  tierGroupEditorPropsMock,
  discardDraftActionMock,
  getDraftMock,
  getPublishPreviewMock,
  getRuleEditorMock,
  getSectionWorkspaceMock,
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
  dedicatedSectionPropsMock,
} = vi.hoisted(() => ({
  createDraftActionMock: vi.fn(),
  createDraftFormPropsMock: vi.fn(),
  draftRuleFormPropsMock: vi.fn(),
  tierGroupEditorPropsMock: vi.fn(),
  discardDraftActionMock: vi.fn(),
  getDraftMock: vi.fn(),
  getPublishPreviewMock: vi.fn(),
  getRuleEditorMock: vi.fn(),
  getSectionWorkspaceMock: vi.fn(),
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
  dedicatedSectionPropsMock: vi.fn(),
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

vi.mock('@/lib/price/customer-price-section-workspace', () => ({
  CUSTOMER_PRICE_SECTIONS: [
    'blank',
    'machine',
    'tiers',
    'adds',
    'print',
    'ship',
  ],
  getCustomerPriceSectionWorkspace: getSectionWorkspaceMock,
}));

vi.mock(
  '@/components/business/rules/pricing/CustomerPricingDedicatedSection',
  () => ({
    CustomerPricingDedicatedSection: (props: {
      workspace: { section: string };
      createDraftPurpose: CustomerPriceBookPurpose | null;
    }) => {
      dedicatedSectionPropsMock(props);
      return (
        <div data-dedicated-price-section={props.workspace.section}>
          {props.workspace.section} 专用价格编辑器
        </div>
      );
    },
  }),
);

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
import OwnerExternalSalesPriceVisualFixturePage from '@/app/(admin)/owner/prices/external-sales/visual-fixture/page';
import OwnerExternalSalesChargeItemsPage from '@/components/business/rules/pricing/CustomerPricingWorkspacePage';
import OwnerExternalSalesPriceBookVersionsPage from '@/components/business/rules/pricing/PriceVersionsPage';

async function renderToResolvedMarkup(node: ReactNode): Promise<string> {
  const stream = await renderToReadableStream(node);
  await stream.allReady;
  return (await new Response(stream).text()).replaceAll('<!-- -->', '');
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

function htmlHref(href: string): string {
  return `href="${href.replaceAll('&', '&amp;')}"`;
}

beforeEach(() => {
  requirePermissionMock.mockReset();
  createDraftFormPropsMock.mockReset();
  draftRuleFormPropsMock.mockReset();
  tierGroupEditorPropsMock.mockReset();
  getDraftMock.mockReset();
  getPublishPreviewMock.mockReset();
  getRuleEditorMock.mockReset();
  getSectionWorkspaceMock.mockReset();
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
  dedicatedSectionPropsMock.mockReset();
  listVersionsMock.mockResolvedValue(versionRows);
  getDraftMock.mockResolvedValue(processingDraft);
  getPublishPreviewMock.mockResolvedValue(processingPublishPreview);
  getRuleEditorMock.mockResolvedValue(processingRuleEditor);
  getWorkspaceDetailMock.mockResolvedValue(null);
  getWorkspaceMock.mockImplementation(
    ({ purpose }: { purpose: CustomerPriceBookPurpose }) =>
      Promise.resolve(workspace(purpose)),
  );
  getSectionWorkspaceMock.mockImplementation((section: string) =>
    Promise.resolve({
      section,
      sources: [],
      rules: [],
      shippingWeightPolicy: null,
    }),
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

  it('maps every rule-center section onto its dedicated business editor', async () => {
    requirePermissionMock.mockResolvedValue({ id: 'admin-1', role: Role.ADMIN });

    const blankHtml = await renderToResolvedMarkup(
      await OwnerExternalSalesChargeItemsPage({
        searchParams: Promise.resolve({ section: 'blank' }),
      }),
    );
    const addsHtml = await renderToResolvedMarkup(
      await OwnerExternalSalesChargeItemsPage({
        searchParams: Promise.resolve({ section: 'adds' }),
      }),
    );
    const shipHtml = await renderToResolvedMarkup(
      await OwnerExternalSalesChargeItemsPage({
        searchParams: Promise.resolve({
          purpose: 'processing',
          section: 'ship',
        }),
      }),
    );

    expect(getSectionWorkspaceMock).toHaveBeenNthCalledWith(1, 'blank');
    expect(getSectionWorkspaceMock).toHaveBeenNthCalledWith(2, 'adds');
    expect(getSectionWorkspaceMock).toHaveBeenNthCalledWith(3, 'ship');
    expect(getWorkspaceMock).not.toHaveBeenCalled();
    expect(blankHtml).toContain('data-dedicated-price-section="blank"');
    expect(addsHtml).toContain('data-dedicated-price-section="adds"');
    expect(shipHtml).toContain('data-dedicated-price-section="ship"');
    expect(blankHtml).not.toContain('价格规则矩阵');
    expect(addsHtml).not.toContain('搜索收费项目');
    expect(shipHtml).not.toContain('价格规则矩阵');
    expect(dedicatedSectionPropsMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ createDraftPurpose: null }),
    );
    expect(dedicatedSectionPropsMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ createDraftPurpose: null }),
    );
    expect(dedicatedSectionPropsMock).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ createDraftPurpose: null }),
    );
  });

  it('仅向专用编辑器传递安全的价格定位 id', async () => {
    requirePermissionMock.mockResolvedValue({ id: 'admin-1', role: Role.ADMIN });

    await renderToResolvedMarkup(
      await OwnerExternalSalesChargeItemsPage({
        searchParams: Promise.resolve({
          section: 'adds',
          focus: 'rule-add-1',
        }),
      }),
    );
    expect(dedicatedSectionPropsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        focusRuleId: 'rule-add-1',
      }),
    );

    await renderToResolvedMarkup(
      await OwnerExternalSalesChargeItemsPage({
        searchParams: Promise.resolve({
          section: 'adds',
          focus: '../rule-add-1',
        }),
      }),
    );
    expect(dedicatedSectionPropsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        focusRuleId: null,
      }),
    );
  });

  it('只为 query 指定的价目 purpose 展开调价表单', async () => {
    requirePermissionMock.mockResolvedValue({ id: 'admin-1', role: Role.ADMIN });

    await renderToResolvedMarkup(
      await OwnerExternalSalesChargeItemsPage({
        searchParams: Promise.resolve({
          section: 'ship',
          start: '1',
          purpose: 'logistics',
        }),
      }),
    );

    expect(dedicatedSectionPropsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        workspace: expect.objectContaining({ section: 'ship' }),
        createDraftPurpose: CustomerPriceBookPurpose.LOGISTICS,
      }),
    );

    await renderToResolvedMarkup(
      await OwnerExternalSalesChargeItemsPage({
        searchParams: Promise.resolve({
          section: 'ship',
          start: '1',
        }),
      }),
    );

    expect(dedicatedSectionPropsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ createDraftPurpose: null }),
    );
  });

  it('将无参数和旧版深链统一收敛到空白封业务编辑器', async () => {
    requirePermissionMock.mockResolvedValue({ id: 'admin-1', role: Role.ADMIN });
    redirectMock.mockImplementation((href: string) => {
      throw new Error(`REDIRECT:${href}`);
    });

    await expect(
      OwnerExternalSalesChargeItemsPage({
        searchParams: Promise.resolve({}),
      }),
    ).rejects.toThrow(
      'REDIRECT:/owner/rules/customer-pricing?section=blank',
    );
    await expect(
      OwnerExternalSalesChargeItemsPage({
        searchParams: Promise.resolve({ section: 'legacy-matrix' }),
      }),
    ).rejects.toThrow(
      'REDIRECT:/owner/rules/customer-pricing?section=blank',
    );

    expect(getWorkspaceMock).not.toHaveBeenCalled();
    expect(getSectionWorkspaceMock).not.toHaveBeenCalled();
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

  it('builds the gaps section from real processing and logistics version streams', async () => {
    requirePermissionMock.mockResolvedValue({ id: 'admin-1', role: Role.ADMIN });

    const html = await renderToResolvedMarkup(
      await OwnerExternalSalesPriceBookVersionsPage({
        searchParams: Promise.resolve({ section: 'gaps' }),
      }),
    );

    expect(html).toContain('缺口清单与版本历史');
    expect(html).toContain('待处理工作队列');
    expect(html).toContain('加工费独立版本流');
    expect(html).toContain('物流费独立版本流');
    expect(html).toContain('版本号互不绑定');
    expect(html).toContain('1 份草稿待审阅');
    expect(html).toContain('2 个收费项 · 2 条规则');
    expect(html).toContain('1 / 1 条');
    expect(html).toContain('真实规则校验已通过');
    expect(html).toContain('计划第 3 版已经排期');
    expect(html).toContain(
      htmlHref(
        '/owner/rules/price-versions?section=gaps&draft=processing-draft#external-sales-price-book-version-manager',
      ),
    );
    expect(html).toContain('href="#price-book-history-PROCESSING"');
    expect(html).toContain('href="#price-book-history-LOGISTICS"');
    expect(html).not.toContain('黄金用例');
    expect(listVersionsMock).toHaveBeenCalledTimes(1);
    expect(getDraftMock).toHaveBeenCalledTimes(1);
    expect(getDraftMock).toHaveBeenCalledWith('processing-draft');
    expect(getPublishPreviewMock).toHaveBeenCalledTimes(1);
    expect(getPublishPreviewMock).toHaveBeenCalledWith('processing-draft');
  });

  it('shows real validation gaps without leaking technical rule tokens', async () => {
    requirePermissionMock.mockResolvedValue({ id: 'admin-1', role: Role.ADMIN });
    getPublishPreviewMock.mockResolvedValue({
      ...processingPublishPreview,
      validation: {
        status: 'FAIL',
        issues: [
          {
            path: 'rules[0].calculationType',
            message: 'ADD_ON / PER_BAG 配置无效',
            ruleId: 'rule-1',
          },
        ],
      },
    });

    const html = await renderToResolvedMarkup(
      await OwnerExternalSalesPriceBookVersionsPage({
        searchParams: Promise.resolve({ section: 'gaps' }),
      }),
    );

    expect(html).toContain('1 个阻断问题');
    expect(html).toContain('校验未通过，当前不能发布');
    expect(html).toContain('按实际袋数计价');
    expect(html).not.toContain('ADD_ON');
    expect(html).not.toContain('PER_BAG');
  });

  it('reuses the gaps preview when opening its full publish panel', async () => {
    requirePermissionMock.mockResolvedValue({ id: 'admin-1', role: Role.ADMIN });

    const html = await renderToResolvedMarkup(
      await OwnerExternalSalesPriceBookVersionsPage({
        searchParams: Promise.resolve({
          section: 'gaps',
          draft: 'processing-draft',
        }),
      }),
    );

    expect(html).toContain('待处理工作队列');
    expect(html).toContain('发布加工费草稿 · 第 4 版');
    expect(html).toContain('本次修改');
    expect(html).toContain('确认本次价格变更');
    expect(getDraftMock).toHaveBeenCalledTimes(1);
    expect(getPublishPreviewMock).toHaveBeenCalledTimes(1);
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
    expect(html).toContain(
      'href="/owner/rules/customer-pricing?section=blank"',
    );
    expect(html).toContain('正在加载内容');
    expect(listVersionsMock).toHaveBeenCalledTimes(1);
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
    expect(html).toContain('确认本次价格变更');
    expect(html).toContain('2 个收费项目 · 2 条规则');
    expect(html).toContain('2 条规则已通过');
    expect(html).toContain('立即生效');
    expect(html).toContain('补充发布说明（可选）');
    expect(html).toContain('彩印红包');
    expect(html).toContain('+8.3%');
    expect(html).toContain('aria-label="发布价目草稿"');
    expect(html).toContain('name="effectiveFrom"');
    expect(html).toContain('预约生效时间（上海时间）');
    expect(html).toContain(
      'name="expectedDraftUpdatedAt" value="2026-08-09T00:30:00.000Z"',
    );
    expect(html).toContain('更多草稿操作');
    expect(html).toContain('查看完整版本历史');
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

  it('redirects legacy ADMIN URLs to the workspace and publish center', async () => {
    redirectMock.mockImplementation((url: string) => {
      throw new Error(`REDIRECT:${url}`);
    });

    await expect(
      LegacyOwnerExternalSalesPriceBookPage({
        searchParams: Promise.resolve({ section: 'processing' }),
      }),
    ).rejects.toThrow(
      'REDIRECT:/owner/rules/customer-pricing?section=blank',
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
  });
});
