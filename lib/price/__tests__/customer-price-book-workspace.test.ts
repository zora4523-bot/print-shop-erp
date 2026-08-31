import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CustomerPriceBookPurpose,
  CustomerPriceCalculationType,
  CustomerPriceRuleKind,
} from '../../../generated/prisma/enums';

vi.mock('server-only', () => ({}));

const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    $executeRaw: vi.fn(),
    $transaction: vi.fn(),
    customerPriceBook: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    customerPriceRule: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
    },
    customerChargeCategory: {
      findMany: vi.fn(),
    },
    product: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock('@/lib/db', () => ({ db: dbMock }));

import {
  getCustomerPriceRuleGroupWorkspaceDetail,
  getCustomerPriceRuleGroupWorkspacePage,
  getCustomerPriceRuleWorkspace,
  getCustomerPriceRuleWorkspaceDetail,
} from '../customer-price-book-workspace';

const now = new Date('2026-08-11T04:00:00.000Z');
const currentUpdatedAt = new Date('2026-08-01T00:00:00.000Z');
const draftUpdatedAt = new Date('2026-08-11T03:00:00.000Z');

const currentBook = {
  id: 'book-current',
  name: '外部销售加工费',
  settlementType: 'EXTERNAL_SALES',
  purpose: 'PROCESSING',
  version: 1,
  effectiveFrom: new Date('2026-08-01T00:00:00.000Z'),
  effectiveTo: null,
  isActive: true,
  notes: null,
  updatedAt: currentUpdatedAt,
};

const draftBook = {
  id: 'book-draft',
  name: '外部销售加工费',
  settlementType: 'EXTERNAL_SALES',
  purpose: 'PROCESSING',
  version: 2,
  effectiveFrom: now,
  effectiveTo: null,
  isActive: false,
  notes: {
    workflow: {
      status: 'DRAFT',
      basedOn: {
        id: currentBook.id,
        code: 'INTERNAL_BOOK_CODE_MUST_NOT_LEAK',
        version: 1,
      },
      createdBy: 'owner-1',
      createdAt: now.toISOString(),
      changeReason: '调整局部烫金价格',
    },
  },
  updatedAt: draftUpdatedAt,
};

function rule(overrides: Record<string, unknown> = {}) {
  return {
    id: 'rule-current-a',
    code: 'INTERNAL_RULE_A',
    name: '局部烫金加工费',
    categoryId: 'category-foil',
    productId: 'product-red-envelope',
    kind: 'ADD_ON',
    calculationType: 'PER_PIECE',
    amount: '0.1350',
    includedUnits: null,
    incrementUnits: null,
    incrementAmount: null,
    minQty: 500,
    maxQty: 5_000,
    triggerCondition: {
      craftCodes: ['INTERNAL_CRAFT_CODE'],
      isDoubleSided: false,
    },
    exclusiveGroup: 'INTERNAL_EXCLUSIVE_GROUP',
    priority: 100,
    note: '业务备注',
    blocksAutomaticQuote: false,
    isActive: true,
    updatedAt: currentUpdatedAt,
    category: { id: 'category-foil', name: '烫金加工' },
    product: { id: 'product-red-envelope', name: '专版红包' },
    ...overrides,
  };
}

const categories = [{ id: 'category-foil', name: '烫金加工' }];
const products = [{ id: 'product-red-envelope', name: '专版红包' }];

function exactPriceTier(input: {
  version: 'current' | 'draft';
  productId: string;
  productName: string;
  specification: string;
  paperType: string;
  quantity: number;
  amount: string;
  sourceSheet?: string;
  sourceRange?: string;
  note?: string;
}) {
  const code = `BASE_${input.productId}_${input.quantity}`;
  return rule({
    id: `${input.version}-${input.productId}-${input.quantity}`,
    priceBookId:
      input.version === 'draft' ? draftBook.id : currentBook.id,
    code,
    name: `${input.productName} ${input.quantity}个固定总额`,
    categoryId: 'category-color',
    productId: input.productId,
    kind: 'BASE',
    calculationType: 'FIXED_AMOUNT',
    amount: input.amount,
    minQty: input.quantity,
    maxQty: input.quantity,
    triggerCondition: {
      productCodes: [input.productId],
      specifications: [input.specification],
      paperTypes: [input.paperType, '铜版纸'],
    },
    exclusiveGroup: 'BASE_PROCESSING',
    priority: 100,
    sourceSheet: input.sourceSheet ?? '彩印',
    sourceRange: input.sourceRange ?? `A${input.quantity}`,
    sourceName: '长昆线下报价表.xlsx',
    sourceSha256: 'a'.repeat(64),
    note:
      input.note ??
      '工作簿给出整批总额；仅对明确数量锚点精确匹配。',
    updatedAt:
      input.version === 'draft' ? draftUpdatedAt : currentUpdatedAt,
    category: { id: 'category-color', name: '彩印' },
    product: {
      id: input.productId,
      name: input.productName,
      specification: input.specification,
      paperType: input.paperType,
    },
  });
}

function prepareCommonFilters() {
  dbMock.customerChargeCategory.findMany.mockResolvedValue(categories);
  dbMock.product.findMany.mockResolvedValue(products);
}

beforeEach(() => {
  for (const delegate of [
    dbMock.customerPriceBook,
    dbMock.customerPriceRule,
    dbMock.customerChargeCategory,
    dbMock.product,
  ]) {
    for (const method of Object.values(delegate)) method.mockReset();
  }
  dbMock.$executeRaw.mockReset().mockResolvedValue(0);
  dbMock.$transaction
    .mockReset()
    .mockImplementation(
      async (callback: (tx: typeof dbMock) => Promise<unknown>) => callback(dbMock),
    );
  prepareCommonFilters();
});

describe('customer price-rule workspace list', () => {
  it('builds the combined server-side filters, clamps pagination and returns safe current/draft differences', async () => {
    const currentRule = rule();
    const draftRule = rule({
      id: 'rule-draft-a',
      amount: '0.1450',
      updatedAt: draftUpdatedAt,
    });
    dbMock.customerPriceBook.findMany.mockResolvedValue([draftBook, currentBook]);
    dbMock.customerPriceRule.findMany
      .mockResolvedValueOnce([draftRule])
      .mockResolvedValueOnce([currentRule])
      .mockResolvedValueOnce([draftRule]);
    dbMock.customerPriceRule.count.mockResolvedValue(1);

    const result = await getCustomerPriceRuleWorkspace(
      {
        purpose: CustomerPriceBookPurpose.PROCESSING,
        q: '  烫金  ',
        categoryId: 'category-foil',
        productId: 'product-red-envelope',
        kind: CustomerPriceRuleKind.ADD_ON,
        calculationType: CustomerPriceCalculationType.PER_PIECE,
        automation: 'AUTOMATIC',
        active: 'ACTIVE',
        changed: true,
        quantity: 1_000,
        page: 99,
        pageSize: 1,
      },
      now,
    );

    expect(dbMock.$executeRaw).toHaveBeenCalledTimes(1);
    expect(dbMock.customerPriceBook.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          settlementType: 'EXTERNAL_SALES',
          purpose: 'PROCESSING',
        }),
      }),
    );
    const countWhere = dbMock.customerPriceRule.count.mock.calls[0]?.[0].where;
    expect(countWhere).toEqual(
      expect.objectContaining({
        priceBookId: draftBook.id,
        categoryId: 'category-foil',
        productId: 'product-red-envelope',
        kind: 'ADD_ON',
        calculationType: 'PER_PIECE',
        isActive: true,
        AND: expect.arrayContaining([
          expect.objectContaining({
            OR: expect.arrayContaining([
              { name: { contains: '烫金', mode: 'insensitive' } },
            ]),
          }),
          {
            OR: [{ minQty: null }, { minQty: { lte: 1_000 } }],
          },
          {
            OR: [{ maxQty: null }, { maxQty: { gte: 1_000 } }],
          },
          {
            kind: { not: 'REFERENCE' },
            blocksAutomaticQuote: false,
          },
          { code: { in: ['INTERNAL_RULE_A'] } },
        ]),
      }),
    );
    const pageCall = dbMock.customerPriceRule.findMany.mock.calls[2]?.[0];
    expect(pageCall).toEqual(
      expect.objectContaining({ skip: 0, take: 1, where: countWhere }),
    );

    expect(result).toEqual(
      expect.objectContaining({
        purpose: 'PROCESSING',
        currentBook: expect.objectContaining({ id: currentBook.id, version: 1 }),
        draft: expect.objectContaining({
          id: draftBook.id,
          version: 2,
          basedOnVersion: 1,
          changeReason: '调整局部烫金价格',
          changedCount: 1,
        }),
        total: 1,
        page: 1,
        pageSize: 1,
        pageCount: 1,
        filters: expect.objectContaining({
          categories,
          products,
          provinces: [],
          changedAvailable: true,
        }),
      }),
    );
    expect(result.items).toEqual([
      {
        id: 'rule-draft-a',
        current: expect.objectContaining({
          id: 'rule-current-a',
          name: '局部烫金加工费',
          amount: '0.135',
          automation: 'AUTOMATIC',
        }),
        draft: expect.objectContaining({
          id: 'rule-draft-a',
          amount: '0.145',
          scopeLabel: '1 种指定工艺 · 单面',
        }),
        changed: true,
      },
    ]);

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('INTERNAL_RULE_A');
    expect(serialized).not.toContain('INTERNAL_BOOK_CODE');
    expect(serialized).not.toContain('triggerCondition');
    expect(serialized).not.toContain('source');
    expect(serialized).not.toContain('exclusiveGroup');
  });

  it.each([
    ['name', { name: '调整后名称' }],
    ['categoryId', { categoryId: 'category-other' }],
    ['productId', { productId: 'product-other' }],
    ['kind', { kind: 'REFERENCE' }],
    ['calculationType', { calculationType: 'FIXED_AMOUNT' }],
    ['amount', { amount: '0.1450' }],
    ['includedUnits', { includedUnits: '1.000' }],
    ['incrementUnits', { incrementUnits: '0.500' }],
    ['incrementAmount', { incrementAmount: '2.8000' }],
    ['minQty', { minQty: 501 }],
    ['maxQty', { maxQty: 5_001 }],
    [
      'triggerCondition',
      {
        triggerCondition: {
          craftCodes: ['INTERNAL_CRAFT_CODE'],
          isDoubleSided: true,
        },
      },
    ],
    ['exclusiveGroup', { exclusiveGroup: 'OTHER_INTERNAL_GROUP' }],
    ['priority', { priority: 101 }],
    ['note', { note: '新的业务备注' }],
    ['blocksAutomaticQuote', { blocksAutomaticQuote: true }],
    ['isActive', { isActive: false }],
  ])(
    'detects a %s pricing change while keeping internal comparison fields out of the DTO',
    async (_field, override) => {
      const currentRule = rule();
      const draftRule = rule({
        id: 'rule-draft-a',
        updatedAt: draftUpdatedAt,
        ...override,
      });
      dbMock.customerPriceBook.findMany.mockResolvedValue([
        draftBook,
        currentBook,
      ]);
      dbMock.customerPriceRule.findMany
        .mockResolvedValueOnce([draftRule])
        .mockResolvedValueOnce([currentRule])
        .mockResolvedValueOnce([draftRule]);
      dbMock.customerPriceRule.count.mockResolvedValue(1);

      const result = await getCustomerPriceRuleWorkspace(
        {
          purpose: CustomerPriceBookPurpose.PROCESSING,
          changed: true,
          page: 1,
          pageSize: 25,
        },
        now,
      );

      expect(result.items[0]?.changed).toBe(true);
      expect(
        dbMock.customerPriceRule.count.mock.calls[0]?.[0].where.AND,
      ).toContainEqual({ code: { in: ['INTERNAL_RULE_A'] } });
      expect(JSON.stringify(result.items[0])).not.toContain('isDoubleSided');
      expect(JSON.stringify(result.items[0])).not.toContain('craftCodes');
    },
  );

  it('projects per-sheet capacity as safe business data without exposing matcher JSON', async () => {
    const currentRule = rule({
      calculationType: 'PER_SHEET',
      amount: '0.1800',
      triggerCondition: {
        craftCodes: ['INTERNAL_CRAFT_CODE'],
        unitsPerSheet: 2,
      },
    });
    const draftRule = rule({
      id: 'rule-draft-a',
      calculationType: 'PER_SHEET',
      amount: '0.1800',
      triggerCondition: {
        craftCodes: ['INTERNAL_CRAFT_CODE'],
        unitsPerSheet: 4,
      },
      updatedAt: draftUpdatedAt,
    });
    dbMock.customerPriceBook.findMany.mockResolvedValue([draftBook, currentBook]);
    dbMock.customerPriceRule.findMany
      .mockResolvedValueOnce([draftRule])
      .mockResolvedValueOnce([currentRule])
      .mockResolvedValueOnce([draftRule]);
    dbMock.customerPriceRule.count.mockResolvedValue(1);

    const result = await getCustomerPriceRuleWorkspace(
      { purpose: CustomerPriceBookPurpose.PROCESSING },
      now,
    );

    expect(result.items[0]?.current).toEqual(
      expect.objectContaining({
        unitsPerSheet: 2,
        blocksAutomaticQuote: false,
      }),
    );
    expect(result.items[0]?.draft).toEqual(
      expect.objectContaining({
        unitsPerSheet: 4,
        blocksAutomaticQuote: false,
      }),
    );
    expect(result.items[0]?.changed).toBe(true);
    const serialized = JSON.stringify(result.items[0]);
    expect(serialized).not.toContain('triggerCondition');
    expect(serialized).not.toContain('INTERNAL_CRAFT_CODE');
  });

  it('用中文业务文字展示烫金道数与乘算方式', async () => {
    const currentRule = rule({
      triggerCondition: {
        pricingRoutes: ['STOCK_BLANK'],
        foilPassCount: 2,
        perFoilPass: true,
      },
    });
    const draftRule = rule({
      id: 'rule-draft-a',
      triggerCondition: {
        pricingRoutes: ['STOCK_BLANK'],
        foilPassCount: 3,
        perFoilPass: true,
      },
      updatedAt: draftUpdatedAt,
    });
    dbMock.customerPriceBook.findMany.mockResolvedValue([draftBook, currentBook]);
    dbMock.customerPriceRule.findMany
      .mockResolvedValueOnce([draftRule])
      .mockResolvedValueOnce([currentRule])
      .mockResolvedValueOnce([draftRule]);
    dbMock.customerPriceRule.count.mockResolvedValue(1);

    const result = await getCustomerPriceRuleWorkspace(
      { purpose: CustomerPriceBookPurpose.PROCESSING },
      now,
    );

    expect(result.items[0]?.current?.scopeLabel).toBe(
      '2 道烫金（正面＋背面） · 按实际烫金道数乘算',
    );
    expect(result.items[0]?.draft?.scopeLabel).toBe(
      '3 道烫金（正面＋背面） · 按实际烫金道数乘算',
    );
    const serialized = JSON.stringify(result.items[0]);
    expect(serialized).not.toMatch(
      /foilPassCount|perFoilPass|STOCK_BLANK|triggerCondition/,
    );
  });

  it('uses notIn for the unchanged-only filter and paginates in the database', async () => {
    const changedCurrent = rule();
    const changedDraft = rule({
      id: 'rule-draft-a',
      amount: '0.1450',
      updatedAt: draftUpdatedAt,
    });
    const unchangedCurrent = rule({
      id: 'rule-current-b',
      code: 'INTERNAL_RULE_B',
      name: '普通烫金加工费',
    });
    const unchangedDraft = rule({
      id: 'rule-draft-b',
      code: 'INTERNAL_RULE_B',
      name: '普通烫金加工费',
      updatedAt: draftUpdatedAt,
    });
    dbMock.customerPriceBook.findMany.mockResolvedValue([draftBook, currentBook]);
    dbMock.customerPriceRule.findMany
      .mockResolvedValueOnce([changedDraft, unchangedDraft])
      .mockResolvedValueOnce([changedCurrent, unchangedCurrent])
      .mockResolvedValueOnce([unchangedDraft]);
    dbMock.customerPriceRule.count.mockResolvedValue(3);

    const result = await getCustomerPriceRuleWorkspace(
      {
        purpose: CustomerPriceBookPurpose.PROCESSING,
        changed: false,
        page: 2,
        pageSize: 2,
      },
      now,
    );

    const countWhere = dbMock.customerPriceRule.count.mock.calls[0]?.[0].where;
    expect(countWhere.AND).toContainEqual({
      code: { notIn: ['INTERNAL_RULE_A'] },
    });
    expect(dbMock.customerPriceRule.findMany.mock.calls[2]?.[0]).toEqual(
      expect.objectContaining({ skip: 2, take: 2 }),
    );
    expect(result).toEqual(expect.objectContaining({ page: 2, pageCount: 2 }));
    expect(result.items[0]).toEqual(
      expect.objectContaining({ changed: false, id: 'rule-draft-b' }),
    );
    expect(result.draft?.changedCount).toBe(1);
  });

  it('turns logistics carrier and province conditions into a business scope label only', async () => {
    const logisticsCurrentBook = {
      ...currentBook,
      id: 'logistics-current',
      name: '快递与打包耗材',
      purpose: 'LOGISTICS',
    };
    const logisticsDraftBook = {
      ...draftBook,
      id: 'logistics-draft',
      name: '快递与打包耗材',
      purpose: 'LOGISTICS',
      notes: {
        workflow: {
          status: 'DRAFT',
          basedOn: {
            id: logisticsCurrentBook.id,
            code: 'INTERNAL_LOGISTICS_BOOK',
            version: 1,
          },
          createdBy: 'owner-1',
          createdAt: now.toISOString(),
          changeReason: '调整广东快递费',
        },
      },
    };
    const currentRule = rule({
      id: 'shipping-current',
      code: 'INTERNAL_SHIPPING_RULE',
      name: '广东省快递费',
      categoryId: 'category-shipping',
      productId: null,
      triggerCondition: { carrierCode: 'ZTO', provinces: ['广东', '广西'] },
      category: { id: 'category-shipping', name: '快递费' },
      product: null,
    });
    const draftRule = rule({
      ...currentRule,
      id: 'shipping-draft',
      updatedAt: draftUpdatedAt,
    });
    dbMock.customerPriceBook.findMany.mockResolvedValue([
      logisticsDraftBook,
      logisticsCurrentBook,
    ]);
    dbMock.customerPriceRule.findMany
      .mockResolvedValueOnce([draftRule])
      .mockResolvedValueOnce([currentRule])
      .mockResolvedValueOnce([draftRule]);
    dbMock.customerPriceRule.count.mockResolvedValue(1);

    const result = await getCustomerPriceRuleWorkspace(
      {
        purpose: CustomerPriceBookPurpose.LOGISTICS,
        q: '广东',
        province: '广西壮族自治区',
      },
      now,
    );

    expect(result.items[0]?.draft?.scopeLabel).toBe('中通 · 广东、广西');
    expect(result.draft?.changedCount).toBe(0);
    expect(result.filters.provinces).toContainEqual({
      value: '广东',
      name: '广东',
    });
    const countWhere = dbMock.customerPriceRule.count.mock.calls[0]?.[0].where;
    expect(countWhere.AND).toContainEqual({
      triggerCondition: {
        path: ['provinces'],
        array_contains: ['广西'],
      },
    });
    expect(countWhere.AND).toContainEqual({
      OR: expect.arrayContaining([
        {
          triggerCondition: {
            path: ['provinces'],
            array_contains: ['广东'],
          },
        },
      ]),
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('carrierCode');
    expect(serialized).not.toContain('INTERNAL_SHIPPING_RULE');
    expect(serialized).not.toContain('INTERNAL_LOGISTICS_BOOK');
  });

  it('returns the current version without loading a draft diff when no draft exists', async () => {
    const currentRule = rule();
    dbMock.customerPriceBook.findMany.mockResolvedValue([currentBook]);
    dbMock.customerPriceRule.count.mockResolvedValue(1);
    dbMock.customerPriceRule.findMany.mockResolvedValue([currentRule]);

    const result = await getCustomerPriceRuleWorkspace(
      {
        purpose: CustomerPriceBookPurpose.PROCESSING,
        automation: 'MANUAL',
        // A stale URL can retain this after a draft is published or discarded.
        // Without a draft there is no diff to filter, so the current price list
        // must remain visible.
        changed: true,
      },
      now,
    );

    expect(dbMock.customerPriceRule.findMany).toHaveBeenCalledTimes(1);
    expect(dbMock.customerPriceRule.count.mock.calls[0]?.[0].where.AND).toContainEqual({
      OR: [{ kind: 'REFERENCE' }, { blocksAutomaticQuote: true }],
    });
    expect(
      JSON.stringify(dbMock.customerPriceRule.count.mock.calls[0]?.[0].where),
    ).not.toContain('"in":[]');
    expect(result.draft).toBeNull();
    expect(result.draftCreation).toEqual({ allowed: true, blockedReason: null });
    expect(result.filters.changedAvailable).toBe(false);
    expect(result.items).toEqual([
      expect.objectContaining({
        id: 'rule-current-a',
        current: expect.objectContaining({ id: 'rule-current-a' }),
        draft: null,
        changed: false,
      }),
    ]);
  });

  it('returns an empty, normalized page when that purpose has no current version or draft', async () => {
    dbMock.customerPriceBook.findMany.mockResolvedValue([]);

    const result = await getCustomerPriceRuleWorkspace(
      {
        purpose: CustomerPriceBookPurpose.LOGISTICS,
        page: -2,
        pageSize: 999,
      },
      now,
    );

    expect(result).toEqual(
      expect.objectContaining({
        purpose: 'LOGISTICS',
        currentBook: null,
        scheduledBook: null,
        draft: null,
        draftCreation: {
          allowed: false,
          blockedReason: '当前没有可复制的生效价格版本',
        },
        items: [],
        total: 0,
        page: 1,
        pageSize: 100,
        pageCount: 0,
      }),
    );
    expect(dbMock.customerPriceRule.count).not.toHaveBeenCalled();
  });

  it('reports a scheduled version and blocks an action that the domain would reject', async () => {
    const scheduledBook = {
      ...currentBook,
      id: 'book-scheduled',
      version: 2,
      effectiveFrom: new Date('2026-09-01T00:00:00.000Z'),
    };
    const currentRule = rule();
    dbMock.customerPriceBook.findMany.mockResolvedValue([
      scheduledBook,
      currentBook,
    ]);
    dbMock.customerPriceRule.count.mockResolvedValue(1);
    dbMock.customerPriceRule.findMany.mockResolvedValue([currentRule]);

    const result = await getCustomerPriceRuleWorkspace(
      { purpose: CustomerPriceBookPurpose.PROCESSING },
      now,
    );

    expect(result.currentBook?.id).toBe(currentBook.id);
    expect(result.scheduledBook).toEqual(
      expect.objectContaining({ id: scheduledBook.id, version: 2 }),
    );
    expect(result.draftCreation).toEqual({
      allowed: false,
      blockedReason:
        '已有计划生效版本，待该版本生效后才能再发起调价',
    });
  });
});

describe('customer price-rule workspace detail', () => {
  it('returns one editable draft rule and its current comparison without technical metadata', async () => {
    const currentRule = rule();
    const draftRule = rule({
      id: 'rule-draft-a',
      amount: '0.1450',
      updatedAt: draftUpdatedAt,
    });
    dbMock.customerPriceBook.findMany.mockResolvedValue([draftBook, currentBook]);
    dbMock.customerPriceRule.findFirst
      .mockResolvedValueOnce(draftRule)
      .mockResolvedValueOnce(currentRule);

    const detail = await getCustomerPriceRuleWorkspaceDetail(
      {
        purpose: CustomerPriceBookPurpose.PROCESSING,
        ruleId: 'rule-draft-a',
      },
      now,
    );

    expect(dbMock.$executeRaw).toHaveBeenCalledTimes(1);
    expect(dbMock.customerPriceRule.findFirst).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: { id: 'rule-draft-a', priceBookId: draftBook.id },
      }),
    );
    expect(dbMock.customerPriceRule.findFirst).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: {
          priceBookId: currentBook.id,
          code: 'INTERNAL_RULE_A',
        },
      }),
    );
    expect(detail).toEqual(
      expect.objectContaining({
        purpose: 'PROCESSING',
        priceBookId: draftBook.id,
        editable: true,
        expectedUpdatedAt: draftUpdatedAt.toISOString(),
        changed: true,
        categories,
        products,
        current: expect.objectContaining({ amount: '0.135' }),
        draft: expect.objectContaining({ amount: '0.145' }),
      }),
    );
    const serialized = JSON.stringify(detail);
    for (const forbidden of [
      'INTERNAL_RULE_A',
      'INTERNAL_CRAFT_CODE',
      'triggerCondition',
      'exclusiveGroup',
      'source',
      'code',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('returns a read-only current rule when there is no draft', async () => {
    const currentRule = rule();
    dbMock.customerPriceBook.findMany.mockResolvedValue([currentBook]);
    dbMock.customerPriceRule.findFirst.mockResolvedValue(currentRule);

    const detail = await getCustomerPriceRuleWorkspaceDetail(
      {
        purpose: CustomerPriceBookPurpose.PROCESSING,
        ruleId: currentRule.id,
      },
      now,
    );

    expect(detail).toEqual(
      expect.objectContaining({
        priceBookId: currentBook.id,
        editable: false,
        expectedUpdatedAt: null,
        current: expect.objectContaining({ id: currentRule.id }),
        draft: null,
        changed: false,
      }),
    );
    expect(dbMock.customerPriceRule.findFirst).toHaveBeenCalledTimes(1);
  });
});

describe('customer price-rule grouped workspace', () => {
  it('paginates exact product ladders as groups and keeps all seven 157g tiers together', async () => {
    const quantities157 = [1_000, 2_000, 3_000, 4_000, 5_000, 10_000, 20_000];
    const quantities200 = [100, 200];
    const current157 = quantities157.map((quantity, index) =>
      exactPriceTier({
        version: 'current',
        productId: 'EXT-COLOR-157-COATED-LARGE',
        productName: '157克双铜纸彩印 大号',
        specification: '大号',
        paperType: '157克双铜纸',
        quantity,
        amount: String(295 + index * 100),
        sourceRange: `${String.fromCharCode(72 + index)}3`,
      }),
    );
    const draft157 = current157.map((tier, index) => ({
      ...tier,
      id: `draft-157-${quantities157[index]}`,
      priceBookId: draftBook.id,
      amount: index === 1 ? '425.0000' : tier.amount,
      // Matcher arrays are sets: order alone must not split a group.
      triggerCondition: {
        ...(tier.triggerCondition as Record<string, unknown>),
        paperTypes: ['铜版纸', '157克双铜纸'],
      },
      updatedAt: draftUpdatedAt,
    }));
    const current200 = quantities200.map((quantity) =>
      exactPriceTier({
        version: 'current',
        productId: 'EXT-COLOR-200-COATED-LARGE',
        productName: '200克双铜纸彩印 大号',
        specification: '大号',
        paperType: '200克双铜纸',
        quantity,
        amount: quantity === 100 ? '130' : '200',
      }),
    );
    const draft200 = current200.map((tier) => ({
      ...tier,
      id: `draft-200-${tier.minQty}`,
      priceBookId: draftBook.id,
      updatedAt: draftUpdatedAt,
    }));
    const allDraft = [...draft157, ...draft200];
    const allCurrent = [...current157, ...current200];
    dbMock.customerPriceBook.findMany.mockResolvedValue([draftBook, currentBook]);
    dbMock.customerPriceRule.findMany
      .mockResolvedValueOnce(allDraft)
      .mockResolvedValueOnce(allCurrent)
      .mockResolvedValueOnce(allDraft);

    const result = await getCustomerPriceRuleGroupWorkspacePage(
      {
        purpose: CustomerPriceBookPurpose.PROCESSING,
        page: 1,
        pageSize: 1,
      },
      now,
    );

    expect(result).toEqual(
      expect.objectContaining({ total: 2, page: 1, pageSize: 1, pageCount: 2 }),
    );
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]).toEqual(
      expect.objectContaining({
        id: 'current-EXT-COLOR-157-COATED-LARGE-1000',
        name: '157克双铜纸彩印 大号',
        product: {
          id: 'EXT-COLOR-157-COATED-LARGE',
          name: '157克双铜纸彩印 大号',
          specification: '大号',
          paperType: '157克双铜纸',
        },
        tierCount: 7,
        activeTierCount: 7,
        changed: true,
      }),
    );
    expect(result.groups[0]?.tiers.map((tier) => tier.draft?.minQty)).toEqual(
      quantities157,
    );
    expect(result.draft?.changedCount).toBe(1);
    expect(result.groups[0]?.tiers.map((tier) => tier.changed)).toEqual([
      false,
      true,
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(result.groups[0]?.tiers[1]).toEqual(
      expect.objectContaining({
        current: expect.objectContaining({ amount: '395' }),
        draft: expect.objectContaining({ amount: '425' }),
        changed: true,
        expectedUpdatedAt: draftUpdatedAt.toISOString(),
      }),
    );
    const groupedRead = dbMock.customerPriceRule.findMany.mock.calls[2]?.[0];
    expect(groupedRead).not.toHaveProperty('skip');
    expect(groupedRead).not.toHaveProperty('take');
    const serialized = JSON.stringify(result.groups);
    for (const forbidden of [
      'BASE_EXT-COLOR',
      'triggerCondition',
      'sourceSheet',
      'sourceRange',
      'sourceName',
      'sourceSha256',
      'exclusiveGroup',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('applies active filters to complete groups instead of individual tiers', async () => {
    const mixed = [100, 200].map((quantity, index) => ({
      ...exactPriceTier({
        version: 'current' as const,
        productId: 'product-mixed',
        productName: '混合启停产品',
        specification: '大号',
        paperType: '157克双铜纸',
        quantity,
        amount: String(quantity),
      }),
      isActive: index === 0,
    }));
    const inactive = [100, 200].map((quantity) => ({
      ...exactPriceTier({
        version: 'current' as const,
        productId: 'product-inactive',
        productName: '全部停用产品',
        specification: '大号',
        paperType: '200克双铜纸',
        quantity,
        amount: String(quantity),
      }),
      isActive: false,
    }));
    const rules = [...mixed, ...inactive];
    dbMock.customerPriceBook.findMany.mockResolvedValue([currentBook]);
    dbMock.customerPriceRule.findMany.mockResolvedValue(rules);

    const activeResult = await getCustomerPriceRuleGroupWorkspacePage(
      {
        purpose: CustomerPriceBookPurpose.PROCESSING,
        active: 'ACTIVE',
      },
      now,
    );
    const inactiveResult = await getCustomerPriceRuleGroupWorkspacePage(
      {
        purpose: CustomerPriceBookPurpose.PROCESSING,
        active: 'INACTIVE',
      },
      now,
    );

    expect(activeResult).toEqual(
      expect.objectContaining({ total: 1, pageCount: 1 }),
    );
    expect(activeResult.groups[0]).toEqual(
      expect.objectContaining({
        product: expect.objectContaining({ id: 'product-mixed' }),
        tierCount: 2,
        activeTierCount: 1,
      }),
    );
    expect(inactiveResult).toEqual(
      expect.objectContaining({ total: 1, pageCount: 1 }),
    );
    expect(inactiveResult.groups[0]).toEqual(
      expect.objectContaining({
        product: expect.objectContaining({ id: 'product-inactive' }),
        tierCount: 2,
        activeTierCount: 0,
      }),
    );
    expect(dbMock.customerPriceRule.findMany.mock.calls[0]?.[0].where).not.toHaveProperty(
      'isActive',
    );
    expect(dbMock.customerPriceRule.findMany.mock.calls[2]?.[0].where).not.toHaveProperty(
      'isActive',
    );
  });

  it('keeps changed group filters mutually exclusive and ignores matcher-array order', async () => {
    const currentChanged = [100, 200].map((quantity) =>
      exactPriceTier({
        version: 'current',
        productId: 'product-changed',
        productName: '有价格变更产品',
        specification: '大号',
        paperType: '157克双铜纸',
        quantity,
        amount: String(quantity),
      }),
    );
    const currentUnchanged = [100, 200].map((quantity) =>
      exactPriceTier({
        version: 'current',
        productId: 'product-unchanged',
        productName: '未变更产品',
        specification: '大号',
        paperType: '200克双铜纸',
        quantity,
        amount: String(quantity),
      }),
    );
    const asDraft = (
      tier: ReturnType<typeof exactPriceTier>,
      amount = String(tier.amount),
    ) => {
      const triggerCondition = tier.triggerCondition as Record<string, unknown>;
      const paperTypes = triggerCondition.paperTypes as string[];
      return {
        ...tier,
        id: tier.id.replace('current', 'draft'),
        priceBookId: draftBook.id,
        amount,
        triggerCondition: {
          ...triggerCondition,
          paperTypes: [...paperTypes].reverse(),
        },
        updatedAt: draftUpdatedAt,
      };
    };
    const draftChanged = currentChanged.map((tier, index) =>
      asDraft(tier, index === 1 ? '225.0000' : String(tier.amount)),
    );
    const draftUnchanged = currentUnchanged.map((tier) => asDraft(tier));
    const draftRules = [...draftChanged, ...draftUnchanged];
    const currentRules = [...currentChanged, ...currentUnchanged];
    dbMock.customerPriceBook.findMany.mockResolvedValue([draftBook, currentBook]);
    dbMock.customerPriceRule.findMany
      .mockResolvedValueOnce(draftRules)
      .mockResolvedValueOnce(currentRules)
      .mockResolvedValueOnce(draftRules)
      .mockResolvedValueOnce(draftRules)
      .mockResolvedValueOnce(currentRules)
      .mockResolvedValueOnce(draftRules);

    const changedResult = await getCustomerPriceRuleGroupWorkspacePage(
      {
        purpose: CustomerPriceBookPurpose.PROCESSING,
        changed: true,
      },
      now,
    );
    const unchangedResult = await getCustomerPriceRuleGroupWorkspacePage(
      {
        purpose: CustomerPriceBookPurpose.PROCESSING,
        changed: false,
      },
      now,
    );

    expect(changedResult).toEqual(
      expect.objectContaining({ total: 1, pageCount: 1 }),
    );
    expect(changedResult.draft?.changedCount).toBe(1);
    expect(changedResult.groups[0]).toEqual(
      expect.objectContaining({
        product: expect.objectContaining({ id: 'product-changed' }),
        changed: true,
      }),
    );
    expect(changedResult.groups[0]?.tiers.map((tier) => tier.changed)).toEqual([
      false,
      true,
    ]);
    expect(unchangedResult).toEqual(
      expect.objectContaining({ total: 1, pageCount: 1 }),
    );
    expect(unchangedResult.groups[0]).toEqual(
      expect.objectContaining({
        product: expect.objectContaining({ id: 'product-unchanged' }),
        changed: false,
      }),
    );
    expect(unchangedResult.groups[0]?.tiers.every((tier) => !tier.changed)).toBe(
      true,
    );
    for (const callIndex of [2, 5]) {
      const where = dbMock.customerPriceRule.findMany.mock.calls[callIndex]?.[0]
        .where;
      expect(JSON.stringify(where)).not.toContain('"code"');
    }
  });

  it('uses provenance gates and never collapses ordinary range rules', async () => {
    const exactA = exactPriceTier({
      version: 'current',
      productId: 'product-a',
      productName: '产品 A',
      specification: '大号',
      paperType: '157克双铜纸',
      quantity: 100,
      amount: '100',
      sourceSheet: '彩印 A',
    });
    const exactB = exactPriceTier({
      version: 'current',
      productId: 'product-a',
      productName: '产品 A',
      specification: '大号',
      paperType: '157克双铜纸',
      quantity: 200,
      amount: '180',
      sourceSheet: '彩印 B',
    });
    const rangeA = rule({
      ...exactA,
      id: 'range-a',
      code: 'RANGE_A',
      name: '区间收费 1',
      minQty: 1,
      maxQty: 999,
    });
    const rangeB = rule({
      ...exactA,
      id: 'range-b',
      code: 'RANGE_B',
      name: '区间收费 2',
      minQty: 1_000,
      maxQty: 1_999,
    });
    const termA = {
      ...exactPriceTier({
        version: 'current' as const,
        productId: 'product-b',
        productName: '产品 B',
        specification: '大号',
        paperType: '157克双铜纸',
        quantity: 100,
        amount: '100',
      }),
      includedUnits: '1.000',
      incrementUnits: '1.000',
      incrementAmount: '2.0000',
    };
    const termB = {
      ...exactPriceTier({
        version: 'current' as const,
        productId: 'product-b',
        productName: '产品 B',
        specification: '大号',
        paperType: '157克双铜纸',
        quantity: 200,
        amount: '180',
      }),
      includedUnits: '2.000',
      incrementUnits: '1.000',
      incrementAmount: '2.0000',
    };
    const rules = [exactA, exactB, rangeA, rangeB, termA, termB];
    dbMock.customerPriceBook.findMany.mockResolvedValue([currentBook]);
    dbMock.customerPriceRule.findMany
      .mockResolvedValueOnce(rules)
      .mockResolvedValueOnce(rules);

    const result = await getCustomerPriceRuleGroupWorkspacePage(
      { purpose: CustomerPriceBookPurpose.PROCESSING },
      now,
    );

    expect(result.total).toBe(6);
    expect(result.groups).toHaveLength(6);
    expect(result.groups.every((group) => group.tierCount === 1)).toBe(true);
  });

  it('opens a draft group from a stable current-tier id and returns every paired tier', async () => {
    const currentTiers = [1_000, 2_000].map((quantity) =>
      exactPriceTier({
        version: 'current',
        productId: 'EXT-COLOR-157-COATED-LARGE',
        productName: '157克双铜纸彩印 大号',
        specification: '大号',
        paperType: '157克双铜纸',
        quantity,
        amount: quantity === 1_000 ? '295' : '420',
      }),
    );
    const draftTiers = currentTiers.map((tier) => ({
      ...tier,
      id: tier.id.replace('current', 'draft'),
      priceBookId: draftBook.id,
      amount: tier.minQty === 2_000 ? '430.0000' : tier.amount,
      updatedAt: draftUpdatedAt,
    }));
    dbMock.customerPriceBook.findMany.mockResolvedValue([draftBook, currentBook]);
    dbMock.customerPriceRule.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(currentTiers[1])
      .mockResolvedValueOnce(draftTiers[1]);
    dbMock.customerPriceRule.findMany
      .mockResolvedValueOnce(draftTiers)
      .mockResolvedValueOnce(currentTiers);

    const detail = await getCustomerPriceRuleGroupWorkspaceDetail(
      {
        purpose: CustomerPriceBookPurpose.PROCESSING,
        groupId: currentTiers[1]!.id,
      },
      now,
    );

    expect(dbMock.customerPriceRule.findFirst).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: { id: currentTiers[1]!.id, priceBookId: currentBook.id },
      }),
    );
    expect(dbMock.customerPriceRule.findFirst).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        where: {
          priceBookId: draftBook.id,
          code: currentTiers[1]!.code,
        },
      }),
    );
    expect(detail).toEqual(
      expect.objectContaining({
        editable: true,
        group: expect.objectContaining({
          id: currentTiers[0]!.id,
          tierCount: 2,
          changed: true,
        }),
      }),
    );
    expect(detail?.group.tiers).toEqual([
      expect.objectContaining({
        current: expect.objectContaining({ minQty: 1_000, amount: '295' }),
        draft: expect.objectContaining({ minQty: 1_000, amount: '295' }),
        changed: false,
      }),
      expect.objectContaining({
        current: expect.objectContaining({ minQty: 2_000, amount: '420' }),
        draft: expect.objectContaining({ minQty: 2_000, amount: '430' }),
        changed: true,
      }),
    ]);
  });
});
