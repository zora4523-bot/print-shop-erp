import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Role } from '../../../generated/prisma/enums';

vi.mock('server-only', () => ({}));

const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    $executeRaw: vi.fn(),
    $transaction: vi.fn(),
    customerPriceBook: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
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
    orderCustomerCharge: { count: vi.fn() },
    businessAuditLog: { create: vi.fn() },
  },
}));

vi.mock('@/lib/db', () => ({ db: dbMock }));

import {
  calculateCustomerPriceRuleSetSha256,
  createCustomerPriceBookDraft,
  CustomerPriceBookAdminError,
  discardCustomerPriceBookDraft,
  getCustomerPriceBookDraftPublishPreview,
  getCustomerPriceBookDraftRuleEditor,
  listCustomerPriceBookVersionsAndDrafts,
  publishCustomerPriceBookDraft,
  updateCustomerPriceRuleDraft,
  updateCustomerPriceRuleDraftGroup,
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
  triggerCondition: { productCodes: ['PRODUCT_A'] },
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
    product: { code: 'PRODUCT_A', isActive: true },
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
      productCodes: ['PRODUCT_A'],
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
      productCodes: ['PRODUCT_A'],
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

beforeEach(() => {
  for (const delegate of [
    dbMock.customerPriceBook,
    dbMock.customerPriceRule,
    dbMock.customerChargeCategory,
    dbMock.product,
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
    const impactRule = (amount: string, id: string) => ({
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
    });
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
    dbMock.customerPriceRule.findMany.mockResolvedValue([
      validationRule({ amount: '0.1500' }),
    ]);

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
      deltaPercentMin: '11.1',
      deltaPercentMax: '11.1',
      changes: [
        expect.objectContaining({
          draftRuleId: 'draft-rule-a',
          name: '基础报价 A',
          direction: 'UP',
          deltaAmount: '0.015',
          deltaPercent: '11.1',
          changedFields: ['价格'],
        }),
      ],
    });
    expect(JSON.stringify(preview)).not.toContain('BASE_A');
    expect(JSON.stringify(preview)).not.toContain('productCodes');
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
          productCodes: ['PRODUCT_A'],
          craftCodes: ['craft_color_print'],
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
          productCodes: ['PRODUCT_A'],
          unitsPerSheet: '4',
        },
      }),
    );
    dbMock.customerChargeCategory.findMany.mockResolvedValue([]);
    dbMock.product.findMany.mockResolvedValue([]);

    const editor = await getCustomerPriceBookDraftRuleEditor(
      'book-v2-draft',
      'draft-rule-a',
    );

    expect(editor?.rule.unitsPerSheet).toBeNull();
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
        product: { code: 'PRODUCT_B', isActive: true },
        triggerCondition: { productCodes: ['PRODUCT_B'] },
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
          isActive: true,
        },
        actor,
        now,
      ),
    ).resolves.toEqual({ id: 'draft-rule-a', priceBookId: 'book-v2-draft' });

    expect(dbMock.customerPriceRule.update.mock.calls[0]![0].data).toEqual(
      expect.objectContaining({
        productId: 'product-b',
        triggerCondition: { productCodes: ['PRODUCT_B'] },
      }),
    );
  });

  it('adds a product matcher when selecting a product and preserves other technical fields', async () => {
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
        product: { code: 'PRODUCT_B', isActive: true },
        triggerCondition: {
          productCodes: ['PRODUCT_B'],
          craftCodes: ['craft_color_print'],
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
          productCodes: ['PRODUCT_B'],
          craftCodes: ['craft_color_print'],
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
        triggerCondition: { craftCodes: ['craft_color_print'] },
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
        triggerCondition: { craftCodes: ['craft_color_print'] },
      }),
    );
    expect(data.triggerCondition).not.toHaveProperty('productCodes');
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
          productCodes: ['PRODUCT_A'],
          craftCodes: ['craft_color_print'],
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
        isActive: true,
      },
      actor,
      now,
    );

    expect(dbMock.customerPriceRule.update.mock.calls[0]![0].data).toEqual(
      expect.objectContaining({
        calculationType: 'PER_SHEET',
        triggerCondition: {
          productCodes: ['PRODUCT_A'],
          craftCodes: ['craft_color_print'],
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
          productCodes: ['PRODUCT_A'],
          craftCodes: ['craft_color_print'],
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
        isActive: true,
      },
      actor,
      now,
    );

    const triggerCondition =
      dbMock.customerPriceRule.update.mock.calls[0]![0].data.triggerCondition;
    expect(triggerCondition).toEqual({
      productCodes: ['PRODUCT_A'],
      craftCodes: ['craft_color_print'],
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
        triggerCondition: { carrierCode: 'ZTO', provinces: ['广东'] },
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
        triggerCondition: { carrierCode: 'ZTO', provinces: ['广东'] },
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
        kind: 'REFERENCE',
        calculationType: 'FIXED_AMOUNT',
        amount: '1.0000',
        includedUnits: null,
        incrementUnits: null,
        incrementAmount: null,
        minQty: 1,
        maxQty: 500,
        triggerCondition: { scope: 'SHIPMENT_QUANTITY', advisory: true },
        exclusiveGroup: 'PACKING_MATERIAL_QUANTITY_TIER',
        productId: null,
        product: null,
        blocksAutomaticQuote: true,
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
        productCodes: ['PRODUCT_A', 'PRODUCT_ALIAS'],
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
        paperTypes: ['铜版纸', '157克双铜纸'],
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
    });
    dbMock.customerPriceRule.findMany.mockResolvedValue([validationRule()]);
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

  it('hashes normalized rule semantics independent of row order and JSON key order', () => {
    const first = validationRule({
      triggerCondition: { isDoubleSided: true, productCodes: ['PRODUCT_A'] },
    });
    const second = validationRule({
      id: 'draft-rule-b',
      code: 'BASE_B',
      productId: 'product-b',
      product: { code: 'PRODUCT_B', isActive: true },
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
