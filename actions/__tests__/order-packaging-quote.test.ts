import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  OrderPackagingMode,
  OrderSettlementType,
  Role,
} from '../../generated/prisma/enums';
import { UnauthorizedError } from '../../lib/auth/errors';

const { requirePermissionMock, quoteOrderPackagingGroupsMock } = vi.hoisted(
  () => ({
    requirePermissionMock: vi.fn(),
    quoteOrderPackagingGroupsMock: vi.fn(),
  }),
);

vi.mock('@/lib/auth/permissions', () => ({
  requirePermission: requirePermissionMock,
}));
vi.mock('@/lib/price/order-packaging-quote', () => ({
  quoteOrderPackagingGroups: quoteOrderPackagingGroupsMock,
}));

import { quoteOrderPackagingGroupsAction } from '../order-packaging-quote';

const validInput = {
  groups: [
    {
      groupKey: 'group-1',
      mode: OrderPackagingMode.SINGLE_STYLE,
      actualBagCount: 10,
    },
    {
      groupKey: 'group-2',
      mode: OrderPackagingMode.MIXED_STYLE,
      actualBagCount: 5,
    },
  ],
};

const completeQuote = {
  priceBook: {
    id: 'internal-book-id',
    code: 'INTERNAL_BOOK_CODE',
    name: '当前加工费价目',
    version: 2,
    sourceName: 'internal.xlsx',
    sourceSha256: 'private-sha256',
  },
  groups: [
    {
      groupKey: 'group-1',
      complete: true,
      errors: [],
      suggestedUnitPrice: '0.1000',
      suggestedSubtotal: '1.00',
      snapshot: { privateRuleId: 'rule-1' },
    },
    {
      groupKey: 'group-2',
      complete: true,
      errors: [],
      suggestedUnitPrice: '0.2000',
      suggestedSubtotal: '1.00',
      snapshot: { privateRuleId: 'rule-2' },
    },
  ],
  suggestedTotal: '2.00',
  requiresAdminConfirmation: false,
  errors: [],
};

beforeEach(() => {
  requirePermissionMock.mockReset();
  quoteOrderPackagingGroupsMock.mockReset();
});

describe('quoteOrderPackagingGroupsAction', () => {
  it('checks order:create before parsing or reading packaging rules', async () => {
    requirePermissionMock.mockRejectedValue(new UnauthorizedError('未登录'));

    await expect(
      quoteOrderPackagingGroupsAction({ groups: [] }),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    expect(requirePermissionMock).toHaveBeenCalledWith('order:create');
    expect(quoteOrderPackagingGroupsMock).not.toHaveBeenCalled();
  });

  it.each([
    [Role.SALES, OrderSettlementType.EXTERNAL_SALES],
    [Role.CUSTOMER_SERVICE, OrderSettlementType.INTERNAL_SALES],
    [Role.ADMIN, OrderSettlementType.FACTORY_DIRECT],
  ])(
    'quotes against the current creator settlement direction for %s',
    async (role, settlementType) => {
      requirePermissionMock.mockResolvedValue({ id: 'actor-1', role });
      quoteOrderPackagingGroupsMock.mockResolvedValue(completeQuote);

      const result = await quoteOrderPackagingGroupsAction(validInput);

      expect(result.status).toBe('success');
      expect(quoteOrderPackagingGroupsMock).toHaveBeenCalledWith(
        validInput.groups,
        settlementType,
      );
    },
  );

  it.each([
    {
      label: '没有包装组',
      raw: { groups: [] },
    },
    {
      label: '袋数为零',
      raw: {
        groups: [{ ...validInput.groups[0], actualBagCount: 0 }],
      },
    },
    {
      label: '字符串袋数',
      raw: {
        groups: [{ ...validInput.groups[0], actualBagCount: '10' }],
      },
    },
    {
      label: '非法包装方式',
      raw: {
        groups: [{ ...validInput.groups[0], mode: 'UNKNOWN_MODE' }],
      },
    },
    {
      label: '重复包装组标识',
      raw: {
        groups: [validInput.groups[0], validInput.groups[0]],
      },
    },
    {
      label: '超过 20 个包装组',
      raw: {
        groups: Array.from({ length: 21 }, (_, index) => ({
          ...validInput.groups[0],
          groupKey: `group-${index + 1}`,
        })),
      },
    },
  ])('rejects $label before reading the price book', async ({ raw }) => {
    requirePermissionMock.mockResolvedValue({ id: 'sales-1', role: Role.SALES });

    const result = await quoteOrderPackagingGroupsAction(raw);

    expect(result.status).toBe('invalid');
    expect(JSON.stringify(result)).toMatch(/[一-鿿]/u);
    expect(quoteOrderPackagingGroupsMock).not.toHaveBeenCalled();
  });

  it('strips forged prices, rules, snapshots, and price-book ids', async () => {
    requirePermissionMock.mockResolvedValue({ id: 'sales-1', role: Role.SALES });
    quoteOrderPackagingGroupsMock.mockResolvedValue(completeQuote);

    await quoteOrderPackagingGroupsAction({
      ...validInput,
      priceBookId: 'forged-book',
      suggestedTotal: '0.01',
      groups: validInput.groups.map((group) => ({
        ...group,
        suggestedSubtotal: '0.01',
        ruleId: 'forged-rule',
        snapshot: { rate: '0.0001' },
      })),
    });

    expect(quoteOrderPackagingGroupsMock).toHaveBeenCalledWith(
      validInput.groups,
      OrderSettlementType.EXTERNAL_SALES,
    );
  });

  it('returns per-group rates, subtotals and total without internal snapshots', async () => {
    requirePermissionMock.mockResolvedValue({ id: 'sales-1', role: Role.SALES });
    quoteOrderPackagingGroupsMock.mockResolvedValue(completeQuote);

    const result = await quoteOrderPackagingGroupsAction(validInput);

    expect(result).toEqual({
      status: 'success',
      quote: {
        groups: [
          {
            groupKey: 'group-1',
            complete: true,
            errors: [],
            suggestedUnitPrice: '0.1000',
            suggestedSubtotal: '1.00',
          },
          {
            groupKey: 'group-2',
            complete: true,
            errors: [],
            suggestedUnitPrice: '0.2000',
            suggestedSubtotal: '1.00',
          },
        ],
        suggestedTotal: '2.00',
        requiresAdminConfirmation: false,
        errors: [],
      },
    });
    expect(JSON.stringify(result)).not.toContain('internal-book-id');
    expect(JSON.stringify(result)).not.toContain('privateRuleId');
    expect(JSON.stringify(result)).not.toContain('private-sha256');
  });

  it('replaces internal rule codes in incomplete quote errors', async () => {
    requirePermissionMock.mockResolvedValue({ id: 'sales-1', role: Role.SALES });
    quoteOrderPackagingGroupsMock.mockResolvedValue({
      ...completeQuote,
      groups: [
        {
          ...completeQuote.groups[0],
          complete: false,
          errors: ['入袋规则“PACKING_RULE_INTERNAL”的每袋单价非法'],
          suggestedUnitPrice: null,
          suggestedSubtotal: null,
        },
      ],
      suggestedTotal: null,
      requiresAdminConfirmation: true,
      errors: [
        '包装组 group-1：入袋规则“PACKING_RULE_INTERNAL”的每袋单价非法',
      ],
    });

    const result = await quoteOrderPackagingGroupsAction(validInput);

    expect(result).toEqual({
      status: 'success',
      quote: {
        groups: [
          {
            groupKey: 'group-1',
            complete: false,
            errors: ['入袋价格配置异常，请联系管理员'],
            suggestedUnitPrice: null,
            suggestedSubtotal: null,
          },
        ],
        suggestedTotal: null,
        requiresAdminConfirmation: true,
        errors: ['入袋价格配置异常，请联系管理员'],
      },
    });
    expect(JSON.stringify(result)).not.toContain('PACKING_RULE_INTERNAL');
  });

  it('does not disclose unexpected database errors to the browser', async () => {
    requirePermissionMock.mockResolvedValue({ id: 'sales-1', role: Role.SALES });
    quoteOrderPackagingGroupsMock.mockRejectedValue(
      new Error('postgres password leaked in transport error'),
    );

    const result = await quoteOrderPackagingGroupsAction(validInput);

    expect(result).toEqual({
      status: 'error',
      message: '入袋费报价失败，请稍后重试',
    });
  });
});
