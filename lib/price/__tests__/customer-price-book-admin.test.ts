import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  OrderItemPricingRoute,
  Role,
} from '../../../generated/prisma/enums';
import {
  EMPTY_CUSTOMER_RULE_CONDITION_EDITOR_INPUT,
  type CustomerRuleConditionEditorInput,
} from '../customer-rule-condition';
import { ZTO_PROVINCE_OPTIONS } from '../external-order-charges';

vi.mock('server-only', () => ({}));

const { adapterMock, dbMock, MockPublishedCreateOrderPriceAdapterError } =
  vi.hoisted(() => {
    class MockPublishedCreateOrderPriceAdapterError extends Error {}
    return {
      adapterMock: {
        readCandidatePublishedCreateOrderPriceProjection: vi.fn(),
      },
      MockPublishedCreateOrderPriceAdapterError,
      dbMock: {
        $executeRaw: vi.fn(),
        $transaction: vi.fn(),
        customerPriceBook: {
          findMany: vi.fn(),
          findFirst: vi.fn(),
          findUnique: vi.fn(),
          create: vi.fn(),
          update: vi.fn(),
          updateMany: vi.fn(),
          delete: vi.fn(),
        },
        customerPriceRule: {
          findMany: vi.fn(),
          findUnique: vi.fn(),
          createMany: vi.fn(),
          update: vi.fn(),
          updateMany: vi.fn(),
          deleteMany: vi.fn(),
        },
        customerChargeCategory: {
          findMany: vi.fn(),
          findUnique: vi.fn(),
        },
        product: {
          findMany: vi.fn(),
          findUnique: vi.fn(),
        },
        craft: {
          findMany: vi.fn(),
        },
        orderCustomerCharge: { count: vi.fn() },
        businessAuditLog: { create: vi.fn() },
      },
    };
  });

vi.mock('@/lib/db', () => ({ db: dbMock }));
vi.mock('@/lib/order/create-order-published-rule-adapter', () => ({
  PublishedCreateOrderPriceAdapterError:
    MockPublishedCreateOrderPriceAdapterError,
  readCandidatePublishedCreateOrderPriceProjection:
    adapterMock.readCandidatePublishedCreateOrderPriceProjection,
}));

import {
  cancelScheduledCustomerPriceBook,
  calculateCustomerPriceRuleSetSha256,
  createCustomerPriceBookDraft,
  CustomerPriceBookAdminError,
  discardCustomerPriceBookDraft,
  getCustomerPriceBookDraftPublishPreview,
  getCustomerPriceBookDraftRuleEditor,
  listCustomerPriceBookVersionsAndDrafts,
  publishCustomerPriceBookDraft,
  prepareConfirmedCustomTierDraft,
  rescheduleCustomerPriceBook,
  updateCustomerPriceRuleDraft,
  updateCustomerPriceRuleDraftGroup,
  updateCustomerPriceSectionDraft,
  updateCustomerPriceSectionsDraft,
} from '../customer-price-book-admin';
import type { DraftPriceRuleForValidation } from '../customer-price-book-draft-validation';

const actor = {
  id: 'owner-1',
  role: Role.ADMIN,
  username: 'owner',
  displayName: '管理员',
};

const now = new Date('2026-08-09T02:00:00.000Z');
const publishAt = new Date('2026-08-10T01:30:00.000Z');

function processingMatch(
  overrides: Partial<CustomerRuleConditionEditorInput> = {},
): CustomerRuleConditionEditorInput {
  return {
    ...EMPTY_CUSTOMER_RULE_CONDITION_EDITOR_INPUT,
    pricingRoutes: [OrderItemPricingRoute.STOCK_BLANK],
    ...overrides,
  };
}

const sourceRule = {
  categoryId: 'category-base',
  productId: 'product-a',
  code: 'BASE_A',
  name: '基础报价 A',
  kind: 'BASE',
  calculationType: 'PER_PIECE',
  amount: '0.1350',
  includedUnits: null,
  incrementUnits: null,
  incrementAmount: null,
  minQty: 1,
  maxQty: 1_000,
  triggerCondition: {
    schemaVersion: 1,
    productCodes: ['PRODUCT_A'],
    pricingRoutes: [OrderItemPricingRoute.STOCK_BLANK],
  },
  exclusiveGroup: null,
  priority: 100,
  sourceSheet: '报价',
  sourceRange: 'A1:D1',
  sourceName: '报价.xlsx',
  sourceSha256: 'a'.repeat(64),
  note: null,
  blocksAutomaticQuote: false,
  isActive: true,
};

function validationRule(
  overrides: Partial<DraftPriceRuleForValidation> = {},
): DraftPriceRuleForValidation {
  return {
    id: 'draft-rule-a',
    ...sourceRule,
    code: String(sourceRule.code),
    category: {
      code: 'PRODUCT_BASE',
      name: '基础加工费',
      isActive: true,
    },
    product: { code: 'PRODUCT_A', category: 'BLANK_STOCK', isActive: true },
    ...overrides,
  };
}

function impactRule(
  amount: string,
  id: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    code: 'BASE_A',
    name: '基础报价 A',
    categoryId: 'category-base',
    productId: 'product-a',
    kind: 'BASE',
    calculationType: 'PER_PIECE',
    amount,
    includedUnits: null,
    incrementUnits: null,
    incrementAmount: null,
    minQty: 1,
    maxQty: 1_000,
    triggerCondition: { productCodes: ['PRODUCT_A'] },
    exclusiveGroup: null,
    priority: 100,
    note: null,
    blocksAutomaticQuote: false,
    isActive: true,
    category: { name: '基础加工费' },
    product: { name: '产品 A' },
    ...overrides,
  };
}

function draftNotes() {
  return {
    summary: '来源说明',
    // A cloned source may already carry the published v1 hash. A v2 draft
    // must not present that inherited top-level value as its own rule-set hash.
    ruleSetSha256: 'b'.repeat(64),
    workflow: {
      status: 'DRAFT',
      basedOn: {
        id: 'book-v1',
        code: 'EXTERNAL_SALES_PROCESSING_202608',
        version: 1,
      },
      createdBy: actor.id,
      createdAt: now.toISOString(),
      changeReason: '调整加工费',
    },
  };
}

function editableDraftRule(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: 'draft-rule-a',
    priceBookId: 'book-v2-draft',
    updatedAt: now,
    name: '基础报价 A',
    categoryId: 'category-base',
    productId: 'product-a',
    kind: 'BASE',
    calculationType: 'PER_PIECE',
    amount: '0.1350',
    includedUnits: null,
    incrementUnits: null,
    incrementAmount: null,
    minQty: 1,
    maxQty: 1_000,
    triggerCondition: {
      schemaVersion: 1,
      productCodes: ['PRODUCT_A'],
      pricingRoutes: [OrderItemPricingRoute.STOCK_BLANK],
      craftCodes: ['craft_color_print'],
    },
    exclusiveGroup: 'PRODUCT_BASE',
    priority: 100,
    note: '导入备注',
    blocksAutomaticQuote: false,
    isActive: true,
    category: { code: 'PRODUCT_BASE', name: '基础加工费' },
    priceBook: {
      id: 'book-v2-draft',
      purpose: 'PROCESSING',
      settlementType: 'EXTERNAL_SALES',
      isActive: false,
      notes: draftNotes(),
    },
    ...overrides,
  };
}

function editableGroupRule(
  id: string,
  quantity: number,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    priceBookId: 'book-v2-draft',
    updatedAt: now,
    categoryId: 'category-base',
    productId: 'product-a',
    kind: 'BASE',
    calculationType: 'FIXED_AMOUNT',
    amount: quantity === 1_000 ? '295.0000' : '420.0000',
    includedUnits: null,
    incrementUnits: null,
    incrementAmount: null,
    minQty: quantity,
    maxQty: quantity,
    triggerCondition: {
      schemaVersion: 1,
      productCodes: ['PRODUCT_A'],
      pricingRoutes: [OrderItemPricingRoute.STOCK_BLANK],
      specifications: ['大号'],
      paperTypes: ['157克双铜纸'],
    },
    exclusiveGroup: 'BASE_PROCESSING',
    priority: 100,
    sourceSheet: '彩印',
    sourceName: '报价.xlsx',
    sourceSha256: 'a'.repeat(64),
    note: '整批固定总额',
    blocksAutomaticQuote: false,
    isActive: true,
    ...overrides,
  };
}

function editableSectionRule(
  id: string,
  priceBookId: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    priceBookId,
    updatedAt: now,
    categoryId: 'category-packaging',
    productId: null,
    code: 'PACKAGING_SINGLE_STYLE_PER_BAG',
    kind: 'ADD_ON',
    calculationType: 'PER_BAG',
    amount: '0.1000',
    includedUnits: null,
    incrementUnits: null,
    incrementAmount: null,
    minQty: null,
    maxQty: null,
    triggerCondition: { schemaVersion: 1 },
    exclusiveGroup: null,
    priority: 100,
    sourceSheet: null,
    sourceName: null,
    sourceSha256: null,
    note: null,
    blocksAutomaticQuote: false,
    isActive: true,
    ...overrides,
  };
}

beforeEach(() => {
  adapterMock.readCandidatePublishedCreateOrderPriceProjection.mockReset();
  adapterMock.readCandidatePublishedCreateOrderPriceProjection.mockResolvedValue({
    snapshot: {},
    audit: {},
  });
  for (const delegate of [
    dbMock.customerPriceBook,
    dbMock.customerPriceRule,
    dbMock.customerChargeCategory,
    dbMock.product,
    dbMock.craft,
    dbMock.orderCustomerCharge,
    dbMock.businessAuditLog,
  ]) {
    for (const method of Object.values(delegate)) method.mockReset();
  }
  dbMock.$executeRaw.mockReset().mockResolvedValue(0);
  dbMock.$transaction
    .mockReset()
    .mockImplementation(
      async (callback: (tx: typeof dbMock) => Promise<unknown>) => callback(dbMock),
    );
  dbMock.businessAuditLog.create.mockResolvedValue({ id: 'audit-1' });
});

describe('customer price-book draft lifecycle', () => {
  it('builds an exact publish preview against the immutable draft baseline', async () => {
    dbMock.customerPriceBook.findUnique
      .mockResolvedValueOnce({
        id: 'book-v2-draft',
        purpose: 'PROCESSING',
        settlementType: 'EXTERNAL_SALES',
        version: 2,
        isActive: false,
        notes: draftNotes(),
        rules: [
          impactRule('0.1500', 'draft-rule-a', {
            exclusiveGroup: 'PRODUCT_SCOPE',
            priority: 110,
          }),
        ],
      })
      .mockResolvedValueOnce({
        id: 'book-v1',
        purpose: 'PROCESSING',
        settlementType: 'EXTERNAL_SALES',
        version: 1,
        rules: [impactRule('0.1350', 'current-rule-a')],
      });
    dbMock.customerPriceRule.findMany
      .mockResolvedValueOnce([validationRule({ amount: '0.1500' })])
      .mockResolvedValueOnce([validationRule()]);

    const preview = await getCustomerPriceBookDraftPublishPreview(
      'book-v2-draft',
    );

    expect(preview).toMatchObject({
      priceBookId: 'book-v2-draft',
      basedOnVersion: 1,
      totalRuleCount: 1,
      activeRuleCount: 1,
      changedItemCount: 1,
      changedRuleCount: 1,
      increasedRuleCount: 1,
      decreasedRuleCount: 0,
      highRiskRuleCount: 0,
      highRiskDeltaPercentThreshold: '50',
      deltaPercentMin: '11.1',
      deltaPercentMax: '11.1',
      validation: { status: 'PASS', issues: [] },
      changes: [
        expect.objectContaining({
          draftRuleId: 'draft-rule-a',
          name: '基础报价 A',
          direction: 'UP',
          deltaAmount: '0.015',
          deltaPercent: '11.1',
          changedFields: ['价格', '适用范围', '应用顺序'],
        }),
      ],
    });
    expect(
      adapterMock.readCandidatePublishedCreateOrderPriceProjection,
    ).toHaveBeenCalledWith(dbMock, {
      candidatePriceBookId: 'book-v2-draft',
      effectiveFrom: expect.any(Date),
      snapshotLockHeld: true,
    });
    expect(dbMock.$executeRaw).toHaveBeenCalledTimes(1);
    expect(dbMock.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      adapterMock.readCandidatePublishedCreateOrderPriceProjection.mock
        .invocationCallOrder[0]!,
    );
    expect(JSON.stringify(preview)).not.toContain('BASE_A');
    expect(JSON.stringify(preview)).not.toContain('productCodes');
  });

  it('marks a misplaced-decimal-sized change as high risk without rejecting the editable price', async () => {
    dbMock.customerPriceBook.findUnique
      .mockResolvedValueOnce({
        id: 'book-v2-draft',
        purpose: 'PROCESSING',
        settlementType: 'EXTERNAL_SALES',
        version: 2,
        isActive: false,
        notes: draftNotes(),
        rules: [impactRule('0.8000', 'draft-rule-a')],
      })
      .mockResolvedValueOnce({
        id: 'book-v1',
        purpose: 'PROCESSING',
        settlementType: 'EXTERNAL_SALES',
        version: 1,
        rules: [impactRule('0.1300', 'current-rule-a')],
      });
    dbMock.customerPriceRule.findMany
      .mockResolvedValueOnce([validationRule({ amount: '0.8000' })])
      .mockResolvedValueOnce([validationRule({ id: 'current-rule-a', amount: '0.1300' })]);

    const preview = await getCustomerPriceBookDraftPublishPreview(
      'book-v2-draft',
    );

    expect(preview).toMatchObject({
      changedRuleCount: 1,
      increasedRuleCount: 1,
      highRiskRuleCount: 1,
      highRiskDeltaPercentThreshold: '50',
      deltaPercentMax: '515.4',
      validation: { status: 'PASS' },
    });
  });

  it.each([
    { label: '无报价转有报价', currentAmount: null, draftAmount: '0.1300' },
    { label: '0 元转非零价格', currentAmount: '0.0000', draftAmount: '0.0100' },
  ])('marks $label as high risk', async ({ currentAmount, draftAmount }) => {
    dbMock.customerPriceBook.findUnique
      .mockResolvedValueOnce({
        id: 'book-v2-draft',
        purpose: 'PROCESSING',
        settlementType: 'EXTERNAL_SALES',
        version: 2,
        isActive: false,
        notes: draftNotes(),
        rules: [impactRule(draftAmount, 'draft-rule-a')],
      })
      .mockResolvedValueOnce({
        id: 'book-v1',
        purpose: 'PROCESSING',
        settlementType: 'EXTERNAL_SALES',
        version: 1,
        rules: [
          impactRule('0.0000', 'current-rule-a', {
            amount: currentAmount,
          }),
        ],
      });
    dbMock.customerPriceRule.findMany
      .mockResolvedValueOnce([
        validationRule({ amount: draftAmount }),
      ])
      .mockResolvedValueOnce([
        validationRule({ id: 'current-rule-a', amount: currentAmount }),
      ]);

    const preview = await getCustomerPriceBookDraftPublishPreview(
      'book-v2-draft',
    );

    expect(preview).toMatchObject({
      changedRuleCount: 1,
      highRiskRuleCount: 1,
      validation: { status: 'PASS' },
    });
  });

  it('marks active-rule additions as high risk because they create a new automatic quote path', async () => {
    dbMock.customerPriceBook.findUnique
      .mockResolvedValueOnce({
        id: 'book-v2-draft',
        purpose: 'PROCESSING',
        settlementType: 'EXTERNAL_SALES',
        version: 2,
        isActive: false,
        notes: draftNotes(),
        rules: [impactRule('0.1300', 'draft-rule-a')],
      })
      .mockResolvedValueOnce({
        id: 'book-v1',
        purpose: 'PROCESSING',
        settlementType: 'EXTERNAL_SALES',
        version: 1,
        rules: [],
      });
    dbMock.customerPriceRule.findMany
      .mockResolvedValueOnce([validationRule({ amount: '0.1300' })])
      .mockResolvedValueOnce([]);

    const preview = await getCustomerPriceBookDraftPublishPreview(
      'book-v2-draft',
    );

    expect(preview).toMatchObject({
      changedRuleCount: 1,
      highRiskRuleCount: 1,
      changes: [expect.objectContaining({ direction: 'ADDED' })],
      validation: { status: 'PASS' },
    });
  });

  it('fails publish preview when the draft has no semantic rule change', async () => {
    dbMock.customerPriceBook.findUnique
      .mockResolvedValueOnce({
        id: 'book-v2-draft',
        purpose: 'PROCESSING',
        settlementType: 'EXTERNAL_SALES',
        version: 2,
        isActive: false,
        notes: draftNotes(),
        rules: [impactRule('0.1350', 'draft-rule-a')],
      })
      .mockResolvedValueOnce({
        id: 'book-v1',
        purpose: 'PROCESSING',
        settlementType: 'EXTERNAL_SALES',
        version: 1,
        rules: [impactRule('0.1350', 'current-rule-a')],
      });
    dbMock.customerPriceRule.findMany
      .mockResolvedValueOnce([validationRule()])
      .mockResolvedValueOnce([validationRule({ id: 'current-rule-a' })]);

    const preview = await getCustomerPriceBookDraftPublishPreview(
      'book-v2-draft',
    );

    expect(preview).toMatchObject({
      changedItemCount: 0,
      changedRuleCount: 0,
      validation: {
        status: 'FAIL',
        issues: [
          expect.objectContaining({
            message: '草稿与当前版本没有价格或规则变化，无需发布',
          }),
        ],
      },
    });
    expect(
      adapterMock.readCandidatePublishedCreateOrderPriceProjection,
    ).not.toHaveBeenCalled();
  });

  it('fails publish preview when the candidate cannot feed create-order pricing', async () => {
    dbMock.customerPriceBook.findUnique
      .mockResolvedValueOnce({
        id: 'book-v2-draft',
        purpose: 'PROCESSING',
        settlementType: 'EXTERNAL_SALES',
        version: 2,
        isActive: false,
        notes: draftNotes(),
        rules: [impactRule('0.1500', 'draft-rule-a')],
      })
      .mockResolvedValueOnce({
        id: 'book-v1',
        purpose: 'PROCESSING',
        settlementType: 'EXTERNAL_SALES',
        version: 1,
        rules: [impactRule('0.1350', 'current-rule-a')],
      });
    dbMock.customerPriceRule.findMany
      .mockResolvedValueOnce([validationRule({ amount: '0.1500' })])
      .mockResolvedValueOnce([validationRule()]);
    adapterMock.readCandidatePublishedCreateOrderPriceProjection.mockRejectedValue(
      new MockPublishedCreateOrderPriceAdapterError('缺少局部烫金空白封单价'),
    );

    const preview = await getCustomerPriceBookDraftPublishPreview(
      'book-v2-draft',
    );

    expect(preview?.validation).toEqual({
      status: 'FAIL',
      issues: [
        {
          path: 'rules',
          message: '候选价目版本无法供建单计价：缺少局部烫金空白封单价',
        },
      ],
    });
  });

  it('copies the current book into one inactive, traceable next version', async () => {
    dbMock.customerPriceBook.findMany
      .mockResolvedValueOnce([
        {
          id: 'book-v1',
          code: 'EXTERNAL_SALES_PROCESSING_202608',
          name: '外部销售加工费',
          settlementType: 'EXTERNAL_SALES',
          purpose: 'PROCESSING',
          version: 1,
          currency: 'CNY',
          sourceName: '报价.xlsx',
          sourceSha256: 'a'.repeat(64),
          notes: { summary: '来源说明' },
          effectiveFrom: new Date('2026-08-01T00:00:00.000Z'),
          rules: [sourceRule],
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    dbMock.customerPriceBook.findFirst.mockResolvedValue({ version: 1 });
    dbMock.customerPriceBook.create.mockResolvedValue({
      id: 'book-v2-draft',
      version: 2,
      purpose: 'PROCESSING',
    });
    dbMock.customerPriceRule.createMany.mockResolvedValue({ count: 1 });
    dbMock.customerPriceRule.findMany.mockResolvedValue([validationRule()]);

    await expect(
      createCustomerPriceBookDraft(
        { purpose: 'PROCESSING', changeReason: '调整加工费' },
        actor,
        now,
      ),
    ).resolves.toEqual({
      id: 'book-v2-draft',
      version: 2,
      purpose: 'PROCESSING',
    });

    expect(dbMock.$executeRaw).toHaveBeenCalledTimes(1);
    expect(dbMock.customerPriceBook.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          version: 2,
          isActive: false,
          notes: expect.objectContaining({
            workflow: expect.objectContaining({
              status: 'DRAFT',
              basedOn: expect.objectContaining({ id: 'book-v1', version: 1 }),
              createdBy: actor.id,
              changeReason: '调整加工费',
            }),
          }),
        }),
      }),
    );
    expect(dbMock.customerPriceRule.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ priceBookId: 'book-v2-draft', code: 'BASE_A' })],
    });
  });

  it('refuses to create a second draft for the same purpose', async () => {
    dbMock.customerPriceBook.findMany
      .mockResolvedValueOnce([
        {
          id: 'book-v1',
          code: 'EXTERNAL_SALES_PROCESSING_202608',
          name: '外部销售加工费',
          settlementType: 'EXTERNAL_SALES',
          purpose: 'PROCESSING',
          version: 1,
          currency: 'CNY',
          sourceName: '报价.xlsx',
          sourceSha256: 'a'.repeat(64),
          notes: null,
          effectiveFrom: new Date('2026-08-01T00:00:00.000Z'),
          rules: [sourceRule],
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'existing-draft', notes: draftNotes() }]);

    await expect(
      createCustomerPriceBookDraft(
        { purpose: 'PROCESSING', changeReason: '再次调整' },
        actor,
        now,
      ),
    ).rejects.toThrow('该用途已有草稿版本');
    expect(dbMock.customerPriceBook.create).not.toHaveBeenCalled();
  });

  it('rejects a stale draft rule edit before any dictionary or rule write', async () => {
    dbMock.customerPriceRule.findUnique.mockResolvedValue({
      id: 'draft-rule-a',
      priceBookId: 'book-v2-draft',
      updatedAt: now,
      name: '基础报价 A',
      categoryId: 'category-base',
      productId: 'product-a',
      kind: 'BASE',
      calculationType: 'PER_PIECE',
      amount: '0.1350',
      includedUnits: null,
      incrementUnits: null,
      incrementAmount: null,
      minQty: 1,
      maxQty: 1_000,
      triggerCondition: { productCodes: ['PRODUCT_A'] },
      exclusiveGroup: null,
      priority: 100,
      note: null,
      blocksAutomaticQuote: false,
      isActive: true,
      priceBook: {
        id: 'book-v2-draft',
        purpose: 'PROCESSING',
        settlementType: 'EXTERNAL_SALES',
        isActive: false,
        notes: draftNotes(),
      },
    });

    await expect(
      updateCustomerPriceRuleDraft(
        {
          priceBookId: 'book-v2-draft',
          ruleId: 'draft-rule-a',
          expectedUpdatedAt: new Date('2026-08-09T01:59:59.999Z'),
          name: '新基础报价',
          categoryId: 'category-base',
          productId: 'product-a',
          kind: 'BASE',
          calculationType: 'PER_PIECE',
          unitsPerSheet: null,
          amount: '0.1400',
          includedUnits: null,
          incrementUnits: null,
          incrementAmount: null,
          minQty: 1,
          maxQty: 1_000,
          blocksAutomaticQuote: false,
          match: processingMatch(),
          isActive: true,
        },
        actor,
        now,
      ),
    ).rejects.toThrow('已被其他管理员修改，请刷新');

    expect(dbMock.customerChargeCategory.findUnique).not.toHaveBeenCalled();
    expect(dbMock.customerPriceRule.update).not.toHaveBeenCalled();
  });

  it('reads one safe editor DTO without returning matcher or provenance fields', async () => {
    dbMock.customerPriceRule.findUnique.mockResolvedValue(
      editableDraftRule({
        calculationType: 'PER_SHEET',
        triggerCondition: {
          schemaVersion: 1,
          productCodes: ['PRODUCT_A'],
          craftCodes: ['craft_color_print'],
          pricingRoutes: [OrderItemPricingRoute.STOCK_BLANK],
          unitsPerSheet: 4,
        },
      }),
    );
    dbMock.customerChargeCategory.findMany.mockResolvedValue([
      { id: 'category-base', name: '基础加工费' },
    ]);
    dbMock.product.findMany.mockResolvedValue([
      { id: 'product-a', name: 'A 产品' },
    ]);
    dbMock.craft.findMany.mockResolvedValue([
      { code: 'craft_color_print', name: '彩印' },
    ]);

    const editor = await getCustomerPriceBookDraftRuleEditor(
      'book-v2-draft',
      'draft-rule-a',
    );

    expect(editor).toEqual({
      context: {
        id: 'book-v2-draft',
        purpose: 'PROCESSING',
        categories: [{ id: 'category-base', name: '基础加工费' }],
        products: [{ id: 'product-a', name: 'A 产品' }],
        crafts: [{ value: 'craft_color_print', label: '彩印' }],
      },
      rule: expect.objectContaining({
        id: 'draft-rule-a',
        name: '基础报价 A',
        editorMode: 'PROCESSING',
        unitsPerSheet: 4,
        shippingScopeLabel: null,
        updatedAt: now.toISOString(),
      }),
    });
    expect(editor?.rule).not.toHaveProperty('code');
    expect(editor?.rule).not.toHaveProperty('triggerCondition');
    expect(editor?.rule).not.toHaveProperty('exclusiveGroup');
    expect(editor?.rule).not.toHaveProperty('priority');
    expect(editor?.rule).not.toHaveProperty('note');
    expect(editor?.rule).not.toHaveProperty('source');
  });

  it('does not expose an invalid sheet capacity from matcher internals', async () => {
    dbMock.customerPriceRule.findUnique.mockResolvedValue(
      editableDraftRule({
        calculationType: 'PER_SHEET',
        triggerCondition: {
          schemaVersion: 1,
          productCodes: ['PRODUCT_A'],
          pricingRoutes: [OrderItemPricingRoute.STOCK_BLANK],
          unitsPerSheet: '4',
        },
      }),
    );
    dbMock.customerChargeCategory.findMany.mockResolvedValue([]);
    dbMock.product.findMany.mockResolvedValue([]);
    dbMock.craft.findMany.mockResolvedValue([]);

    const editor = await getCustomerPriceBookDraftRuleEditor(
      'book-v2-draft',
      'draft-rule-a',
    );

    expect(editor?.rule.unitsPerSheet).toBeNull();
    expect(editor?.rule.matchValidationErrors).toContain(
      '每张成品数：设置无效，请重新选择或填写',
    );
    expect(editor?.rule).not.toHaveProperty('triggerCondition');
  });

  it('creates a product matcher when a general processing rule selects a product', async () => {
    dbMock.customerPriceRule.findUnique.mockResolvedValue(
      editableDraftRule({ productId: null, triggerCondition: null }),
    );
    dbMock.customerChargeCategory.findUnique.mockResolvedValue({
      id: 'category-base',
      code: 'PRODUCT_BASE',
    });
    dbMock.product.findUnique.mockResolvedValue({
      id: 'product-b',
      code: 'PRODUCT_B',
    });
    dbMock.customerPriceRule.update.mockResolvedValue({
      id: 'draft-rule-a',
      priceBookId: 'book-v2-draft',
    });
    dbMock.customerPriceRule.findMany.mockResolvedValue([
      validationRule({
        productId: 'product-b',
        product: { code: 'PRODUCT_B', category: 'BLANK_STOCK', isActive: true },
        triggerCondition: {
          schemaVersion: 1,
          target: 'ITEM',
          productCodes: ['PRODUCT_B'],
          pricingRoutes: [OrderItemPricingRoute.STOCK_BLANK],
        },
      }),
    ]);
    dbMock.customerPriceBook.update.mockResolvedValue({ id: 'book-v2-draft' });

    await expect(
      updateCustomerPriceRuleDraft(
        {
          priceBookId: 'book-v2-draft',
          ruleId: 'draft-rule-a',
          expectedUpdatedAt: now,
          name: '产品 B 报价',
          categoryId: 'category-base',
          productId: 'product-b',
          kind: 'BASE',
          calculationType: 'PER_PIECE',
          unitsPerSheet: null,
          amount: '0.1400',
          minQty: 1,
          maxQty: 1_000,
          blocksAutomaticQuote: false,
          match: processingMatch(),
          isActive: true,
        },
        actor,
        now,
      ),
    ).resolves.toEqual({ id: 'draft-rule-a', priceBookId: 'book-v2-draft' });

    expect(dbMock.customerPriceRule.update.mock.calls[0]![0].data).toEqual(
      expect.objectContaining({
        productId: 'product-b',
        triggerCondition: {
          schemaVersion: 1,
          target: 'ITEM',
          productCodes: ['PRODUCT_B'],
          pricingRoutes: [OrderItemPricingRoute.STOCK_BLANK],
        },
      }),
    );
  });

  it('拒绝绕过只读界面改变计价对象', async () => {
    dbMock.customerPriceRule.findUnique.mockResolvedValue(editableDraftRule());
    dbMock.customerChargeCategory.findUnique.mockResolvedValue({
      id: 'category-base',
      code: 'PRODUCT_BASE',
    });

    await expect(
      updateCustomerPriceRuleDraft(
        {
          priceBookId: 'book-v2-draft',
          ruleId: 'draft-rule-a',
          expectedUpdatedAt: now,
          name: '基础报价 A',
          categoryId: 'category-base',
          productId: 'product-a',
          kind: 'BASE',
          calculationType: 'PER_PIECE',
          unitsPerSheet: null,
          amount: '0.1400',
          minQty: 1,
          maxQty: 1_000,
          blocksAutomaticQuote: false,
          match: processingMatch({ target: 'PACKAGING_GROUP' }),
          isActive: true,
        },
        actor,
        now,
      ),
    ).rejects.toThrow('计价对象不能直接变更');

    expect(dbMock.customerPriceRule.update).not.toHaveBeenCalled();
  });

  it('adds a product matcher and saves the structured foil-pass multiplier', async () => {
    dbMock.customerPriceRule.findUnique.mockResolvedValue(
      editableDraftRule({
        productId: null,
        triggerCondition: { craftCodes: ['craft_color_print'] },
      }),
    );
    dbMock.customerChargeCategory.findUnique.mockResolvedValue({
      id: 'category-base',
      code: 'PRODUCT_BASE',
    });
    dbMock.product.findUnique.mockResolvedValue({
      id: 'product-b',
      code: 'PRODUCT_B',
    });
    dbMock.customerPriceRule.update.mockResolvedValue({
      id: 'draft-rule-a',
      priceBookId: 'book-v2-draft',
    });
    dbMock.customerPriceRule.findMany.mockResolvedValue([
      validationRule({
        productId: 'product-b',
        product: { code: 'PRODUCT_B', category: 'BLANK_STOCK', isActive: true },
        triggerCondition: {
          schemaVersion: 1,
          productCodes: ['PRODUCT_B'],
          craftCodes: ['craft_color_print'],
          pricingRoutes: [OrderItemPricingRoute.STOCK_BLANK],
          foilPassCount: 3,
          perFoilPass: true,
        },
      }),
    ]);
    dbMock.customerPriceBook.update.mockResolvedValue({ id: 'book-v2-draft' });

    await expect(
      updateCustomerPriceRuleDraft(
        {
          priceBookId: 'book-v2-draft',
          ruleId: 'draft-rule-a',
          expectedUpdatedAt: now,
          name: '新基础报价',
          categoryId: 'category-base',
          productId: 'product-b',
          kind: 'BASE',
          calculationType: 'PER_PIECE',
          unitsPerSheet: null,
          amount: '0.1400',
          minQty: 1,
          maxQty: 1_000,
          blocksAutomaticQuote: false,
          match: processingMatch({
            craftCodes: ['craft_color_print'],
            foilPassCount: 3,
            perFoilPass: true,
          }),
          isActive: true,
        },
        actor,
        now,
      ),
    ).resolves.toEqual({ id: 'draft-rule-a', priceBookId: 'book-v2-draft' });

    const data = dbMock.customerPriceRule.update.mock.calls[0]![0].data;
    expect(data).toEqual(
      expect.objectContaining({
        productId: 'product-b',
        triggerCondition: {
          schemaVersion: 1,
          target: 'ITEM',
          productCodes: ['PRODUCT_B'],
          craftCodes: ['craft_color_print'],
          pricingRoutes: [OrderItemPricingRoute.STOCK_BLANK],
          foilPassCount: 3,
          perFoilPass: true,
        },
      }),
    );
    expect(data).not.toHaveProperty('exclusiveGroup');
    expect(data).not.toHaveProperty('priority');
    expect(data).not.toHaveProperty('note');
    expect(data).not.toHaveProperty('sourceName');
  });

  it('removes only the product matcher when clearing a processing product', async () => {
    dbMock.customerPriceRule.findUnique.mockResolvedValue(editableDraftRule());
    dbMock.customerChargeCategory.findUnique.mockResolvedValue({
      id: 'category-base',
      code: 'PRODUCT_BASE',
    });
    dbMock.customerPriceRule.update.mockResolvedValue({
      id: 'draft-rule-a',
      priceBookId: 'book-v2-draft',
    });
    dbMock.customerPriceRule.findMany.mockResolvedValue([
      validationRule({
        productId: null,
        product: null,
        triggerCondition: {
          schemaVersion: 1,
          target: 'ITEM',
          craftCodes: ['craft_color_print'],
          pricingRoutes: [OrderItemPricingRoute.STOCK_BLANK],
        },
      }),
    ]);
    dbMock.customerPriceBook.update.mockResolvedValue({ id: 'book-v2-draft' });

    await expect(
      updateCustomerPriceRuleDraft(
        {
          priceBookId: 'book-v2-draft',
          ruleId: 'draft-rule-a',
          expectedUpdatedAt: now,
          name: '通用彩印报价',
          categoryId: 'category-base',
          productId: null,
          kind: 'BASE',
          calculationType: 'PER_PIECE',
          unitsPerSheet: null,
          amount: '0.1400',
          minQty: 1,
          maxQty: 1_000,
          blocksAutomaticQuote: false,
          match: processingMatch({ craftCodes: ['craft_color_print'] }),
          isActive: true,
        },
        actor,
        now,
      ),
    ).resolves.toEqual({ id: 'draft-rule-a', priceBookId: 'book-v2-draft' });

    expect(dbMock.product.findUnique).not.toHaveBeenCalled();
    const data = dbMock.customerPriceRule.update.mock.calls[0]![0].data;
    expect(data).toEqual(
      expect.objectContaining({
        productId: null,
        triggerCondition: {
          schemaVersion: 1,
          target: 'ITEM',
          craftCodes: ['craft_color_print'],
          pricingRoutes: [OrderItemPricingRoute.STOCK_BLANK],
        },
      }),
    );
    expect(data.triggerCondition).not.toHaveProperty('productCodes');
  });

  it('只改金额时保留历史多产品匹配范围', async () => {
    dbMock.customerPriceRule.findUnique.mockResolvedValue(
      editableDraftRule({
        productId: null,
        triggerCondition: {
          schemaVersion: 1,
          target: 'ITEM',
          productCodes: ['COLOR_LARGE_COPPER', 'COLOR_MEDIUM_COPPER'],
          craftCodes: ['craft_color_print'],
          pricingRoutes: [OrderItemPricingRoute.COLOR_PRINT],
        },
      }),
    );
    dbMock.customerChargeCategory.findUnique.mockResolvedValue({
      id: 'category-base',
      code: 'PRODUCT_BASE',
    });
    dbMock.customerPriceRule.update.mockResolvedValue({
      id: 'draft-rule-a',
      priceBookId: 'book-v2-draft',
    });
    dbMock.customerPriceRule.findMany.mockResolvedValue([
      validationRule({
        productId: null,
        product: null,
        amount: '0.1600',
        triggerCondition: {
          schemaVersion: 1,
          target: 'ITEM',
          productCodes: ['COLOR_LARGE_COPPER', 'COLOR_MEDIUM_COPPER'],
          craftCodes: ['craft_color_print'],
          pricingRoutes: [OrderItemPricingRoute.COLOR_PRINT],
        },
      }),
    ]);
    dbMock.customerPriceBook.update.mockResolvedValue({ id: 'book-v2-draft' });

    await updateCustomerPriceRuleDraft(
      {
        priceBookId: 'book-v2-draft',
        ruleId: 'draft-rule-a',
        expectedUpdatedAt: now,
        name: '彩印双铜纸加价',
        categoryId: 'category-base',
        productId: null,
        kind: 'ADD_ON',
        calculationType: 'PER_PIECE',
        unitsPerSheet: null,
        amount: '0.1600',
        minQty: null,
        maxQty: null,
        blocksAutomaticQuote: false,
        match: processingMatch({
          craftCodes: ['craft_color_print'],
          pricingRoutes: [OrderItemPricingRoute.COLOR_PRINT],
        }),
        isActive: true,
      },
      actor,
      now,
    );

    expect(dbMock.product.findUnique).not.toHaveBeenCalled();
    expect(dbMock.customerPriceRule.update.mock.calls[0]![0].data).toEqual(
      expect.objectContaining({
        amount: '0.1600',
        triggerCondition: {
          schemaVersion: 1,
          target: 'ITEM',
          productCodes: ['COLOR_LARGE_COPPER', 'COLOR_MEDIUM_COPPER'],
          craftCodes: ['craft_color_print'],
          pricingRoutes: [OrderItemPricingRoute.COLOR_PRINT],
        },
      }),
    );
  });

  it('updates sheet capacity while preserving the other processing matchers', async () => {
    dbMock.customerPriceRule.findUnique.mockResolvedValue(
      editableDraftRule({
        calculationType: 'PER_SHEET',
        triggerCondition: {
          productCodes: ['PRODUCT_A'],
          craftCodes: ['craft_color_print'],
          unitsPerSheet: 2,
        },
      }),
    );
    dbMock.customerChargeCategory.findUnique.mockResolvedValue({
      id: 'category-base',
      code: 'PRODUCT_BASE',
    });
    dbMock.product.findUnique.mockResolvedValue({
      id: 'product-a',
      code: 'PRODUCT_A',
    });
    dbMock.customerPriceRule.update.mockResolvedValue({
      id: 'draft-rule-a',
      priceBookId: 'book-v2-draft',
    });
    dbMock.customerPriceRule.findMany.mockResolvedValue([
      validationRule({
        calculationType: 'PER_SHEET',
        triggerCondition: {
          schemaVersion: 1,
          target: 'ITEM',
          productCodes: ['PRODUCT_A'],
          craftCodes: ['craft_color_print'],
          pricingRoutes: [OrderItemPricingRoute.STOCK_BLANK],
          unitsPerSheet: 4,
        },
      }),
    ]);
    dbMock.customerPriceBook.update.mockResolvedValue({ id: 'book-v2-draft' });

    await updateCustomerPriceRuleDraft(
      {
        priceBookId: 'book-v2-draft',
        ruleId: 'draft-rule-a',
        expectedUpdatedAt: now,
        name: '每张 4 个',
        categoryId: 'category-base',
        productId: 'product-a',
        kind: 'BASE',
        calculationType: 'PER_SHEET',
        unitsPerSheet: 4,
        amount: '0.1400',
        minQty: 1,
        maxQty: 1_000,
        blocksAutomaticQuote: false,
        match: processingMatch({ craftCodes: ['craft_color_print'] }),
        isActive: true,
      },
      actor,
      now,
    );

    expect(dbMock.customerPriceRule.update.mock.calls[0]![0].data).toEqual(
      expect.objectContaining({
        calculationType: 'PER_SHEET',
        triggerCondition: {
          schemaVersion: 1,
          target: 'ITEM',
          productCodes: ['PRODUCT_A'],
          craftCodes: ['craft_color_print'],
          pricingRoutes: [OrderItemPricingRoute.STOCK_BLANK],
          unitsPerSheet: 4,
        },
      }),
    );
  });

  it('removes only sheet capacity when switching away from per-sheet pricing', async () => {
    dbMock.customerPriceRule.findUnique.mockResolvedValue(
      editableDraftRule({
        calculationType: 'PER_SHEET',
        triggerCondition: {
          productCodes: ['PRODUCT_A'],
          craftCodes: ['craft_color_print'],
          unitsPerSheet: 4,
        },
      }),
    );
    dbMock.customerChargeCategory.findUnique.mockResolvedValue({
      id: 'category-base',
      code: 'PRODUCT_BASE',
    });
    dbMock.product.findUnique.mockResolvedValue({
      id: 'product-a',
      code: 'PRODUCT_A',
    });
    dbMock.customerPriceRule.update.mockResolvedValue({
      id: 'draft-rule-a',
      priceBookId: 'book-v2-draft',
    });
    dbMock.customerPriceRule.findMany.mockResolvedValue([
      validationRule({
        calculationType: 'PER_PIECE',
        triggerCondition: {
          schemaVersion: 1,
          productCodes: ['PRODUCT_A'],
          craftCodes: ['craft_color_print'],
          pricingRoutes: [OrderItemPricingRoute.STOCK_BLANK],
        },
      }),
    ]);
    dbMock.customerPriceBook.update.mockResolvedValue({ id: 'book-v2-draft' });

    await updateCustomerPriceRuleDraft(
      {
        priceBookId: 'book-v2-draft',
        ruleId: 'draft-rule-a',
        expectedUpdatedAt: now,
        name: '按个计价',
        categoryId: 'category-base',
        productId: 'product-a',
        kind: 'BASE',
        calculationType: 'PER_PIECE',
        unitsPerSheet: null,
        amount: '0.1400',
        minQty: 1,
        maxQty: 1_000,
        blocksAutomaticQuote: false,
        match: processingMatch({ craftCodes: ['craft_color_print'] }),
        isActive: true,
      },
      actor,
      now,
    );

    const triggerCondition =
      dbMock.customerPriceRule.update.mock.calls[0]![0].data.triggerCondition;
    expect(triggerCondition).toEqual({
      schemaVersion: 1,
      target: 'ITEM',
      productCodes: ['PRODUCT_A'],
      craftCodes: ['craft_color_print'],
      pricingRoutes: [OrderItemPricingRoute.STOCK_BLANK],
    });
    expect(triggerCondition).not.toHaveProperty('unitsPerSheet');
  });

  it('rejects a non-positive sheet capacity inside the write-locked DAL', async () => {
    dbMock.customerPriceRule.findUnique.mockResolvedValue(editableDraftRule());
    dbMock.customerChargeCategory.findUnique.mockResolvedValue({
      id: 'category-base',
      code: 'PRODUCT_BASE',
    });
    dbMock.product.findUnique.mockResolvedValue({
      id: 'product-a',
      code: 'PRODUCT_A',
    });

    await expect(
      updateCustomerPriceRuleDraft(
        {
          priceBookId: 'book-v2-draft',
          ruleId: 'draft-rule-a',
          expectedUpdatedAt: now,
          name: '非法按张计价',
          categoryId: 'category-base',
          productId: 'product-a',
          kind: 'BASE',
          calculationType: 'PER_SHEET',
          unitsPerSheet: 0,
          amount: '0.1400',
          minQty: 1,
          maxQty: 1_000,
          blocksAutomaticQuote: false,
          match: processingMatch(),
          isActive: true,
        },
        actor,
        now,
      ),
    ).rejects.toThrow('正整数的每张含几个');

    expect(dbMock.$executeRaw).toHaveBeenCalledTimes(1);
    expect(dbMock.customerPriceRule.update).not.toHaveBeenCalled();
  });

  it('preserves logistics matching internals while editing visible weight prices', async () => {
    dbMock.customerPriceRule.findUnique.mockResolvedValue(
      editableDraftRule({
        productId: null,
        kind: 'ADD_ON',
        calculationType: 'FIXED_AMOUNT',
        triggerCondition: {
          carrierCode: 'ZTO',
          provinces: [...ZTO_PROVINCE_OPTIONS],
        },
        category: { code: 'SHIPPING_FEE', name: '快递费' },
        priceBook: {
          id: 'book-v2-draft',
          purpose: 'LOGISTICS',
          settlementType: 'EXTERNAL_SALES',
          isActive: false,
          notes: draftNotes(),
        },
      }),
    );
    dbMock.customerPriceRule.update.mockResolvedValue({
      id: 'draft-rule-a',
      priceBookId: 'book-v2-draft',
    });
    dbMock.customerPriceRule.findMany.mockResolvedValue([
      validationRule({
        id: 'shipping-a',
        code: 'ZTO_A',
        name: '中通 A 区',
        kind: 'ADD_ON',
        calculationType: 'FIXED_AMOUNT',
        amount: '3.0000',
        includedUnits: '1.000',
        incrementUnits: '1.000',
        incrementAmount: '1.5000',
        minQty: null,
        maxQty: null,
        triggerCondition: {
          carrierCode: 'ZTO',
          provinces: [...ZTO_PROVINCE_OPTIONS],
        },
        exclusiveGroup: 'ZTO_PROVINCE_RATE',
        productId: null,
        product: null,
        category: {
          code: 'SHIPPING_FEE',
          name: '快递费',
          isActive: true,
        },
      }),
      validationRule({
        id: 'packaging-a',
        code: 'PACK_A',
        name: '耗材 1–500',
        kind: 'ADD_ON',
        calculationType: 'FIXED_AMOUNT',
        amount: '1.0000',
        includedUnits: null,
        incrementUnits: null,
        incrementAmount: null,
        minQty: 1,
        maxQty: 5_000,
        triggerCondition: {
          scope: 'ORDER_TOTAL_QUANTITY',
          segmentedAboveMaximum: true,
        },
        exclusiveGroup: 'CARTON_ORDER_QUANTITY_TIER',
        productId: null,
        product: null,
        blocksAutomaticQuote: false,
        category: {
          code: 'PACKING_MATERIAL',
          name: '打包耗材',
          isActive: true,
        },
      }),
    ]);
    dbMock.customerPriceBook.update.mockResolvedValue({ id: 'book-v2-draft' });

    await updateCustomerPriceRuleDraft(
      {
        priceBookId: 'book-v2-draft',
        ruleId: 'draft-rule-a',
        expectedUpdatedAt: now,
        name: '广东中通快递费',
        amount: '3.0000',
        includedUnits: '1',
        incrementUnits: '1',
        incrementAmount: '1.5',
        isActive: true,
      },
      actor,
      now,
    );

    const data = dbMock.customerPriceRule.update.mock.calls[0]![0].data;
    expect(data).toEqual(
      expect.objectContaining({
        amount: '3.0000',
        includedUnits: '1',
        incrementUnits: '1',
        incrementAmount: '1.5',
      }),
    );
    expect(data).not.toHaveProperty('triggerCondition');
    expect(data).not.toHaveProperty('categoryId');
    expect(data).not.toHaveProperty('productId');
    expect(data).not.toHaveProperty('kind');
    expect(data).not.toHaveProperty('calculationType');
  });

  it('atomically updates every row in one complete processing-product ladder', async () => {
    const first = editableGroupRule('draft-rule-a', 1_000, {
      priceBook: {
        id: 'book-v2-draft',
        purpose: 'PROCESSING',
        settlementType: 'EXTERNAL_SALES',
        isActive: false,
        notes: draftNotes(),
      },
    });
    const second = editableGroupRule('draft-rule-b', 2_000);
    dbMock.customerPriceRule.findUnique.mockResolvedValue(first);
    dbMock.customerPriceRule.findMany
      .mockResolvedValueOnce([first, second])
      .mockResolvedValueOnce([
        validationRule({
          id: 'draft-rule-a',
          calculationType: 'FIXED_AMOUNT',
          amount: '300.0000',
          minQty: 1_000,
          maxQty: 1_000,
        }),
        validationRule({
          id: 'draft-rule-b',
          code: 'BASE_B',
          calculationType: 'FIXED_AMOUNT',
          amount: '430.0000',
          minQty: 2_000,
          maxQty: 2_000,
        }),
      ]);
    dbMock.customerPriceRule.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });
    dbMock.customerPriceBook.update.mockResolvedValue({
      id: 'book-v2-draft',
    });

    await expect(
      updateCustomerPriceRuleDraftGroup(
        {
          priceBookId: 'book-v2-draft',
          anchorRuleId: 'draft-rule-a',
          rows: [
            {
              ruleId: 'draft-rule-a',
              expectedUpdatedAt: now,
              amount: '300.0000',
              isActive: true,
            },
            {
              ruleId: 'draft-rule-b',
              expectedUpdatedAt: now,
              amount: '430.0000',
              isActive: false,
            },
          ],
        },
        actor,
        now,
      ),
    ).resolves.toEqual({
      priceBookId: 'book-v2-draft',
      ruleIds: ['draft-rule-a', 'draft-rule-b'],
    });

    expect(dbMock.$executeRaw).toHaveBeenCalledTimes(1);
    expect(dbMock.customerPriceRule.updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        id: 'draft-rule-a',
        priceBookId: 'book-v2-draft',
        updatedAt: now,
      },
      data: {
        amount: expect.objectContaining({}),
        isActive: true,
        updatedAt: now,
      },
    });
    expect(dbMock.customerPriceRule.updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        id: 'draft-rule-b',
        priceBookId: 'book-v2-draft',
        updatedAt: now,
      },
      data: {
        amount: expect.objectContaining({}),
        isActive: false,
        updatedAt: now,
      },
    });
    expect(
      dbMock.customerPriceRule.updateMany.mock.calls[0]![0].data.amount.toString(),
    ).toBe('300');
    expect(
      dbMock.customerPriceRule.updateMany.mock.calls[1]![0].data.amount.toString(),
    ).toBe('430');
    for (const [args] of dbMock.customerPriceRule.updateMany.mock.calls) {
      expect(args.data).not.toHaveProperty('triggerCondition');
      expect(args.data).not.toHaveProperty('code');
      expect(args.data).not.toHaveProperty('sourceRange');
      expect(args.data).not.toHaveProperty('minQty');
      expect(args.data).not.toHaveProperty('maxQty');
    }
    expect(dbMock.customerPriceRule.findMany).toHaveBeenCalledTimes(2);
    expect(dbMock.businessAuditLog.create).toHaveBeenCalledTimes(3);
    expect(dbMock.customerPriceBook.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'book-v2-draft' },
        data: expect.objectContaining({
          updatedAt: now,
          notes: expect.objectContaining({
            workflow: expect.objectContaining({
              lastEditedBy: actor.id,
              lastEditedAt: now.toISOString(),
            }),
          }),
        }),
      }),
    );
  });

  it('treats reordered trigger matcher arrays as the same atomic price ladder', async () => {
    const first = editableGroupRule('draft-rule-a', 1_000, {
      triggerCondition: {
        schemaVersion: 1,
        productCodes: ['PRODUCT_A', 'PRODUCT_ALIAS'],
        pricingRoutes: [OrderItemPricingRoute.STOCK_BLANK],
        specifications: ['大号', '非标'],
        paperTypes: ['157克双铜纸', '铜版纸'],
      },
      priceBook: {
        id: 'book-v2-draft',
        purpose: 'PROCESSING',
        settlementType: 'EXTERNAL_SALES',
        isActive: false,
        notes: draftNotes(),
      },
    });
    const second = editableGroupRule('draft-rule-b', 2_000, {
      triggerCondition: {
        schemaVersion: 1,
        paperTypes: ['铜版纸', '157克双铜纸'],
        pricingRoutes: [OrderItemPricingRoute.STOCK_BLANK],
        specifications: ['非标', '大号'],
        productCodes: ['PRODUCT_ALIAS', 'PRODUCT_A'],
      },
    });
    dbMock.customerPriceRule.findUnique.mockResolvedValue(first);
    dbMock.customerPriceRule.findMany
      .mockResolvedValueOnce([first, second])
      .mockResolvedValueOnce([
        validationRule({
          id: 'draft-rule-a',
          calculationType: 'FIXED_AMOUNT',
          amount: '300.0000',
          minQty: 1_000,
          maxQty: 1_000,
        }),
        validationRule({
          id: 'draft-rule-b',
          code: 'BASE_B',
          calculationType: 'FIXED_AMOUNT',
          amount: '430.0000',
          minQty: 2_000,
          maxQty: 2_000,
        }),
      ]);
    dbMock.customerPriceRule.updateMany.mockResolvedValue({ count: 1 });
    dbMock.customerPriceBook.update.mockResolvedValue({
      id: 'book-v2-draft',
    });

    await expect(
      updateCustomerPriceRuleDraftGroup(
        {
          priceBookId: 'book-v2-draft',
          anchorRuleId: 'draft-rule-a',
          rows: [
            {
              ruleId: 'draft-rule-a',
              expectedUpdatedAt: now,
              amount: '300.0000',
              isActive: true,
            },
            {
              ruleId: 'draft-rule-b',
              expectedUpdatedAt: now,
              amount: '430.0000',
              isActive: true,
            },
          ],
        },
        actor,
        now,
      ),
    ).resolves.toEqual({
      priceBookId: 'book-v2-draft',
      ruleIds: ['draft-rule-a', 'draft-rule-b'],
    });

    expect(dbMock.customerPriceRule.updateMany).toHaveBeenCalledTimes(2);
    expect(dbMock.customerPriceRule.findMany).toHaveBeenCalledTimes(2);
  });

  it('rejects an incomplete or mixed ladder before writing any row', async () => {
    const first = editableGroupRule('draft-rule-a', 1_000, {
      priceBook: {
        id: 'book-v2-draft',
        purpose: 'PROCESSING',
        settlementType: 'EXTERNAL_SALES',
        isActive: false,
        notes: draftNotes(),
      },
    });
    const second = editableGroupRule('draft-rule-b', 2_000);
    dbMock.customerPriceRule.findUnique.mockResolvedValue(first);
    dbMock.customerPriceRule.findMany.mockResolvedValue([first, second]);

    await expect(
      updateCustomerPriceRuleDraftGroup(
        {
          priceBookId: 'book-v2-draft',
          anchorRuleId: 'draft-rule-a',
          rows: [
            {
              ruleId: 'draft-rule-a',
              expectedUpdatedAt: now,
              amount: '300.0000',
              isActive: true,
            },
          ],
        },
        actor,
        now,
      ),
    ).rejects.toThrow('价格阶梯已变化，请刷新后重试');

    expect(dbMock.customerPriceRule.updateMany).not.toHaveBeenCalled();
    expect(dbMock.customerPriceBook.update).not.toHaveBeenCalled();
    expect(dbMock.businessAuditLog.create).not.toHaveBeenCalled();
  });

  it('does not group visually similar tiers from a different source or note', async () => {
    const first = editableGroupRule('draft-rule-a', 1_000, {
      priceBook: {
        id: 'book-v2-draft',
        purpose: 'PROCESSING',
        settlementType: 'EXTERNAL_SALES',
        isActive: false,
        notes: draftNotes(),
      },
    });
    const foreign = editableGroupRule('draft-rule-b', 2_000, {
      sourceSheet: '补充报价',
      sourceSha256: 'c'.repeat(64),
      note: '临时特价',
    });
    dbMock.customerPriceRule.findUnique.mockResolvedValue(first);
    dbMock.customerPriceRule.findMany.mockResolvedValue([first, foreign]);

    await expect(
      updateCustomerPriceRuleDraftGroup(
        {
          priceBookId: 'book-v2-draft',
          anchorRuleId: 'draft-rule-a',
          rows: [
            {
              ruleId: 'draft-rule-a',
              expectedUpdatedAt: now,
              amount: '300.0000',
              isActive: true,
            },
            {
              ruleId: 'draft-rule-b',
              expectedUpdatedAt: now,
              amount: '430.0000',
              isActive: true,
            },
          ],
        },
        actor,
        now,
      ),
    ).rejects.toThrow('价格阶梯已变化，请刷新后重试');

    expect(dbMock.customerPriceRule.updateMany).not.toHaveBeenCalled();
  });

  it('checks every row timestamp before starting the group writes', async () => {
    const first = editableGroupRule('draft-rule-a', 1_000, {
      priceBook: {
        id: 'book-v2-draft',
        purpose: 'PROCESSING',
        settlementType: 'EXTERNAL_SALES',
        isActive: false,
        notes: draftNotes(),
      },
    });
    const second = editableGroupRule('draft-rule-b', 2_000);
    dbMock.customerPriceRule.findUnique.mockResolvedValue(first);
    dbMock.customerPriceRule.findMany.mockResolvedValue([first, second]);

    await expect(
      updateCustomerPriceRuleDraftGroup(
        {
          priceBookId: 'book-v2-draft',
          anchorRuleId: 'draft-rule-a',
          rows: [
            {
              ruleId: 'draft-rule-a',
              expectedUpdatedAt: now,
              amount: '300.0000',
              isActive: true,
            },
            {
              ruleId: 'draft-rule-b',
              expectedUpdatedAt: new Date(now.getTime() - 1),
              amount: '430.0000',
              isActive: true,
            },
          ],
        },
        actor,
        now,
      ),
    ).rejects.toThrow('已被其他管理员修改，请刷新后重试');

    expect(dbMock.customerPriceRule.updateMany).not.toHaveBeenCalled();
    expect(dbMock.customerPriceBook.update).not.toHaveBeenCalled();
  });

  it('turns a conditional row-write miss into a transaction error before validation or audit', async () => {
    const first = editableGroupRule('draft-rule-a', 1_000, {
      priceBook: {
        id: 'book-v2-draft',
        purpose: 'PROCESSING',
        settlementType: 'EXTERNAL_SALES',
        isActive: false,
        notes: draftNotes(),
      },
    });
    const second = editableGroupRule('draft-rule-b', 2_000);
    dbMock.customerPriceRule.findUnique.mockResolvedValue(first);
    dbMock.customerPriceRule.findMany.mockResolvedValue([first, second]);
    dbMock.customerPriceRule.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    await expect(
      updateCustomerPriceRuleDraftGroup(
        {
          priceBookId: 'book-v2-draft',
          anchorRuleId: 'draft-rule-a',
          rows: [
            {
              ruleId: 'draft-rule-a',
              expectedUpdatedAt: now,
              amount: '300.0000',
              isActive: true,
            },
            {
              ruleId: 'draft-rule-b',
              expectedUpdatedAt: now,
              amount: '430.0000',
              isActive: true,
            },
          ],
        },
        actor,
        now,
      ),
    ).rejects.toThrow('已被其他管理员修改，请刷新后重试');

    // In PostgreSQL the thrown callback rolls both row writes back. These
    // assertions also prove validation/audit/book timestamps cannot commit.
    expect(dbMock.customerPriceRule.findMany).toHaveBeenCalledTimes(1);
    expect(dbMock.customerPriceBook.update).not.toHaveBeenCalled();
    expect(dbMock.businessAuditLog.create).not.toHaveBeenCalled();
  });

  it('在一个事务内预检所有价目簿，第二本过期时第一本零写入', async () => {
    const processingRule = editableSectionRule(
      'processing-packaging-rule',
      'processing-draft',
    );
    const logisticsRule = editableSectionRule(
      'logistics-carton-rule',
      'logistics-draft',
      {
        code: 'PACKAGING_CARTON_QTY_1_100',
        calculationType: 'FIXED_AMOUNT',
        minQty: 1,
        maxQty: 100,
        exclusiveGroup: 'CARTON_ORDER_QUANTITY_TIER',
      },
    );
    dbMock.customerPriceBook.findUnique
      .mockResolvedValueOnce({
        id: 'processing-draft',
        purpose: 'PROCESSING',
        settlementType: 'EXTERNAL_SALES',
        isActive: false,
        notes: draftNotes(),
      })
      .mockResolvedValueOnce({
        id: 'logistics-draft',
        purpose: 'LOGISTICS',
        settlementType: 'EXTERNAL_SALES',
        isActive: false,
        notes: draftNotes(),
      });
    dbMock.customerPriceRule.findMany
      .mockResolvedValueOnce([processingRule])
      .mockResolvedValueOnce([logisticsRule]);

    await expect(
      updateCustomerPriceSectionsDraft(
        [
          {
            priceBookId: 'processing-draft',
            section: 'ship',
            rows: [
              {
                ruleId: 'processing-packaging-rule',
                expectedUpdatedAt: now,
                amount: '0.1200',
                minQty: null,
                maxQty: null,
                includedUnits: null,
                incrementUnits: null,
                incrementAmount: null,
              },
            ],
          },
          {
            priceBookId: 'logistics-draft',
            section: 'ship',
            rows: [
              {
                ruleId: 'logistics-carton-rule',
                expectedUpdatedAt: new Date(now.getTime() - 1),
                amount: '5.0000',
                minQty: 1,
                maxQty: 100,
                includedUnits: null,
                incrementUnits: null,
                incrementAmount: null,
              },
            ],
          },
        ],
        actor,
        now,
      ),
    ).rejects.toThrow('价格已被其他管理员修改，请刷新后重试');

    expect(dbMock.$transaction).toHaveBeenCalledTimes(1);
    expect(dbMock.$executeRaw).toHaveBeenCalledTimes(1);
    expect(dbMock.customerPriceRule.updateMany).not.toHaveBeenCalled();
    expect(dbMock.customerPriceBook.update).not.toHaveBeenCalled();
    expect(dbMock.businessAuditLog.create).not.toHaveBeenCalled();
  });

  it.each([false, true])('十档上界保存保留整板块保护，非法断层=%s', async (invalid) => {
    const upper = [750, 1500, 2500, 3500, 4500, 7500, 15000, 25000, 40000, null];
    const sectionRules = Array.from({ length: 5 }, (_, product) => upper.map((maxQty, tier) =>
      editableSectionRule(`tier-${product}-${tier}`, 'processing-draft', {
        productId: `custom-${product}`, exclusiveGroup: 'CUSTOM_BASE', kind: 'BASE',
        calculationType: 'PER_PIECE', code: `CUSTOM_${product}_${tier}`,
        minQty: tier === 0 ? 1 : upper[tier - 1]! + 1, maxQty, amount: '0.1800',
      }),
    )).flat();
    dbMock.customerPriceBook.findUnique.mockResolvedValue({
      id: 'processing-draft', purpose: 'PROCESSING', settlementType: 'EXTERNAL_SALES',
      isActive: false, notes: draftNotes(),
    });
    dbMock.customerPriceRule.findMany.mockResolvedValueOnce(sectionRules)
      .mockResolvedValueOnce([validationRule()]);
    dbMock.customerPriceRule.updateMany.mockResolvedValue({ count: 1 });
    dbMock.customerPriceBook.update.mockResolvedValue({ id: 'processing-draft' });
    const rows = sectionRules.map((rule, index) => ({
      ruleId: rule.id as string, expectedUpdatedAt: now, amount: '0.1800',
      minQty: index % 10 === 9 ? (invalid ? 42002 : 42001) : rule.minQty as number,
      maxQty: index % 10 === 8 ? 42000 : rule.maxQty as number | null,
      includedUnits: null, incrementUnits: null, incrementAmount: null,
    }));
    const operation = updateCustomerPriceSectionDraft({
      priceBookId: 'processing-draft', section: 'tiers', rows,
    }, actor, now);
    if (invalid) {
      await expect(operation).rejects.toThrow('阶梯上界');
      expect(dbMock.customerPriceRule.updateMany).not.toHaveBeenCalled();
      expect(dbMock.businessAuditLog.create).not.toHaveBeenCalled();
    } else {
      await expect(operation).resolves.toMatchObject({ priceBookId: 'processing-draft' });
      expect(dbMock.customerPriceRule.updateMany).toHaveBeenCalledTimes(20);
      expect(dbMock.customerPriceRule.updateMany.mock.calls.slice(0, 10).every(([call]) => call.data.isActive === false)).toBe(true);
      expect(dbMock.customerPriceRule.updateMany.mock.calls.slice(10).every(([call]) => call.data.isActive === true)).toBe(true);
      expect(dbMock.businessAuditLog.create).toHaveBeenCalled();
    }
    expect(dbMock.$transaction).toHaveBeenCalledTimes(1);
  });

  it('保留单本业务板块入口并仅开启一个事务', async () => {
    const sectionRule = editableSectionRule(
      'stock-base-rule',
      'processing-draft',
      {
        categoryId: 'category-base',
        productId: 'product-a',
        code: 'BASE_A',
        kind: 'BASE',
        calculationType: 'PER_PIECE',
        amount: '0.1350',
        minQty: 1,
        maxQty: 1_000,
        exclusiveGroup: 'STOCK_BASE',
      },
    );
    dbMock.customerPriceBook.findUnique.mockResolvedValue({
      id: 'processing-draft',
      purpose: 'PROCESSING',
      settlementType: 'EXTERNAL_SALES',
      isActive: false,
      notes: draftNotes(),
    });
    dbMock.customerPriceRule.findMany
      .mockResolvedValueOnce([sectionRule])
      .mockResolvedValueOnce([validationRule()]);
    dbMock.customerPriceRule.updateMany.mockResolvedValue({ count: 1 });
    dbMock.customerPriceBook.update.mockResolvedValue({
      id: 'processing-draft',
    });

    await expect(
      updateCustomerPriceSectionDraft(
        {
          priceBookId: 'processing-draft',
          section: 'blank',
          rows: [
            {
              ruleId: 'stock-base-rule',
              expectedUpdatedAt: now,
              amount: '0.1500',
              minQty: 1,
              maxQty: 1_000,
              includedUnits: null,
              incrementUnits: null,
              incrementAmount: null,
            },
          ],
        },
        actor,
        now,
      ),
    ).resolves.toEqual({
      priceBookId: 'processing-draft',
      ruleIds: ['stock-base-rule'],
    });

    expect(dbMock.$transaction).toHaveBeenCalledTimes(1);
    expect(dbMock.customerPriceRule.updateMany).toHaveBeenCalledTimes(1);
    expect(dbMock.customerPriceBook.update).toHaveBeenCalledTimes(1);
  });

  it('整板块保存只写入并审计真实变化行', async () => {
    const unchanged = editableSectionRule(
      'packaging-single',
      'processing-draft',
    );
    const changed = editableSectionRule(
      'packaging-mixed',
      'processing-draft',
      {
        code: 'PACKAGING_MIXED_STYLE_PER_BAG',
        amount: '0.1200',
      },
    );
    dbMock.customerPriceBook.findUnique.mockResolvedValue({
      id: 'processing-draft',
      purpose: 'PROCESSING',
      settlementType: 'EXTERNAL_SALES',
      isActive: false,
      notes: draftNotes(),
    });
    dbMock.customerPriceRule.findMany
      .mockResolvedValueOnce([unchanged, changed])
      .mockResolvedValueOnce([validationRule()]);
    dbMock.customerPriceRule.updateMany.mockResolvedValue({ count: 1 });
    dbMock.customerPriceBook.update.mockResolvedValue({
      id: 'processing-draft',
    });

    await expect(
      updateCustomerPriceSectionDraft(
        {
          priceBookId: 'processing-draft',
          section: 'ship',
          rows: [
            {
              ruleId: 'packaging-single',
              expectedUpdatedAt: now,
              amount: '0.1000',
              minQty: null,
              maxQty: null,
              includedUnits: null,
              incrementUnits: null,
              incrementAmount: null,
            },
            {
              ruleId: 'packaging-mixed',
              expectedUpdatedAt: now,
              amount: '0.1800',
              minQty: null,
              maxQty: null,
              includedUnits: null,
              incrementUnits: null,
              incrementAmount: null,
            },
          ],
        },
        actor,
        now,
      ),
    ).resolves.toEqual({
      priceBookId: 'processing-draft',
      ruleIds: ['packaging-mixed'],
    });

    expect(dbMock.customerPriceRule.updateMany).toHaveBeenCalledTimes(1);
    expect(dbMock.customerPriceRule.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'packaging-mixed' }),
      }),
    );
    expect(dbMock.businessAuditLog.create).toHaveBeenCalledTimes(2);
    expect(dbMock.businessAuditLog.create).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          requestMetadata: expect.objectContaining({ changedRuleCount: 1 }),
        }),
      }),
    );
  });

  it('does not create an unpublishable draft behind a scheduled version', async () => {
    dbMock.customerPriceBook.findMany
      .mockResolvedValueOnce([
        {
          id: 'book-v1',
          code: 'EXTERNAL_SALES_PROCESSING_202608',
          name: '外部销售加工费',
          settlementType: 'EXTERNAL_SALES',
          purpose: 'PROCESSING',
          version: 1,
          currency: 'CNY',
          sourceName: '报价.xlsx',
          sourceSha256: 'a'.repeat(64),
          notes: null,
          effectiveFrom: new Date('2026-08-01T00:00:00.000Z'),
          rules: [sourceRule],
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'book-v2-scheduled',
          version: 2,
          effectiveFrom: publishAt,
        },
      ]);

    await expect(
      createCustomerPriceBookDraft(
        { purpose: 'PROCESSING', changeReason: '再次调整' },
        actor,
        now,
      ),
    ).rejects.toThrow('已有待生效版本');
    expect(dbMock.customerPriceBook.create).not.toHaveBeenCalled();
  });

  it('publishes by closing the old window before activating the draft', async () => {
    dbMock.customerPriceBook.findUnique.mockResolvedValue({
      id: 'book-v2-draft',
      code: 'EXTERNAL_SALES_PROCESSING_202608',
      name: '外部销售加工费',
      settlementType: 'EXTERNAL_SALES',
      purpose: 'PROCESSING',
      version: 2,
      isActive: false,
      notes: draftNotes(),
      updatedAt: now,
      rules: [impactRule('0.1500', 'draft-rule-a')],
    });
    dbMock.customerPriceRule.findMany
      .mockResolvedValueOnce([validationRule({ amount: '0.1500' })])
      .mockResolvedValueOnce([validationRule()]);
    dbMock.customerPriceBook.findMany
      .mockResolvedValueOnce([
        {
          id: 'book-v1',
          code: 'EXTERNAL_SALES_PROCESSING_202608',
          version: 1,
          effectiveFrom: new Date('2026-08-01T00:00:00.000Z'),
          effectiveTo: null,
          rules: [impactRule('0.1350', 'current-rule-a')],
        },
      ])
      .mockResolvedValueOnce([]);
    dbMock.customerPriceBook.update.mockImplementation(
      async (args: { where: { id: string } }) =>
        args.where.id === 'book-v1'
          ? { id: 'book-v1' }
          : { id: 'book-v2-draft', version: 2, purpose: 'PROCESSING' },
    );

    await expect(
      publishCustomerPriceBookDraft(
        {
          priceBookId: 'book-v2-draft',
          expectedDraftUpdatedAt: now,
          effectiveFrom: publishAt,
          publishNote: '已完成价格复核',
        },
        actor,
        now,
      ),
    ).resolves.toEqual({
      id: 'book-v2-draft',
      version: 2,
      purpose: 'PROCESSING',
    });

    expect(dbMock.customerPriceBook.update).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: { id: 'book-v1' },
        data: { effectiveTo: publishAt },
      }),
    );
    expect(dbMock.customerPriceBook.update).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: { id: 'book-v2-draft' },
        data: expect.objectContaining({
          effectiveFrom: publishAt,
          isActive: true,
          notes: expect.objectContaining({
            ruleSetSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
            workflow: expect.objectContaining({
              status: 'PUBLISHED',
              ruleSetSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
              publishNote: '已完成价格复核',
            }),
          }),
        }),
      }),
    );
    expect(
      adapterMock.readCandidatePublishedCreateOrderPriceProjection,
    ).toHaveBeenCalledWith(dbMock, {
      candidatePriceBookId: 'book-v2-draft',
      effectiveFrom: publishAt,
      snapshotLockHeld: true,
    });
    expect(
      adapterMock.readCandidatePublishedCreateOrderPriceProjection.mock
        .invocationCallOrder[0],
    ).toBeLessThan(dbMock.customerPriceBook.update.mock.invocationCallOrder[0]!);
    const publishAudit = dbMock.businessAuditLog.create.mock.calls[0]![0].data;
    expect(publishAudit.before).toMatchObject({
      previousVersion: {
        id: 'book-v1',
        code: 'EXTERNAL_SALES_PROCESSING_202608',
        version: 1,
        effectiveFrom: '2026-08-01T00:00:00.000Z',
        effectiveTo: null,
      },
    });
    expect(publishAudit.before.previousVersion).not.toHaveProperty('rules');
  });

  it('requires a separate locked confirmation for an abnormal price swing', async () => {
    dbMock.customerPriceBook.findUnique.mockResolvedValue({
      id: 'book-v2-draft',
      code: 'EXTERNAL_SALES_PROCESSING_202608',
      name: '外部销售加工费',
      settlementType: 'EXTERNAL_SALES',
      purpose: 'PROCESSING',
      version: 2,
      isActive: false,
      notes: draftNotes(),
      updatedAt: now,
      rules: [impactRule('0.8000', 'draft-rule-a')],
    });
    dbMock.customerPriceRule.findMany.mockResolvedValueOnce([
      validationRule({ amount: '0.8000' }),
    ]);
    dbMock.customerPriceBook.findMany.mockResolvedValueOnce([
      {
        id: 'book-v1',
        code: 'EXTERNAL_SALES_PROCESSING_202608',
        version: 1,
        effectiveFrom: new Date('2026-08-01T00:00:00.000Z'),
        effectiveTo: null,
        rules: [impactRule('0.1300', 'current-rule-a')],
      },
    ]);

    await expect(
      publishCustomerPriceBookDraft(
        {
          priceBookId: 'book-v2-draft',
          expectedDraftUpdatedAt: now,
        },
        actor,
        now,
      ),
    ).rejects.toThrow('高风险报价变更');

    expect(
      adapterMock.readCandidatePublishedCreateOrderPriceProjection,
    ).not.toHaveBeenCalled();
    expect(dbMock.customerPriceBook.update).not.toHaveBeenCalled();
    expect(dbMock.businessAuditLog.create).not.toHaveBeenCalled();
  });

  it('requires locked confirmation when a rule is enabled without changing its amount', async () => {
    dbMock.customerPriceBook.findUnique.mockResolvedValue({
      id: 'book-v2-draft',
      code: 'EXTERNAL_SALES_PROCESSING_202608',
      name: '外部销售加工费',
      settlementType: 'EXTERNAL_SALES',
      purpose: 'PROCESSING',
      version: 2,
      isActive: false,
      notes: draftNotes(),
      updatedAt: now,
      rules: [impactRule('0.1300', 'draft-rule-a')],
    });
    dbMock.customerPriceRule.findMany.mockResolvedValueOnce([
      validationRule({ amount: '0.1300' }),
    ]);
    dbMock.customerPriceBook.findMany.mockResolvedValueOnce([
      {
        id: 'book-v1',
        code: 'EXTERNAL_SALES_PROCESSING_202608',
        version: 1,
        effectiveFrom: new Date('2026-08-01T00:00:00.000Z'),
        effectiveTo: null,
        rules: [
          impactRule('0.1300', 'current-rule-a', { isActive: false }),
        ],
      },
    ]);

    await expect(
      publishCustomerPriceBookDraft(
        {
          priceBookId: 'book-v2-draft',
          expectedDraftUpdatedAt: now,
        },
        actor,
        now,
      ),
    ).rejects.toThrow('高风险报价变更');

    expect(
      adapterMock.readCandidatePublishedCreateOrderPriceProjection,
    ).not.toHaveBeenCalled();
    expect(dbMock.customerPriceBook.update).not.toHaveBeenCalled();
    expect(dbMock.businessAuditLog.create).not.toHaveBeenCalled();
  });

  it('allows the same high-risk price after explicit confirmation and audits it', async () => {
    dbMock.customerPriceBook.findUnique.mockResolvedValue({
      id: 'book-v2-draft',
      code: 'EXTERNAL_SALES_PROCESSING_202608',
      name: '外部销售加工费',
      settlementType: 'EXTERNAL_SALES',
      purpose: 'PROCESSING',
      version: 2,
      isActive: false,
      notes: draftNotes(),
      updatedAt: now,
      rules: [impactRule('0.8000', 'draft-rule-a')],
    });
    dbMock.customerPriceRule.findMany
      .mockResolvedValueOnce([validationRule({ amount: '0.8000' })])
      .mockResolvedValueOnce([
        validationRule({ id: 'current-rule-a', amount: '0.1300' }),
      ]);
    dbMock.customerPriceBook.findMany
      .mockResolvedValueOnce([
        {
          id: 'book-v1',
          code: 'EXTERNAL_SALES_PROCESSING_202608',
          version: 1,
          effectiveFrom: new Date('2026-08-01T00:00:00.000Z'),
          effectiveTo: null,
          rules: [impactRule('0.1300', 'current-rule-a')],
        },
      ])
      .mockResolvedValueOnce([]);
    dbMock.customerPriceBook.update.mockImplementation(
      async (args: { where: { id: string } }) =>
        args.where.id === 'book-v1'
          ? { id: 'book-v1' }
          : { id: 'book-v2-draft', version: 2, purpose: 'PROCESSING' },
    );

    await expect(
      publishCustomerPriceBookDraft(
        {
          priceBookId: 'book-v2-draft',
          expectedDraftUpdatedAt: now,
          confirmedHighRisk: true,
        },
        actor,
        now,
      ),
    ).resolves.toMatchObject({ id: 'book-v2-draft', version: 2 });

    expect(dbMock.businessAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          requestMetadata: expect.objectContaining({
            highRiskRuleCount: 1,
            highRiskConfirmed: true,
          }),
        }),
      }),
    );
  });

  it('samples the immediate canonical instant after the write lock and reuses the draft reason', async () => {
    const lockedNow = new Date(now.getTime() + 60_000);
    dbMock.customerPriceBook.findUnique.mockResolvedValue({
      id: 'book-v2-draft',
      code: 'EXTERNAL_SALES_PROCESSING_202608',
      name: '外部销售加工费',
      settlementType: 'EXTERNAL_SALES',
      purpose: 'PROCESSING',
      version: 2,
      isActive: false,
      notes: draftNotes(),
      updatedAt: now,
    });
    dbMock.customerPriceRule.findMany
      .mockResolvedValueOnce([validationRule({ amount: '0.1500' })])
      .mockResolvedValueOnce([validationRule()]);
    dbMock.customerPriceBook.findMany
      .mockResolvedValueOnce([
        {
          id: 'book-v1',
          code: 'EXTERNAL_SALES_PROCESSING_202608',
          version: 1,
          effectiveFrom: new Date('2026-08-01T00:00:00.000Z'),
          effectiveTo: null,
        },
      ])
      .mockResolvedValueOnce([]);
    dbMock.customerPriceBook.update.mockImplementation(
      async (args: { where: { id: string } }) =>
        args.where.id === 'book-v1'
          ? { id: 'book-v1' }
          : { id: 'book-v2-draft', version: 2, purpose: 'PROCESSING' },
    );
    vi.useFakeTimers();
    vi.setSystemTime(now);
    dbMock.$executeRaw.mockImplementationOnce(async () => {
      // Simulate waiting for another publisher. The domain must not capture
      // the request-start time before this advisory lock resolves.
      vi.setSystemTime(lockedNow);
      return 0;
    });
    try {
      await expect(
        publishCustomerPriceBookDraft(
          {
            priceBookId: 'book-v2-draft',
            expectedDraftUpdatedAt: now,
          },
          actor,
        ),
      ).resolves.toMatchObject({ id: 'book-v2-draft', version: 2 });

      expect(dbMock.customerPriceBook.update).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ data: { effectiveTo: lockedNow } }),
      );
      expect(dbMock.customerPriceBook.update).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          data: expect.objectContaining({
            effectiveFrom: lockedNow,
            notes: expect.objectContaining({
              workflow: expect.objectContaining({
                effectiveFrom: lockedNow.toISOString(),
                publishedAt: lockedNow.toISOString(),
                publishNote: '调整加工费',
              }),
            }),
          }),
        }),
      );
      expect(
        adapterMock.readCandidatePublishedCreateOrderPriceProjection,
      ).toHaveBeenCalledWith(dbMock, {
        candidatePriceBookId: 'book-v2-draft',
        effectiveFrom: lockedNow,
        snapshotLockHeld: true,
      });
      expect(dbMock.businessAuditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            after: expect.objectContaining({
              effectiveFrom: lockedNow.toISOString(),
              previousEffectiveTo: lockedNow.toISOString(),
              publishNote: '调整加工费',
            }),
          }),
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('refuses to publish a draft whose normalized rule set is unchanged', async () => {
    dbMock.customerPriceBook.findUnique.mockResolvedValue({
      id: 'book-v2-draft',
      code: 'EXTERNAL_SALES_PROCESSING_202608',
      name: '外部销售加工费',
      settlementType: 'EXTERNAL_SALES',
      purpose: 'PROCESSING',
      version: 2,
      isActive: false,
      notes: draftNotes(),
      updatedAt: now,
    });
    dbMock.customerPriceRule.findMany
      .mockResolvedValueOnce([validationRule()])
      .mockResolvedValueOnce([validationRule({ id: 'current-rule-a' })]);
    dbMock.customerPriceBook.findMany.mockResolvedValueOnce([
      {
        id: 'book-v1',
        code: 'EXTERNAL_SALES_PROCESSING_202608',
        version: 1,
        effectiveFrom: new Date('2026-08-01T00:00:00.000Z'),
        effectiveTo: null,
      },
    ]);

    await expect(
      publishCustomerPriceBookDraft(
        {
          priceBookId: 'book-v2-draft',
          expectedDraftUpdatedAt: now,
        },
        actor,
        now,
      ),
    ).rejects.toThrow('草稿与当前版本没有价格或规则变化，无需发布');

    expect(
      adapterMock.readCandidatePublishedCreateOrderPriceProjection,
    ).not.toHaveBeenCalled();
    expect(dbMock.customerPriceBook.update).not.toHaveBeenCalled();
    expect(dbMock.businessAuditLog.create).not.toHaveBeenCalled();
  });

  it('rejects an engine-incompatible candidate before changing either version window', async () => {
    dbMock.customerPriceBook.findUnique.mockResolvedValue({
      id: 'book-v2-draft',
      code: 'EXTERNAL_SALES_PROCESSING_202608',
      name: '外部销售加工费',
      settlementType: 'EXTERNAL_SALES',
      purpose: 'PROCESSING',
      version: 2,
      isActive: false,
      notes: draftNotes(),
      updatedAt: now,
    });
    dbMock.customerPriceRule.findMany
      .mockResolvedValueOnce([validationRule({ amount: '0.1500' })])
      .mockResolvedValueOnce([validationRule()]);
    dbMock.customerPriceBook.findMany
      .mockResolvedValueOnce([
        {
          id: 'book-v1',
          code: 'EXTERNAL_SALES_PROCESSING_202608',
          version: 1,
          effectiveFrom: new Date('2026-08-01T00:00:00.000Z'),
          effectiveTo: null,
        },
      ])
      .mockResolvedValueOnce([]);
    adapterMock.readCandidatePublishedCreateOrderPriceProjection.mockRejectedValue(
      new MockPublishedCreateOrderPriceAdapterError('缺少局部烫金空白封单价'),
    );

    await expect(
      publishCustomerPriceBookDraft(
        {
          priceBookId: 'book-v2-draft',
          expectedDraftUpdatedAt: now,
          effectiveFrom: publishAt,
          publishNote: '已完成价格复核',
        },
        actor,
        now,
      ),
    ).rejects.toThrow('候选价目版本无法供建单计价：缺少局部烫金空白封单价');

    expect(dbMock.customerPriceBook.update).not.toHaveBeenCalled();
    expect(dbMock.businessAuditLog.create).not.toHaveBeenCalled();
  });

  it('cancels an unreferenced future version without deleting its book or rules', async () => {
    const scheduledAt = new Date('2026-08-10T01:30:00.000Z');
    const scheduled = {
      id: 'book-v2-scheduled',
      code: 'EXTERNAL_SALES_PROCESSING_202608',
      version: 2,
      settlementType: 'EXTERNAL_SALES',
      purpose: 'PROCESSING',
      effectiveFrom: scheduledAt,
      effectiveTo: null,
      isActive: true,
      notes: { workflow: { ...draftNotes().workflow, status: 'PUBLISHED' } },
      updatedAt: now,
      _count: { rules: 145, charges: 0, priceVersionLocks: 0 },
    };
    const predecessor = {
      id: 'book-v1',
      code: scheduled.code,
      version: 1,
      effectiveFrom: new Date('2026-08-01T00:00:00.000Z'),
      effectiveTo: scheduledAt,
    };
    dbMock.customerPriceBook.findUnique.mockResolvedValue(scheduled);
    dbMock.orderCustomerCharge.count.mockResolvedValue(0);
    dbMock.customerPriceBook.findMany
      .mockResolvedValueOnce([predecessor])
      .mockResolvedValueOnce([]);
    dbMock.customerPriceBook.updateMany.mockResolvedValue({ count: 1 });
    dbMock.customerPriceBook.update.mockResolvedValue({ id: predecessor.id });

    await expect(
      cancelScheduledCustomerPriceBook(
        {
          priceBookId: scheduled.id,
          expectedUpdatedAt: now,
          reason: '价格复核尚未完成',
        },
        actor,
        now,
      ),
    ).resolves.toEqual({
      id: scheduled.id,
      version: 2,
      purpose: 'PROCESSING',
    });

    expect(dbMock.customerPriceBook.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: scheduled.id,
          updatedAt: now,
          isActive: true,
        }),
        data: expect.objectContaining({
          isActive: false,
          notes: expect.objectContaining({
            scheduleControl: expect.objectContaining({
              status: 'CANCELLED',
              reason: '价格复核尚未完成',
            }),
          }),
        }),
      }),
    );
    expect(dbMock.customerPriceBook.update).toHaveBeenCalledWith({
      where: { id: predecessor.id },
      data: { effectiveTo: null },
      select: { id: true },
    });
    expect(dbMock.customerPriceBook.delete).not.toHaveBeenCalled();
    expect(dbMock.customerPriceRule.deleteMany).not.toHaveBeenCalled();
    expect(dbMock.businessAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'CANCEL_SCHEDULED_VERSION' }),
      }),
    );
  });

  it('reschedules a future version by safely reconnecting both half-open windows', async () => {
    const oldEffectiveFrom = new Date('2026-08-10T01:30:00.000Z');
    const newEffectiveFrom = new Date('2026-08-11T01:30:00.000Z');
    const scheduled = {
      id: 'book-v2-scheduled',
      code: 'EXTERNAL_SALES_PROCESSING_202608',
      version: 2,
      settlementType: 'EXTERNAL_SALES',
      purpose: 'PROCESSING',
      effectiveFrom: oldEffectiveFrom,
      effectiveTo: null,
      isActive: true,
      notes: { workflow: { ...draftNotes().workflow, status: 'PUBLISHED' } },
      updatedAt: now,
      _count: { rules: 145, charges: 0, priceVersionLocks: 0 },
    };
    const predecessor = {
      id: 'book-v1',
      code: scheduled.code,
      version: 1,
      effectiveFrom: new Date('2026-08-01T00:00:00.000Z'),
      effectiveTo: oldEffectiveFrom,
    };
    dbMock.customerPriceBook.findUnique.mockResolvedValue(scheduled);
    dbMock.orderCustomerCharge.count.mockResolvedValue(0);
    dbMock.customerPriceBook.findMany
      .mockResolvedValueOnce([predecessor])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    dbMock.customerPriceBook.updateMany.mockResolvedValue({ count: 1 });
    dbMock.customerPriceBook.update.mockResolvedValue({ id: scheduled.id });

    await rescheduleCustomerPriceBook(
      {
        priceBookId: scheduled.id,
        expectedUpdatedAt: now,
        effectiveFrom: newEffectiveFrom,
        reason: '延后至下周统一切换',
      },
      actor,
      now,
    );

    expect(dbMock.customerPriceBook.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: scheduled.id, updatedAt: now }),
        data: { isActive: false },
      }),
    );
    expect(dbMock.customerPriceBook.update).toHaveBeenNthCalledWith(1, {
      where: { id: predecessor.id },
      data: { effectiveTo: newEffectiveFrom },
      select: { id: true },
    });
    expect(dbMock.customerPriceBook.update).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: { id: scheduled.id },
        data: expect.objectContaining({
          effectiveFrom: newEffectiveFrom,
          isActive: true,
          notes: expect.objectContaining({
            scheduleControl: expect.objectContaining({
              status: 'RESCHEDULED',
              previousEffectiveFrom: oldEffectiveFrom.toISOString(),
              effectiveFrom: newEffectiveFrom.toISOString(),
            }),
          }),
        }),
      }),
    );
    expect(
      dbMock.customerPriceBook.updateMany.mock.invocationCallOrder[0],
    ).toBeLessThan(dbMock.customerPriceBook.update.mock.invocationCallOrder[0]!);
  });

  it('fails closed before cancelling when the restored predecessor cannot be projected', async () => {
    const scheduledAt = new Date('2026-08-10T01:30:00.000Z');
    dbMock.customerPriceBook.findUnique.mockResolvedValue({
      id: 'book-v2-scheduled',
      code: 'EXTERNAL_SALES_PROCESSING_202608',
      version: 2,
      settlementType: 'EXTERNAL_SALES',
      purpose: 'PROCESSING',
      effectiveFrom: scheduledAt,
      effectiveTo: null,
      isActive: true,
      notes: null,
      updatedAt: now,
      _count: { rules: 145, charges: 0, priceVersionLocks: 0 },
    });
    dbMock.orderCustomerCharge.count.mockResolvedValue(0);
    dbMock.customerPriceBook.findMany
      .mockResolvedValueOnce([
        {
          id: 'book-v1',
          code: 'EXTERNAL_SALES_PROCESSING_202608',
          version: 1,
          effectiveFrom: new Date('2026-08-01T00:00:00.000Z'),
          effectiveTo: scheduledAt,
        },
      ])
      .mockResolvedValueOnce([]);
    adapterMock.readCandidatePublishedCreateOrderPriceProjection.mockRejectedValue(
      new MockPublishedCreateOrderPriceAdapterError('缺少配套物流价目簿'),
    );

    await expect(
      cancelScheduledCustomerPriceBook(
        {
          priceBookId: 'book-v2-scheduled',
          expectedUpdatedAt: now,
          reason: '取消错误计划',
        },
        actor,
        now,
      ),
    ).rejects.toThrow('调整后无法供建单计价');
    expect(dbMock.customerPriceBook.updateMany).not.toHaveBeenCalled();
    expect(dbMock.customerPriceBook.update).not.toHaveBeenCalled();
    expect(dbMock.businessAuditLog.create).not.toHaveBeenCalled();
  });

  it('rejects schedule changes once a version is referenced by an order price lock', async () => {
    dbMock.customerPriceBook.findUnique.mockResolvedValue({
      id: 'book-v2-scheduled',
      code: 'EXTERNAL_SALES_PROCESSING_202608',
      version: 2,
      settlementType: 'EXTERNAL_SALES',
      purpose: 'PROCESSING',
      effectiveFrom: new Date('2026-08-10T01:30:00.000Z'),
      effectiveTo: null,
      isActive: true,
      notes: null,
      updatedAt: now,
      _count: { rules: 145, charges: 0, priceVersionLocks: 1 },
    });
    dbMock.orderCustomerCharge.count.mockResolvedValue(0);

    await expect(
      cancelScheduledCustomerPriceBook(
        {
          priceBookId: 'book-v2-scheduled',
          expectedUpdatedAt: now,
          reason: '取消错误计划',
        },
        actor,
        now,
      ),
    ).rejects.toThrow('已被工单价格事实引用');
    expect(dbMock.customerPriceBook.findMany).not.toHaveBeenCalled();
    expect(dbMock.customerPriceBook.updateMany).not.toHaveBeenCalled();
  });

  it('rejects schedule changes once a charge references one of the preserved rules', async () => {
    dbMock.customerPriceBook.findUnique.mockResolvedValue({
      id: 'book-v2-scheduled',
      code: 'EXTERNAL_SALES_PROCESSING_202608',
      version: 2,
      settlementType: 'EXTERNAL_SALES',
      purpose: 'PROCESSING',
      effectiveFrom: new Date('2026-08-10T01:30:00.000Z'),
      effectiveTo: null,
      isActive: true,
      notes: null,
      updatedAt: now,
      _count: { rules: 145, charges: 0, priceVersionLocks: 0 },
    });
    dbMock.orderCustomerCharge.count.mockResolvedValue(1);

    await expect(
      rescheduleCustomerPriceBook(
        {
          priceBookId: 'book-v2-scheduled',
          expectedUpdatedAt: now,
          effectiveFrom: new Date('2026-08-11T01:30:00.000Z'),
          reason: '延后统一切换',
        },
        actor,
        now,
      ),
    ).rejects.toThrow('已被工单价格事实引用');
    expect(dbMock.customerPriceBook.findMany).not.toHaveBeenCalled();
    expect(dbMock.customerPriceBook.updateMany).not.toHaveBeenCalled();
  });

  it('refuses a stale schedule cancellation before reading references or changing windows', async () => {
    dbMock.customerPriceBook.findUnique.mockResolvedValue({
      id: 'book-v2-scheduled',
      code: 'EXTERNAL_SALES_PROCESSING_202608',
      version: 2,
      settlementType: 'EXTERNAL_SALES',
      purpose: 'PROCESSING',
      effectiveFrom: new Date('2026-08-10T01:30:00.000Z'),
      effectiveTo: null,
      isActive: true,
      notes: null,
      updatedAt: now,
      _count: { rules: 145, charges: 0, priceVersionLocks: 0 },
    });

    await expect(
      cancelScheduledCustomerPriceBook(
        {
          priceBookId: 'book-v2-scheduled',
          expectedUpdatedAt: new Date(now.getTime() - 1),
          reason: '取消错误计划',
        },
        actor,
        now,
      ),
    ).rejects.toThrow('计划版本已被其他管理员修改');
    expect(dbMock.orderCustomerCharge.count).not.toHaveBeenCalled();
    expect(dbMock.customerPriceBook.findMany).not.toHaveBeenCalled();
    expect(dbMock.customerPriceBook.updateMany).not.toHaveBeenCalled();
  });

  it('refuses to publish a draft changed after the page was loaded', async () => {
    dbMock.customerPriceBook.findUnique.mockResolvedValue({
      id: 'book-v2-draft',
      code: 'EXTERNAL_SALES_PROCESSING_202608',
      name: '外部销售加工费',
      settlementType: 'EXTERNAL_SALES',
      purpose: 'PROCESSING',
      version: 2,
      isActive: false,
      notes: draftNotes(),
      updatedAt: now,
    });

    await expect(
      publishCustomerPriceBookDraft(
        {
          priceBookId: 'book-v2-draft',
          expectedDraftUpdatedAt: new Date('2026-08-09T01:59:59.999Z'),
          effectiveFrom: publishAt,
          publishNote: '已完成价格复核',
        },
        actor,
        now,
      ),
    ).rejects.toThrow('草稿已被其他管理员修改，请刷新');

    expect(dbMock.customerPriceRule.findMany).not.toHaveBeenCalled();
    expect(dbMock.customerPriceBook.update).not.toHaveBeenCalled();
  });

  it('discards only an unreferenced draft and removes its rules first', async () => {
    dbMock.customerPriceBook.findUnique.mockResolvedValue({
      id: 'book-v2-draft',
      code: 'EXTERNAL_SALES_PROCESSING_202608',
      version: 2,
      purpose: 'PROCESSING',
      settlementType: 'EXTERNAL_SALES',
      isActive: false,
      notes: draftNotes(),
      updatedAt: now,
      _count: { rules: 121, charges: 0 },
    });
    dbMock.orderCustomerCharge.count.mockResolvedValue(0);
    dbMock.customerPriceRule.deleteMany.mockResolvedValue({ count: 121 });
    dbMock.customerPriceBook.delete.mockResolvedValue({ id: 'book-v2-draft' });

    await expect(
      discardCustomerPriceBookDraft(
        { priceBookId: 'book-v2-draft', expectedDraftUpdatedAt: now },
        actor,
      ),
    ).resolves.toEqual({ id: 'book-v2-draft', purpose: 'PROCESSING' });

    expect(dbMock.$executeRaw).toHaveBeenCalledTimes(1);
    expect(dbMock.customerPriceRule.deleteMany).toHaveBeenCalledWith({
      where: { priceBookId: 'book-v2-draft' },
    });
    expect(dbMock.customerPriceRule.deleteMany.mock.invocationCallOrder[0]).toBeLessThan(
      dbMock.customerPriceBook.delete.mock.invocationCallOrder[0]!,
    );
  });

  it('refuses to discard a draft referenced by a charge rule', async () => {
    dbMock.customerPriceBook.findUnique.mockResolvedValue({
      id: 'book-v2-draft',
      code: 'EXTERNAL_SALES_PROCESSING_202608',
      version: 2,
      purpose: 'PROCESSING',
      settlementType: 'EXTERNAL_SALES',
      isActive: false,
      notes: draftNotes(),
      updatedAt: now,
      _count: { rules: 121, charges: 0 },
    });
    dbMock.orderCustomerCharge.count.mockResolvedValue(1);

    await expect(
      discardCustomerPriceBookDraft(
        { priceBookId: 'book-v2-draft', expectedDraftUpdatedAt: now },
        actor,
      ),
    ).rejects.toThrow('草稿已被工单收费事实引用');
    expect(dbMock.customerPriceRule.deleteMany).not.toHaveBeenCalled();
  });

  it('refuses to discard a draft changed after the page was loaded', async () => {
    dbMock.customerPriceBook.findUnique.mockResolvedValue({
      id: 'book-v2-draft',
      code: 'EXTERNAL_SALES_PROCESSING_202608',
      version: 2,
      purpose: 'PROCESSING',
      settlementType: 'EXTERNAL_SALES',
      isActive: false,
      notes: draftNotes(),
      updatedAt: now,
      _count: { rules: 121, charges: 0 },
    });

    await expect(
      discardCustomerPriceBookDraft(
        {
          priceBookId: 'book-v2-draft',
          expectedDraftUpdatedAt: new Date('2026-08-09T01:59:59.999Z'),
        },
        actor,
      ),
    ).rejects.toThrow('草稿已被其他管理员修改，请刷新');

    expect(dbMock.orderCustomerCharge.count).not.toHaveBeenCalled();
    expect(dbMock.customerPriceRule.deleteMany).not.toHaveBeenCalled();
  });
});

describe('price-book admin DTO and normalized hash', () => {
  it('serializes version dates and workflow evidence for the UI', async () => {
    dbMock.customerPriceBook.findMany.mockResolvedValue([
      {
        id: 'book-v2-draft',
        code: 'EXTERNAL_SALES_PROCESSING_202608',
        name: '外部销售加工费',
        purpose: 'PROCESSING',
        version: 2,
        effectiveFrom: now,
        effectiveTo: null,
        isActive: false,
        notes: draftNotes(),
        updatedAt: now,
        _count: { rules: 121 },
      },
    ]);

    const versions = await listCustomerPriceBookVersionsAndDrafts(now);

    expect(versions).toEqual([
      expect.objectContaining({
        id: 'book-v2-draft',
        status: 'DRAFT',
        effectiveFrom: now.toISOString(),
        basedOnBookId: 'book-v1',
        basedOnVersion: 1,
        changeReason: '调整加工费',
        createdById: actor.id,
        workflowCreatedAt: now.toISOString(),
        ruleSetSha256: null,
      }),
    ]);
  });

  it('reports a preserved cancelled schedule separately from ordinary history', async () => {
    const cancelledAt = new Date('2026-08-09T03:00:00.000Z');
    dbMock.customerPriceBook.findMany.mockResolvedValue([
      {
        id: 'book-v2-cancelled',
        code: 'EXTERNAL_SALES_PROCESSING_202608',
        name: '外部销售加工费',
        purpose: 'PROCESSING',
        version: 2,
        effectiveFrom: new Date('2026-08-10T01:30:00.000Z'),
        effectiveTo: null,
        isActive: false,
        notes: {
          workflow: { ...draftNotes().workflow, status: 'PUBLISHED' },
          scheduleControl: {
            status: 'CANCELLED',
            changedBy: actor.id,
            changedAt: cancelledAt.toISOString(),
            reason: '价格复核尚未完成',
            previousEffectiveFrom: '2026-08-10T01:30:00.000Z',
            effectiveFrom: '2026-08-10T01:30:00.000Z',
          },
        },
        updatedAt: cancelledAt,
        _count: { rules: 145 },
      },
    ]);

    const versions = await listCustomerPriceBookVersionsAndDrafts(now);

    expect(versions[0]).toMatchObject({
      id: 'book-v2-cancelled',
      status: 'CANCELLED',
      ruleCount: 145,
      scheduleChangeReason: '价格复核尚未完成',
      scheduleChangedAt: cancelledAt.toISOString(),
    });
  });

  it('reports a legacy superseded plan as cancelled instead of historical', async () => {
    const supersededAt = new Date('2026-08-29T02:30:00.000Z');
    dbMock.customerPriceBook.findMany.mockResolvedValue([
      {
        id: 'book-v4-superseded',
        code: 'EXTERNAL_SALES_PROCESSING_202608_LEGACY',
        name: '客户加工费价目簿（2026-08）·结构化规则',
        purpose: 'PROCESSING',
        version: 4,
        effectiveFrom: new Date('2026-08-29T09:59:00.000Z'),
        effectiveTo: null,
        isActive: false,
        notes: {
          workflow: { ...draftNotes().workflow, status: 'PUBLISHED' },
          supersededByPriceBookId: 'book-v4-current-lineage',
          supersededAt: supersededAt.toISOString(),
          supersededReason: '已由专版 5 万档价目簿替代',
        },
        updatedAt: supersededAt,
        _count: { rules: 145 },
      },
    ]);

    const versions = await listCustomerPriceBookVersionsAndDrafts(now);

    expect(versions[0]).toMatchObject({
      id: 'book-v4-superseded',
      status: 'CANCELLED',
      scheduleChangeReason: '已由专版 5 万档价目簿替代',
      scheduleChangedAt: supersededAt.toISOString(),
    });
  });

  it('does not label an inactive future published version as historical', async () => {
    const disabledAt = new Date('2026-08-09T03:00:00.000Z');
    dbMock.customerPriceBook.findMany.mockResolvedValue([
      {
        id: 'book-v2-disabled-before-release',
        code: 'EXTERNAL_SALES_PROCESSING_202608_LEGACY',
        name: '旧客户加工费价目簿',
        purpose: 'PROCESSING',
        version: 2,
        effectiveFrom: new Date('2026-08-10T01:30:00.000Z'),
        effectiveTo: null,
        isActive: false,
        notes: {
          workflow: {
            ...draftNotes().workflow,
            status: 'PUBLISHED',
            publishedAt: disabledAt.toISOString(),
          },
        },
        updatedAt: disabledAt,
        _count: { rules: 121 },
      },
    ]);

    const versions = await listCustomerPriceBookVersionsAndDrafts(now);

    expect(versions[0]).toMatchObject({
      id: 'book-v2-disabled-before-release',
      status: 'CANCELLED',
      scheduleChangeReason: null,
      scheduleChangedAt: null,
    });
  });

  it('hashes normalized rule semantics independent of row order and JSON key order', () => {
    const first = validationRule({
      triggerCondition: { isDoubleSided: true, productCodes: ['PRODUCT_A'] },
    });
    const second = validationRule({
      id: 'draft-rule-b',
      code: 'BASE_B',
      productId: 'product-b',
      product: { code: 'PRODUCT_B', category: 'BLANK_STOCK', isActive: true },
      triggerCondition: { productCodes: ['PRODUCT_B'], isDoubleSided: false },
    });
    const hash = calculateCustomerPriceRuleSetSha256([first, second]);
    const reorderedHash = calculateCustomerPriceRuleSetSha256([
      {
        ...second,
        triggerCondition: { isDoubleSided: false, productCodes: ['PRODUCT_B'] },
      },
      {
        ...first,
        triggerCondition: { productCodes: ['PRODUCT_A'], isDoubleSided: true },
      },
    ]);
    const changedHash = calculateCustomerPriceRuleSetSha256([
      first,
      { ...second, amount: '0.1400' },
    ]);

    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(reorderedHash).toBe(hash);
    expect(changedHash).not.toBe(hash);
  });

  it('keeps invariant errors typed for action-layer mapping', async () => {
    dbMock.customerPriceBook.findMany.mockResolvedValue([]);
    await expect(
      createCustomerPriceBookDraft(
        { purpose: 'LOGISTICS', changeReason: '修改物流价' },
        actor,
        now,
      ),
    ).rejects.toBeInstanceOf(CustomerPriceBookAdminError);
  });
});


describe('confirmed custom-tier draft release guards', () => {
  const input = { priceBookId: 'draft', expectedDraftUpdatedAt: now };
  function mockDraft() {
    dbMock.customerPriceBook.findUnique.mockResolvedValueOnce({
      id: 'draft', isActive: false, purpose: 'PROCESSING', settlementType: 'EXTERNAL_SALES',
      updatedAt: now, notes: draftNotes(),
    });
  }
  it('rejects non-admin actors before opening a write transaction', async () => {
    await expect(prepareConfirmedCustomTierDraft(input, { ...actor, role: Role.SALES })).rejects.toThrow('仅管理员');
    expect(dbMock.$transaction).not.toHaveBeenCalled();
  });
  it('rejects stale draft timestamps without changing any rules', async () => {
    mockDraft();
    await expect(prepareConfirmedCustomTierDraft({ ...input, expectedDraftUpdatedAt: new Date(0) }, actor)).rejects.toThrow('草稿已变化');
    expect(dbMock.customerPriceRule.update).not.toHaveBeenCalled();
  });
  it('does not overwrite an independently published successor', async () => {
    mockDraft();
    dbMock.customerPriceBook.findUnique.mockResolvedValueOnce({
      id: 'book-v1', isActive: true, effectiveFrom: now, effectiveTo: null,
      code: 'EXTERNAL_SALES_PROCESSING_RULES', notes: { ruleVersion: 'other-release' },
    });
    await expect(prepareConfirmedCustomTierDraft(input, actor)).rejects.toThrow('不适用');
    expect(dbMock.customerPriceRule.update).not.toHaveBeenCalled();
  });
  it('refuses unrelated draft changes rather than publishing them with the tier update', async () => {
    mockDraft();
    dbMock.customerPriceBook.findUnique.mockResolvedValueOnce({
      id: 'book-v1', isActive: true, effectiveFrom: now, effectiveTo: null,
      code: 'EXTERNAL_SALES_PROCESSING_RULES', notes: { ruleVersion: '2026-08-30-print-null-sentinel' },
    });
    dbMock.customerPriceRule.findMany.mockResolvedValueOnce([validationRule({ amount: '9' })])
      .mockResolvedValueOnce([validationRule({ amount: '1' })]);
    await expect(prepareConfirmedCustomTierDraft(input, actor)).rejects.toThrow('草稿含其他调价');
    expect(dbMock.customerPriceRule.update).not.toHaveBeenCalled();
  });
});
