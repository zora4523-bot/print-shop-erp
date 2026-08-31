import type {
  Prisma,
  PrismaClient,
} from '../../generated/prisma/client';
import {
  PieceworkOperationType,
  PieceworkPriceBookStatus,
  PieceworkRateUnit,
} from '../../generated/prisma/enums';

const V1_PLACEHOLDER_RULES = [
  {
    operationType: PieceworkOperationType.PARTIAL,
    unit: PieceworkRateUnit.PER_PASS,
  },
  {
    operationType: PieceworkOperationType.FULL,
    unit: PieceworkRateUnit.PER_PIECE,
  },
  {
    operationType: PieceworkOperationType.PACKING,
    unit: PieceworkRateUnit.PER_BAG,
  },
] as const;

export type PieceworkPlaceholderSeedResult = {
  bookId: string;
  status: PieceworkPriceBookStatus;
  createdBook: boolean;
  createdRules: number;
};

export async function ensurePieceworkPriceBookV1PlaceholderInTx(
  tx: Prisma.TransactionClient,
): Promise<PieceworkPlaceholderSeedResult> {
  const existing = await tx.pieceworkPriceBook.findUnique({
    where: { version: 1 },
    include: {
      rules: {
        select: { operationType: true, unit: true },
      },
    },
  });

  if (!existing) {
    const created = await tx.pieceworkPriceBook.create({
      data: {
        version: 1,
        status: PieceworkPriceBookStatus.DRAFT,
        rules: {
          create: V1_PLACEHOLDER_RULES.map((rule) => ({
            ...rule,
            amount: null,
          })),
        },
      },
      select: { id: true, status: true },
    });
    return {
      bookId: created.id,
      status: created.status,
      createdBook: true,
      createdRules: V1_PLACEHOLDER_RULES.length,
    };
  }

  // 发布版是历史事实；seed 只读取状态，绝不重建草稿或改价。
  if (existing.status === PieceworkPriceBookStatus.PUBLISHED) {
    return {
      bookId: existing.id,
      status: existing.status,
      createdBook: false,
      createdRules: 0,
    };
  }

  const existingByType = new Map(
    existing.rules.map((rule) => [rule.operationType, rule]),
  );
  for (const expected of V1_PLACEHOLDER_RULES) {
    const current = existingByType.get(expected.operationType);
    if (current && current.unit !== expected.unit) {
      throw new Error(
        `计件草稿 v1 的 ${expected.operationType} 单位已是 ${current.unit}，` +
          `seed 拒绝覆盖为 ${expected.unit}`,
      );
    }
  }

  const missing = V1_PLACEHOLDER_RULES.filter(
    (expected) => !existingByType.has(expected.operationType),
  );
  const created =
    missing.length === 0
      ? { count: 0 }
      : await tx.pieceworkPriceRule.createMany({
          data: missing.map((rule) => ({
            priceBookId: existing.id,
            ...rule,
            amount: null,
          })),
          skipDuplicates: true,
        });

  return {
    bookId: existing.id,
    status: existing.status,
    createdBook: false,
    createdRules: created.count,
  };
}

export async function seedPieceworkPriceBookV1Placeholder(
  client: Pick<PrismaClient, '$transaction'>,
): Promise<PieceworkPlaceholderSeedResult> {
  return client.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('print-shop-erp:piecework-price-book:publish'))`;
    return ensurePieceworkPriceBookV1PlaceholderInTx(tx);
  });
}
