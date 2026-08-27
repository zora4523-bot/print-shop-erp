import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrderItemPricingRoute, Role } from '../../generated/prisma/enums';
import { UnauthorizedError } from '../../lib/auth/errors';
import { RULE_CENTER_HREFS } from '../../lib/navigation/rule-center';
import { EMPTY_CUSTOMER_RULE_CONDITION_EDITOR_INPUT } from '../../lib/price/customer-rule-condition';

const {
  permissionMock,
  adminMock,
  revalidateMock,
  MockAdminError,
  MockValidationError,
} = vi.hoisted(() => {
  class AdminError extends Error {}
  class ValidationError extends AdminError {
    issues: Array<{ path: string; message: string }>;

    constructor(issues: Array<{ path: string; message: string }>) {
      super('价目簿规则校验未通过');
      this.issues = issues;
    }
  }
  return {
    permissionMock: { requirePermission: vi.fn() },
    adminMock: {
      createCustomerPriceBookDraft: vi.fn(),
      updateCustomerPriceRuleDraft: vi.fn(),
      updateCustomerPriceRuleDraftGroup: vi.fn(),
      publishCustomerPriceBookDraft: vi.fn(),
      discardCustomerPriceBookDraft: vi.fn(),
    },
    revalidateMock: vi.fn(),
    MockAdminError: AdminError,
    MockValidationError: ValidationError,
  };
});

vi.mock('@/lib/auth/permissions', () => ({
  requirePermission: permissionMock.requirePermission,
}));
vi.mock('@/lib/price/customer-price-book-admin', () => ({
  ...adminMock,
  CustomerPriceBookAdminError: MockAdminError,
  CustomerPriceBookValidationError: MockValidationError,
}));
vi.mock('next/cache', () => ({ revalidatePath: revalidateMock }));

import {
  createCustomerPriceBookDraftAction,
  discardCustomerPriceBookDraftAction,
  publishCustomerPriceBookDraftAction,
  updateCustomerPriceRuleDraftAction,
  updateCustomerPriceRuleDraftGroupAction,
} from '../customer-price-books';

const actor = {
  id: 'owner-1',
  role: Role.ADMIN,
  username: 'owner',
  displayName: '管理员',
};

const validRule = {
  priceBookId: 'book-v2-draft',
  ruleId: 'rule-v2-a',
  expectedUpdatedAt: '2026-08-09T02:00:00.000Z',
  name: '基础报价 A',
  categoryId: 'category-base',
  productId: 'product-a',
  kind: 'BASE' as const,
  calculationType: 'PER_PIECE' as const,
  unitsPerSheet: null,
  amount: '0.1350',
  includedUnits: null,
  incrementUnits: null,
  incrementAmount: null,
  minQty: 1,
  maxQty: 1_000,
  blocksAutomaticQuote: false,
  match: {
    ...EMPTY_CUSTOMER_RULE_CONDITION_EDITOR_INPUT,
    pricingRoutes: [OrderItemPricingRoute.STOCK_BLANK],
  },
  isActive: true,
};

const validGroup = {
  priceBookId: 'book-v2-draft',
  anchorRuleId: 'rule-v2-a',
  rows: [
    {
      ruleId: 'rule-v2-a',
      expectedUpdatedAt: '2026-08-09T02:00:00.000Z',
      amount: '295.0000',
      isActive: true,
    },
    {
      ruleId: 'rule-v2-b',
      expectedUpdatedAt: '2026-08-09T02:01:00.000Z',
      amount: '420',
      isActive: true,
    },
  ],
};

beforeEach(() => {
  permissionMock.requirePermission.mockReset();
  for (const method of Object.values(adminMock)) method.mockReset();
  revalidateMock.mockReset();
});

describe('customer price-book Server Actions', () => {
  it.each([
    ['create', () => createCustomerPriceBookDraftAction({ purpose: 'PROCESSING', changeReason: '调整价格' })],
    ['update', () => updateCustomerPriceRuleDraftAction(validRule)],
    ['group update', () => updateCustomerPriceRuleDraftGroupAction(validGroup)],
    ['publish', () => publishCustomerPriceBookDraftAction({ priceBookId: 'book-v2-draft', expectedDraftUpdatedAt: '2026-08-09T02:00:00.000Z', effectiveFrom: '2026-08-10T09:30', publishNote: '已完成价格复核', confirmedImpact: true })],
    ['discard', () => discardCustomerPriceBookDraftAction({ priceBookId: 'book-v2-draft', expectedDraftUpdatedAt: '2026-08-09T02:00:00.000Z' })],
  ])('checks dict:price:manage before %s input processing', async (_label, invoke) => {
    permissionMock.requirePermission.mockRejectedValue(new UnauthorizedError('未登录'));

    await expect(invoke()).rejects.toBeInstanceOf(UnauthorizedError);

    expect(permissionMock.requirePermission).toHaveBeenCalledWith('dict:price:manage');
    expect(adminMock.createCustomerPriceBookDraft).not.toHaveBeenCalled();
    expect(adminMock.updateCustomerPriceRuleDraft).not.toHaveBeenCalled();
    expect(adminMock.updateCustomerPriceRuleDraftGroup).not.toHaveBeenCalled();
    expect(adminMock.publishCustomerPriceBookDraft).not.toHaveBeenCalled();
    expect(adminMock.discardCustomerPriceBookDraft).not.toHaveBeenCalled();
  });

  it('creates one typed draft and returns only its identity', async () => {
    permissionMock.requirePermission.mockResolvedValue(actor);
    adminMock.createCustomerPriceBookDraft.mockResolvedValue({
      id: 'book-v2-draft',
      version: 2,
      purpose: 'PROCESSING',
    });

    await expect(
      createCustomerPriceBookDraftAction({
        purpose: 'PROCESSING',
        changeReason: '  调整加工费  ',
      }),
    ).resolves.toEqual({
      status: 'success',
      priceBookId: 'book-v2-draft',
      version: 2,
    });

    expect(adminMock.createCustomerPriceBookDraft).toHaveBeenCalledWith(
      { purpose: 'PROCESSING', changeReason: '调整加工费' },
      actor,
    );
    expect(revalidateMock).toHaveBeenCalledWith('/owner/prices/external-sales');
    expect(revalidateMock).toHaveBeenCalledWith(
      RULE_CENTER_HREFS.customerPricing,
    );
    expect(revalidateMock).toHaveBeenCalledWith(
      RULE_CENTER_HREFS.priceVersions,
    );
  });

  it('passes only editable business fields to the locked DAL', async () => {
    permissionMock.requirePermission.mockResolvedValue(actor);
    adminMock.updateCustomerPriceRuleDraft.mockResolvedValue({
      id: 'rule-v2-a',
      priceBookId: 'book-v2-draft',
    });

    await expect(updateCustomerPriceRuleDraftAction(validRule)).resolves.toEqual({
      status: 'success',
      priceBookId: 'book-v2-draft',
      ruleId: 'rule-v2-a',
    });

    expect(adminMock.updateCustomerPriceRuleDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedUpdatedAt: new Date('2026-08-09T02:00:00.000Z'),
        amount: '0.1350',
      }),
      actor,
    );
    const written = adminMock.updateCustomerPriceRuleDraft.mock.calls[0]![0];
    expect(written).not.toHaveProperty('sourceSha256');
    expect(written).not.toHaveProperty('sourceRange');
    expect(written).not.toHaveProperty('triggerCondition');
    expect(written).not.toHaveProperty('exclusiveGroup');
    expect(written).not.toHaveProperty('priority');
    expect(written).not.toHaveProperty('note');
  });

  it('accepts a positive sheet capacity and passes it to the locked DAL', async () => {
    permissionMock.requirePermission.mockResolvedValue(actor);
    adminMock.updateCustomerPriceRuleDraft.mockResolvedValue({
      id: 'rule-v2-a',
      priceBookId: 'book-v2-draft',
    });

    await expect(
      updateCustomerPriceRuleDraftAction({
        ...validRule,
        calculationType: 'PER_SHEET',
        unitsPerSheet: 4,
      }),
    ).resolves.toEqual({
      status: 'success',
      priceBookId: 'book-v2-draft',
      ruleId: 'rule-v2-a',
    });

    expect(adminMock.updateCustomerPriceRuleDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        calculationType: 'PER_SHEET',
        unitsPerSheet: 4,
      }),
      actor,
    );
  });

  it('将烫金道数条件和按道数乘算完整传入锁定数据层', async () => {
    permissionMock.requirePermission.mockResolvedValue(actor);
    adminMock.updateCustomerPriceRuleDraft.mockResolvedValue({
      id: 'rule-v2-a',
      priceBookId: 'book-v2-draft',
    });

    const match = {
      ...validRule.match,
      foilPassCount: 3,
      perFoilPass: true,
    };
    await expect(
      updateCustomerPriceRuleDraftAction({ ...validRule, match }),
    ).resolves.toMatchObject({ status: 'success', ruleId: 'rule-v2-a' });

    expect(adminMock.updateCustomerPriceRuleDraft).toHaveBeenCalledWith(
      expect.objectContaining({ match }),
      actor,
    );
  });

  it('拒绝同时按烫金颜色数和烫金道数重复乘算', async () => {
    permissionMock.requirePermission.mockResolvedValue(actor);

    const result = await updateCustomerPriceRuleDraftAction({
      ...validRule,
      match: {
        ...validRule.match,
        perFoilColor: true,
        perFoilPass: true,
      },
    });

    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') {
      expect(result.fieldErrors['match.perFoilPass']?.join('\n')).toContain(
        '烫金颜色倍数与烫金道数倍数只能选择一种',
      );
    }
    expect(adminMock.updateCustomerPriceRuleDraft).not.toHaveBeenCalled();
  });

  it('saves one complete price ladder with only row amounts and active states', async () => {
    permissionMock.requirePermission.mockResolvedValue(actor);
    adminMock.updateCustomerPriceRuleDraftGroup.mockResolvedValue({
      priceBookId: 'book-v2-draft',
      ruleIds: ['rule-v2-a', 'rule-v2-b'],
    });

    await expect(
      updateCustomerPriceRuleDraftGroupAction(validGroup),
    ).resolves.toEqual({
      status: 'success',
      priceBookId: 'book-v2-draft',
      ruleIds: ['rule-v2-a', 'rule-v2-b'],
    });

    expect(adminMock.updateCustomerPriceRuleDraftGroup).toHaveBeenCalledWith(
      {
        priceBookId: 'book-v2-draft',
        anchorRuleId: 'rule-v2-a',
        rows: [
          {
            ruleId: 'rule-v2-a',
            expectedUpdatedAt: new Date('2026-08-09T02:00:00.000Z'),
            amount: '295.0000',
            isActive: true,
          },
          {
            ruleId: 'rule-v2-b',
            expectedUpdatedAt: new Date('2026-08-09T02:01:00.000Z'),
            amount: '420',
            isActive: true,
          },
        ],
      },
      actor,
    );
    expect(revalidateMock).toHaveBeenCalledWith(
      '/owner/prices/external-sales/items',
    );
  });

  it.each([
    [
      'duplicate rows',
      {
        ...validGroup,
        rows: [validGroup.rows[0], validGroup.rows[0]],
      },
    ],
    [
      'an anchor outside the submitted group',
      { ...validGroup, anchorRuleId: 'rule-v2-c' },
    ],
    [
      'an over-precision amount',
      {
        ...validGroup,
        rows: [
          { ...validGroup.rows[0], amount: '295.00001' },
          validGroup.rows[1],
        ],
      },
    ],
    [
      'injected matcher data',
      {
        ...validGroup,
        rows: validGroup.rows.map((row) => ({
          ...row,
          triggerCondition: { productCodes: ['HOSTILE'] },
        })),
      },
    ],
  ])('rejects %s before the group DAL', async (_label, raw) => {
    permissionMock.requirePermission.mockResolvedValue(actor);

    const result = await updateCustomerPriceRuleDraftGroupAction(
      raw as typeof validGroup,
    );

    expect(result.status).toBe('invalid');
    expect(adminMock.updateCustomerPriceRuleDraftGroup).not.toHaveBeenCalled();
  });

  it('maps group amount validation to the matching row without hiding global issues', async () => {
    permissionMock.requirePermission.mockResolvedValue(actor);
    adminMock.updateCustomerPriceRuleDraftGroup.mockRejectedValue(
      new MockValidationError([
        {
          path: 'rules.rule-v2-b.amount',
          message: '基础价金额必须大于零',
        },
        {
          path: 'rules.rule-v2-b.triggerCondition',
          message: '匹配条件不完整',
        },
        { path: 'rules', message: '价目簿至少需要一条启用规则' },
      ]),
    );

    await expect(
      updateCustomerPriceRuleDraftGroupAction(validGroup),
    ).resolves.toEqual({
      status: 'invalid',
      fieldErrors: {
        'rows.1.amount': ['基础价金额必须大于零'],
        'rules.rule-v2-b.triggerCondition': ['匹配条件不完整'],
        rules: ['价目簿至少需要一条启用规则'],
      },
    });
  });

  it.each([
    ['omitted', undefined],
    ['blank', null],
    ['zero', 0],
    ['fraction', 1.5],
  ])('rejects a %s sheet capacity before calling the DAL', async (_label, value) => {
    permissionMock.requirePermission.mockResolvedValue(actor);

    const result = await updateCustomerPriceRuleDraftAction({
      ...validRule,
      calculationType: 'PER_SHEET',
      unitsPerSheet: value,
    });

    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') {
      expect(result.fieldErrors.unitsPerSheet?.length).toBeGreaterThan(0);
    }
    expect(adminMock.updateCustomerPriceRuleDraft).not.toHaveBeenCalled();
  });

  it('rejects injected matching or provenance fields before calling the DAL', async () => {
    permissionMock.requirePermission.mockResolvedValue(actor);

    const result = await updateCustomerPriceRuleDraftAction({
      ...validRule,
      triggerCondition: { productCodes: ['HOSTILE'] },
    } as typeof validRule);

    expect(result.status).toBe('invalid');
    expect(adminMock.updateCustomerPriceRuleDraft).not.toHaveBeenCalled();
  });

  it('rejects the historical manual route at the draft-write boundary', async () => {
    permissionMock.requirePermission.mockResolvedValue(actor);

    const result = await updateCustomerPriceRuleDraftAction({
      ...validRule,
      match: {
        ...validRule.match,
        pricingRoutes: [OrderItemPricingRoute.MANUAL_QUOTE],
      },
    });

    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') {
      expect(
        Object.keys(result.fieldErrors).some((path) =>
          path.startsWith('match.pricingRoutes'),
        ),
      ).toBe(true);
    }
    expect(adminMock.updateCustomerPriceRuleDraft).not.toHaveBeenCalled();
  });

  it('篡改的计价与工艺枚举只返回中文业务错误', async () => {
    permissionMock.requirePermission.mockResolvedValue(actor);

    const result = await updateCustomerPriceRuleDraftAction({
      ...validRule,
      kind: 'INTERNAL_RULE_KIND',
      calculationType: 'INTERNAL_CALCULATION_TYPE',
      match: {
        ...validRule.match,
        pricingRoutes: ['INTERNAL_ROUTE_TOKEN'],
        craftMode: 'INTERNAL_MATCH_MODE',
      },
      rawField: 'INTERNAL_RAW_VALUE',
    } as unknown as typeof validRule);

    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') {
      const messages = Object.values(result.fieldErrors).flat().join('\n');
      expect(messages).toContain('请选择有效的计价方式');
      expect(messages).toContain('请选择有效的多工艺条件');
      expect(messages).toContain('收费类型设置无效');
      expect(messages).toContain('计价方式设置无效');
      expect(messages).toContain('提交内容包含页面不支持的字段');
      expect(messages).not.toMatch(
        /INTERNAL_|rawField|STOCK_BLANK|CUSTOM_SINGLE_FLAT_FOIL|COLOR_PRINT|\bANY\b|\bALL\b|BASE|ADD_ON|REFERENCE|PER_PIECE|PER_BAG/,
      );
    }
    expect(adminMock.updateCustomerPriceRuleDraft).not.toHaveBeenCalled();
  });

  it('rejects over-precision prices before calling the DAL', async () => {
    permissionMock.requirePermission.mockResolvedValue(actor);

    const result = await updateCustomerPriceRuleDraftAction({
      ...validRule,
      amount: '0.13501',
    });

    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') {
      expect(result.fieldErrors.amount?.join('\n')).toContain('最多 4 位小数');
    }
    expect(adminMock.updateCustomerPriceRuleDraft).not.toHaveBeenCalled();
  });

  it('rejects a non-exact rule version timestamp before calling the DAL', async () => {
    permissionMock.requirePermission.mockResolvedValue(actor);

    const result = await updateCustomerPriceRuleDraftAction({
      ...validRule,
      expectedUpdatedAt: '2026-08-09 10:00',
    });

    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') {
      expect(result.fieldErrors.expectedUpdatedAt?.join('\n')).toContain(
        '版本时间格式非法',
      );
    }
    expect(adminMock.updateCustomerPriceRuleDraft).not.toHaveBeenCalled();
  });

  it('maps current editable rule conflicts to form fields without hiding other domain issues', async () => {
    permissionMock.requirePermission.mockResolvedValue(actor);
    adminMock.updateCustomerPriceRuleDraft.mockRejectedValue(
      new MockValidationError([
        {
          path: 'rules.rule-v2-a.minQty',
          message: '基础报价数量区间重叠',
        },
        {
          path: 'rules.rule-v2-a.amount',
          message: '基础价金额必须大于零',
        },
        {
          path: 'rules.rule-v2-a.triggerCondition',
          message: '当前规则的匹配条件不完整',
        },
        {
          path: 'rules.rule-v2-b.maxQty',
          message: '另一条规则的数量区间重叠',
        },
        {
          path: 'rules',
          message: '价目簿至少需要一条启用规则',
        },
      ]),
    );

    await expect(updateCustomerPriceRuleDraftAction(validRule)).resolves.toEqual({
      status: 'invalid',
      fieldErrors: {
        minQty: ['基础报价数量区间重叠'],
        amount: ['基础价金额必须大于零'],
        match: ['当前规则的匹配条件不完整'],
        'rules.rule-v2-b.maxQty': ['另一条规则的数量区间重叠'],
        rules: ['价目簿至少需要一条启用规则'],
      },
    });
  });

  it('parses publish time as an explicit Shanghai wall time', async () => {
    permissionMock.requirePermission.mockResolvedValue(actor);
    adminMock.publishCustomerPriceBookDraft.mockResolvedValue({
      id: 'book-v2-draft',
      version: 2,
      purpose: 'PROCESSING',
    });

    await publishCustomerPriceBookDraftAction({
      priceBookId: 'book-v2-draft',
      expectedDraftUpdatedAt: '2026-08-09T02:00:00.000Z',
      effectiveFrom: '2026-08-10T09:30',
      publishNote: '已完成价格复核',
      confirmedImpact: true,
    });

    expect(adminMock.publishCustomerPriceBookDraft).toHaveBeenCalledWith(
      {
        priceBookId: 'book-v2-draft',
        expectedDraftUpdatedAt: new Date('2026-08-09T02:00:00.000Z'),
        effectiveFrom: new Date('2026-08-10T01:30:00.000Z'),
        publishNote: '已完成价格复核',
      },
      actor,
    );
  });

  it('拒绝缺少发布说明或 L3 影响确认的请求', async () => {
    permissionMock.requirePermission.mockResolvedValue(actor);

    const result = await publishCustomerPriceBookDraftAction({
      priceBookId: 'book-v2-draft',
      expectedDraftUpdatedAt: '2026-08-09T02:00:00.000Z',
      effectiveFrom: '2026-08-10T09:30',
      publishNote: '',
      confirmedImpact: false,
    });

    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') {
      expect(result.fieldErrors.publishNote?.join('\n')).toContain('发布说明');
      expect(result.fieldErrors.confirmedImpact?.join('\n')).toContain('影响范围');
    }
    expect(adminMock.publishCustomerPriceBookDraft).not.toHaveBeenCalled();
  });

  it.each([
    [
      'publish',
      () =>
        publishCustomerPriceBookDraftAction({
          priceBookId: 'book-v2-draft',
          expectedDraftUpdatedAt: '2026-08-09 10:00',
          effectiveFrom: '2026-08-10T09:30',
          publishNote: '已完成价格复核',
          confirmedImpact: true,
        }),
    ],
    [
      'discard',
      () =>
        discardCustomerPriceBookDraftAction({
          priceBookId: 'book-v2-draft',
          expectedDraftUpdatedAt: '2026-08-09 10:00',
        }),
    ],
  ])('rejects stale-intent timestamp format before %s', async (_label, invoke) => {
    permissionMock.requirePermission.mockResolvedValue(actor);

    const result = await invoke();

    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') {
      expect(result.fieldErrors.expectedDraftUpdatedAt?.join('\n')).toContain(
        '版本时间格式非法',
      );
    }
    expect(adminMock.publishCustomerPriceBookDraft).not.toHaveBeenCalled();
    expect(adminMock.discardCustomerPriceBookDraft).not.toHaveBeenCalled();
  });

  it('discards through the locked DAL and invalidates all quote entries', async () => {
    permissionMock.requirePermission.mockResolvedValue(actor);
    adminMock.discardCustomerPriceBookDraft.mockResolvedValue({
      id: 'book-v2-draft',
      purpose: 'PROCESSING',
    });

    await expect(
      discardCustomerPriceBookDraftAction({
        priceBookId: 'book-v2-draft',
        expectedDraftUpdatedAt: '2026-08-09T02:00:00.000Z',
      }),
    ).resolves.toEqual({ status: 'success', priceBookId: 'book-v2-draft' });

    expect(adminMock.discardCustomerPriceBookDraft).toHaveBeenCalledWith(
      {
        priceBookId: 'book-v2-draft',
        expectedDraftUpdatedAt: new Date('2026-08-09T02:00:00.000Z'),
      },
      actor,
    );
    expect(revalidateMock).toHaveBeenCalledWith('/orders/new');
  });
});
