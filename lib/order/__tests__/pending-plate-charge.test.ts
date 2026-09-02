import Decimal from 'decimal.js';
import { describe, expect, it, vi } from 'vitest';
import type { Prisma } from '../../../generated/prisma/client';
import { OrderCustomerChargeStatus } from '../../../generated/prisma/enums';
import { calculateCreateOrderQuote } from '../../price/create-order';
import {
  CREATE_ORDER_GOLDEN_SNAPSHOT,
  createGoldenOrderInput,
  createGoldenOrderItem,
} from '../../price/__tests__/fixtures/create-order-golden-fixtures';
import {
  PENDING_PLATE_BUSINESS_KEY,
  PendingPlateChargeError,
  quoteHasPendingPlateCharge,
  upsertPendingPlateChargeInTx,
  waivePendingPlateChargeWhenNotApplicableInTx,
} from '../pending-plate-charge';

function plateQuote() {
  return calculateCreateOrderQuote(
    createGoldenOrderInput([createGoldenOrderItem()]),
    CREATE_ORDER_GOLDEN_SNAPSHOT,
  );
}

function plainPrintQuote() {
  return calculateCreateOrderQuote(
    createGoldenOrderInput([
      createGoldenOrderItem({
        craft: 'PRINT',
        paperType: '铜版纸',
        paperWeightGsm: 200,
        specification: '大号封',
        frontColors: [],
        backColors: [],
        printFoilMode: 'NONE',
        quantity: 1_000,
      }),
    ]),
    CREATE_ORDER_GOLDEN_SNAPSHOT,
  );
}

function bundledPrintQuote() {
  return calculateCreateOrderQuote(
    createGoldenOrderInput([
      createGoldenOrderItem({
        craft: 'PRINT',
        paperType: '铜版纸',
        paperWeightGsm: 200,
        specification: '大号封',
        frontColors: ['哑金'],
        backColors: [],
        printFoilMode: 'PARTIAL',
        quantity: 1_000,
      }),
    ]),
    CREATE_ORDER_GOLDEN_SNAPSHOT,
  );
}

function missingBundledPrintQuote() {
  return calculateCreateOrderQuote(
    createGoldenOrderInput([
      createGoldenOrderItem({
        craft: 'PRINT',
        paperType: '铜版纸',
        paperWeightGsm: 200,
        specification: '大号封',
        frontColors: ['哑金'],
        backColors: [],
        printFoilMode: 'PARTIAL',
        quantity: 1_000,
      }),
    ]),
    {
      ...CREATE_ORDER_GOLDEN_SNAPSHOT,
      print: {
        ...CREATE_ORDER_GOLDEN_SNAPSHOT.print,
        foilPerOrderPrices:
          CREATE_ORDER_GOLDEN_SNAPSHOT.print.foilPerOrderPrices.map((row) =>
            row.mode === 'PARTIAL' &&
            row.foilPassCount === 1 &&
            row.tierQuantity === 1_000
              ? { ...row, amount: null }
              : row,
          ),
      },
    },
  );
}

function manualBundledPrintQuote() {
  return calculateCreateOrderQuote(
    createGoldenOrderInput([
      createGoldenOrderItem({
        craft: 'PRINT',
        paperType: '铜版纸',
        paperWeightGsm: 200,
        specification: '大号封',
        frontColors: ['哑金'],
        backColors: [],
        printFoilMode: 'PARTIAL',
        printFinishing: 'TACTILE',
        quantity: 1_000,
      }),
    ]),
    CREATE_ORDER_GOLDEN_SNAPSHOT,
  );
}

function txWithChargeMocks(input: {
  existing?:
    | {
        id: string;
        status: OrderCustomerChargeStatus;
        amount: Decimal | null;
        pricingSnapshot: Prisma.JsonValue | null;
      }
    | null;
} = {}) {
  const findUnique = vi.fn().mockResolvedValue(input.existing ?? null);
  const update = vi.fn().mockResolvedValue({ id: input.existing?.id ?? 'plate' });
  const upsert = vi.fn().mockResolvedValue({ id: 'plate' });
  return {
    tx: {
      orderCustomerCharge: { findUnique, update, upsert },
    } as unknown as Prisma.TransactionClient,
    findUnique,
    update,
    upsert,
  };
}

describe('pending plate charge persistence', () => {
  it('仅把纯引擎的唯一订单级制版 pending 视为可持久化证据', () => {
    expect(quoteHasPendingPlateCharge(plateQuote())).toBe(true);
    expect(quoteHasPendingPlateCharge(plainPrintQuote())).toBe(false);
  });

  it('有烫金时以固定 business key 写入唯一 pending，不伪造金额', async () => {
    const { tx, upsert } = txWithChargeMocks();
    const quote = plateQuote();

    await upsertPendingPlateChargeInTx({
      tx,
      orderId: 'order-1',
      actorId: 'admin-1',
      categoryId: 'plate-category',
      quote,
      source: 'CHANGE_REQUEST_PENDING_PLATE',
    });

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          orderId_businessKey: {
            orderId: 'order-1',
            businessKey: PENDING_PLATE_BUSINESS_KEY,
          },
        },
        create: expect.objectContaining({
          status: OrderCustomerChargeStatus.PENDING_AMOUNT,
          amount: null,
          suggestedAmount: null,
          finalizedById: null,
          finalizedAt: null,
        }),
        update: expect.objectContaining({
          status: OrderCustomerChargeStatus.PENDING_AMOUNT,
          amount: null,
        }),
      }),
    );
  });

  it('无烫金报价不允许误走 pending upsert', async () => {
    const { tx, upsert } = txWithChargeMocks();

    await expect(
      upsertPendingPlateChargeInTx({
        tx,
        orderId: 'order-1',
        actorId: 'admin-1',
        categoryId: 'plate-category',
        quote: plainPrintQuote(),
        source: 'CHANGE_REQUEST_PENDING_PLATE',
      }),
    ).rejects.toBeInstanceOf(PendingPlateChargeError);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('有到无时以 WAIVED 保留旧金额与快照，并写入完整终结审计', async () => {
    const previousSnapshot = {
      version: 1,
      source: 'ADMIN_CONFIRMED_PLATE',
      actual: { amount: '88.00' },
    };
    const { tx, findUnique, update } = txWithChargeMocks({
      existing: {
        id: 'plate-existing',
        status: OrderCustomerChargeStatus.FINAL,
        amount: new Decimal('88.00'),
        pricingSnapshot: previousSnapshot,
      },
    });
    const now = new Date('2026-09-02T04:00:00.000Z');

    await waivePendingPlateChargeWhenNotApplicableInTx({
      tx,
      orderId: 'order-1',
      actorId: 'admin-1',
      now,
      quote: plainPrintQuote(),
    });

    expect(findUnique).toHaveBeenCalledWith({
      where: {
        orderId_businessKey: {
          orderId: 'order-1',
          businessKey: PENDING_PLATE_BUSINESS_KEY,
        },
      },
      select: {
        id: true,
        status: true,
        amount: true,
        pricingSnapshot: true,
      },
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: 'plate-existing' },
      data: expect.objectContaining({
        status: OrderCustomerChargeStatus.WAIVED,
        amount: '0.00',
        finalizedById: 'admin-1',
        finalizedAt: now,
        pricingSnapshot: expect.objectContaining({
          source: 'CHANGE_REQUEST_PLATE_NOT_APPLICABLE',
          previousStatus: OrderCustomerChargeStatus.FINAL,
          previousAmount: '88',
          previousSnapshot,
        }),
      }),
      select: { id: true },
    });
  });

  it('改为含版费原子套餐时豁免旧 aggregate，审计理由不误记为无烫金', async () => {
    const { tx, update } = txWithChargeMocks({
      existing: {
        id: 'plate-existing',
        status: OrderCustomerChargeStatus.FINAL,
        amount: new Decimal('88.00'),
        pricingSnapshot: { source: 'ADMIN_CONFIRMED_PLATE' },
      },
    });

    await waivePendingPlateChargeWhenNotApplicableInTx({
      tx,
      orderId: 'order-1',
      actorId: 'admin-1',
      now: new Date('2026-09-02T04:00:00.000Z'),
      quote: bundledPrintQuote(),
    });

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          overrideReason:
            '制版费已包含在不可拆彩印烫金原子套餐，不再另收',
          pricingSnapshot: expect.objectContaining({
            reason:
              '制版费已包含在不可拆彩印烫金原子套餐，不再另收',
          }),
        }),
      }),
    );
  });

  it('含版费套餐缺档转人工时，豁免理由仍保留烫金事实', async () => {
    const { tx, update } = txWithChargeMocks({
      existing: {
        id: 'plate-existing',
        status: OrderCustomerChargeStatus.FINAL,
        amount: new Decimal('88.00'),
        pricingSnapshot: null,
      },
    });

    await waivePendingPlateChargeWhenNotApplicableInTx({
      tx,
      orderId: 'order-1',
      actorId: 'admin-1',
      now: new Date('2026-09-02T04:00:00.000Z'),
      quote: missingBundledPrintQuote(),
    });

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          overrideReason:
            '制版费已包含在不可拆彩印烫金原子套餐，不再另收',
        }),
      }),
    );
  });

  it('彩印烫金因其他原因转人工时，豁免理由不误记为无烫金', async () => {
    const { tx, update } = txWithChargeMocks({
      existing: {
        id: 'plate-existing',
        status: OrderCustomerChargeStatus.FINAL,
        amount: new Decimal('88.00'),
        pricingSnapshot: null,
      },
    });
    const quote = manualBundledPrintQuote();

    expect(quote.manualReasons).toContainEqual(
      expect.objectContaining({
        code: 'PRINT_FOIL_MANUAL_PRICE_INCLUDES_PLATE',
      }),
    );
    await waivePendingPlateChargeWhenNotApplicableInTx({
      tx,
      orderId: 'order-1',
      actorId: 'admin-1',
      now: new Date('2026-09-02T04:00:00.000Z'),
      quote,
    });

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          overrideReason:
            '制版费已包含在不可拆彩印烫金原子套餐，不再另收',
        }),
      }),
    );
  });

  it('无历史 aggregate 或已 WAIVED 时幂等不写，不覆盖原审计', async () => {
    const absent = txWithChargeMocks();
    await waivePendingPlateChargeWhenNotApplicableInTx({
      tx: absent.tx,
      orderId: 'order-1',
      actorId: 'admin-1',
      now: new Date('2026-09-02T04:00:00.000Z'),
      quote: plainPrintQuote(),
    });
    expect(absent.update).not.toHaveBeenCalled();

    const alreadyWaived = txWithChargeMocks({
      existing: {
        id: 'plate-waived',
        status: OrderCustomerChargeStatus.WAIVED,
        amount: new Decimal(0),
        pricingSnapshot: { source: 'EARLIER_WAIVER' },
      },
    });
    await waivePendingPlateChargeWhenNotApplicableInTx({
      tx: alreadyWaived.tx,
      orderId: 'order-1',
      actorId: 'admin-1',
      now: new Date('2026-09-02T04:00:00.000Z'),
      quote: plainPrintQuote(),
    });
    expect(alreadyWaived.update).not.toHaveBeenCalled();
  });

  it('仍有独立制版费待核价时禁止豁免', async () => {
    const { tx, findUnique, update } = txWithChargeMocks();
    await expect(
      waivePendingPlateChargeWhenNotApplicableInTx({
        tx,
        orderId: 'order-1',
        actorId: 'admin-1',
        now: new Date('2026-09-02T04:00:00.000Z'),
        quote: plateQuote(),
      }),
    ).rejects.toBeInstanceOf(PendingPlateChargeError);
    expect(findUnique).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
});
