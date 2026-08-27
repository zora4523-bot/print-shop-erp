import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  OrderPackagingMode,
  OrderSettlementType,
} from '@/generated/prisma/enums';

const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    $executeRaw: vi.fn(),
    $transaction: vi.fn(),
    customerPriceBook: { findMany: vi.fn() },
    customerPriceRule: { findMany: vi.fn() },
  },
}));

vi.mock('@/lib/db', () => ({ db: dbMock }));

import {
  calculateOrderPackagingGroupsQuote,
  quoteOrderPackagingGroups,
  type OrderPackagingPriceRule,
} from '../order-packaging-quote';

const now = new Date('2026-08-26T08:00:00.000Z');
const book = {
  id: 'processing-v2',
  code: 'EXTERNAL_SALES_PROCESSING_202608',
  name: '外部销售加工费',
  version: 2,
  sourceName: '管理员确认规则',
  sourceSha256: 'rule-hash',
};

function rule(
  mode: OrderPackagingMode,
  amount: string,
  overrides: Partial<OrderPackagingPriceRule> = {},
): OrderPackagingPriceRule {
  return {
    id: `rule-${mode}`,
    code: `PACKING_${mode}`,
    name:
      mode === OrderPackagingMode.SINGLE_STYLE
        ? '单款入袋'
        : '混装入袋',
    kind: 'ADD_ON',
    calculationType: 'PER_BAG',
    amount,
    minQty: null,
    maxQty: null,
    triggerCondition: {
      schemaVersion: 1,
      target: 'PACKAGING_GROUP',
      packagingModes: [mode],
    },
    exclusiveGroup: 'PACKAGING_GROUP_MODE',
    blocksAutomaticQuote: false,
    productId: null,
    sourceSheet: '彩印',
    sourceRange: 'B1:N1',
    note: null,
    category: { code: 'PACKING', name: '入袋与包装' },
    ...overrides,
  };
}

describe('calculateOrderPackagingGroupsQuote', () => {
  it('按各包装组的模式和实际袋数计算 0.1/0.2 元每袋', () => {
    const result = calculateOrderPackagingGroupsQuote({
      groups: [
        {
          groupKey: 'single',
          mode: OrderPackagingMode.SINGLE_STYLE,
          actualBagCount: 20,
        },
        {
          groupKey: 'mixed',
          mode: OrderPackagingMode.MIXED_STYLE,
          actualBagCount: 15,
        },
      ],
      priceBook: book,
      rules: [
        rule(OrderPackagingMode.SINGLE_STYLE, '0.1000'),
        rule(OrderPackagingMode.MIXED_STYLE, '0.2000'),
      ],
      quotedAt: now,
    });

    expect(result.requiresAdminConfirmation).toBe(false);
    expect(result.suggestedTotal).toBe('5.00');
    expect(result.groups).toEqual([
      expect.objectContaining({
        groupKey: 'single',
        complete: true,
        suggestedUnitPrice: '0.1000',
        suggestedSubtotal: '2.00',
      }),
      expect.objectContaining({
        groupKey: 'mixed',
        complete: true,
        suggestedUnitPrice: '0.2000',
        suggestedSubtotal: '3.00',
      }),
    ]);
    expect(result.groups[0]?.snapshot).toMatchObject({
      priceBook: { id: 'processing-v2', version: 2 },
      input: { mode: 'SINGLE_STYLE', actualBagCount: 20 },
      calculation: { rate: '0.1000', units: 20, amount: '2.00' },
      complete: true,
    });
  });

  it.each([
    ['没有规则', []],
    [
      '同模式冲突',
      [
        rule(OrderPackagingMode.SINGLE_STYLE, '0.1000'),
        rule(OrderPackagingMode.SINGLE_STYLE, '0.1100', { id: 'duplicate' }),
      ],
    ],
    [
      '非法规则',
      [rule(OrderPackagingMode.SINGLE_STYLE, '0.1000', { productId: 'p-1' })],
    ],
  ])('%s 时失败关闭并转管理员确认', (_label, rules) => {
    const result = calculateOrderPackagingGroupsQuote({
      groups: [
        {
          groupKey: 'single',
          mode: OrderPackagingMode.SINGLE_STYLE,
          actualBagCount: 10,
        },
      ],
      priceBook: book,
      rules,
      quotedAt: now,
    });

    expect(result.requiresAdminConfirmation).toBe(true);
    expect(result.suggestedTotal).toBeNull();
    expect(result.groups[0]).toMatchObject({
      complete: false,
      suggestedUnitPrice: null,
      suggestedSubtotal: null,
    });
    expect(result.groups[0]?.errors.length).toBeGreaterThan(0);
  });

  it('实际袋数非法时不计算金额', () => {
    const result = calculateOrderPackagingGroupsQuote({
      groups: [
        {
          groupKey: 'bad-count',
          mode: OrderPackagingMode.MIXED_STYLE,
          actualBagCount: 0,
        },
      ],
      priceBook: book,
      rules: [rule(OrderPackagingMode.MIXED_STYLE, '0.2000')],
      quotedAt: now,
    });

    expect(result.groups[0]?.errors).toContain(
      '实际袋数必须是 1–9999999 的整数',
    );
    expect(result.requiresAdminConfirmation).toBe(true);
  });
});

describe('quoteOrderPackagingGroups', () => {
  beforeEach(() => {
    dbMock.$executeRaw.mockReset().mockResolvedValue(0);
    dbMock.$transaction
      .mockReset()
      .mockImplementation(
        async (callback: (tx: typeof dbMock) => Promise<unknown>) =>
          callback(dbMock),
      );
    dbMock.customerPriceBook.findMany.mockReset().mockResolvedValue([book]);
    dbMock.customerPriceRule.findMany.mockReset().mockResolvedValue([
      rule(OrderPackagingMode.SINGLE_STYLE, '0.1000'),
      rule(OrderPackagingMode.MIXED_STYLE, '0.2000'),
    ]);
  });

  it('与款式报价共用已持有的规则快照锁', async () => {
    const result = await quoteOrderPackagingGroups(
      [
        {
          groupKey: 'group-1',
          mode: OrderPackagingMode.SINGLE_STYLE,
          actualBagCount: 10,
        },
      ],
      OrderSettlementType.EXTERNAL_SALES,
      now,
      dbMock as never,
      { snapshotLockHeld: true },
    );

    expect(dbMock.$executeRaw).not.toHaveBeenCalled();
    expect(result.suggestedTotal).toBe('1.00');
    expect(dbMock.customerPriceRule.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          triggerCondition: {
            path: ['target'],
            equals: 'PACKAGING_GROUP',
          },
        }),
      }),
    );
  });

  it('无生效价目时返回不完整快照而不猜测价格', async () => {
    dbMock.customerPriceBook.findMany.mockResolvedValue([]);

    const result = await quoteOrderPackagingGroups(
      [
        {
          groupKey: 'group-1',
          mode: OrderPackagingMode.SINGLE_STYLE,
          actualBagCount: 10,
        },
      ],
      OrderSettlementType.EXTERNAL_SALES,
      now,
      dbMock as never,
      { snapshotLockHeld: true },
    );

    expect(result.priceBook).toBeNull();
    expect(result.requiresAdminConfirmation).toBe(true);
    expect(result.groups[0]?.snapshot).toMatchObject({
      priceBook: null,
      complete: false,
    });
  });
});
