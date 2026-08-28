import { Prisma } from '../../generated/prisma/client';
import {
  CustomerPriceBookPurpose,
  OrderSettlementType,
} from '../../generated/prisma/enums';
import { db } from '../db';
import { acquirePriceRuleSnapshotReadLock } from '../price/rule-snapshot-lock';

type ProcessingPurpose = typeof CustomerPriceBookPurpose.PROCESSING;
type LogisticsPurpose = typeof CustomerPriceBookPurpose.LOGISTICS;

export type ExternalCreateOrderPriceBookMetadata<
  Purpose extends ProcessingPurpose | LogisticsPurpose,
> = {
  purpose: Purpose;
  id: string;
  code: string;
  name: string;
  version: number;
  sourceSha256: string;
};

/**
 * Processing and logistics are deliberately separate version streams. Never
 * collapse this object into one numeric or string `priceVersion`.
 */
export type ExternalCreateOrderPriceSnapshot = {
  processing: ExternalCreateOrderPriceBookMetadata<ProcessingPurpose>;
  logistics: ExternalCreateOrderPriceBookMetadata<LogisticsPurpose>;
};

export type ExternalCreateOrderPriceSnapshotReadClient = Pick<
  Prisma.TransactionClient,
  '$executeRaw' | 'customerPriceBook'
>;

export class ExternalCreateOrderPriceSnapshotError extends Error {
  constructor(
    readonly code:
      | 'INVALID_NOW'
      | 'MISSING_PRICE_BOOK'
      | 'DUPLICATE_PRICE_BOOK'
      | 'INVALID_PRICE_BOOK_METADATA',
    message: string,
  ) {
    super(message);
    this.name = 'ExternalCreateOrderPriceSnapshotError';
  }
}

const PURPOSE_LABELS = {
  [CustomerPriceBookPurpose.PROCESSING]: '加工费',
  [CustomerPriceBookPurpose.LOGISTICS]: '物流',
} as const;

function requireValidMetadata<
  Purpose extends ProcessingPurpose | LogisticsPurpose,
>(row: {
  purpose: Purpose;
  id: string;
  code: string;
  name: string;
  version: number;
  sourceSha256: string;
}): ExternalCreateOrderPriceBookMetadata<Purpose> {
  if (
    !row.id.trim() ||
    !row.code.trim() ||
    !row.name.trim() ||
    !Number.isSafeInteger(row.version) ||
    row.version <= 0 ||
    !/^[a-f\d]{64}$/iu.test(row.sourceSha256)
  ) {
    throw new ExternalCreateOrderPriceSnapshotError(
      'INVALID_PRICE_BOOK_METADATA',
      `${PURPOSE_LABELS[row.purpose]}价目簿版本证据不完整，已拒绝自动报价`,
    );
  }
  return { ...row };
}

function uniqueBookForPurpose<
  Purpose extends ProcessingPurpose | LogisticsPurpose,
>(
  rows: readonly {
    purpose: ProcessingPurpose | LogisticsPurpose;
    id: string;
    code: string;
    name: string;
    version: number;
    sourceSha256: string;
  }[],
  purpose: Purpose,
): ExternalCreateOrderPriceBookMetadata<Purpose> {
  const matches = rows.filter((row) => row.purpose === purpose);
  if (matches.length === 0) {
    throw new ExternalCreateOrderPriceSnapshotError(
      'MISSING_PRICE_BOOK',
      `当前没有唯一生效的外部销售${PURPOSE_LABELS[purpose]}价目簿，已拒绝自动报价`,
    );
  }
  if (matches.length > 1) {
    throw new ExternalCreateOrderPriceSnapshotError(
      'DUPLICATE_PRICE_BOOK',
      `当前同时存在多个生效的外部销售${PURPOSE_LABELS[purpose]}价目簿，已拒绝自动报价`,
    );
  }
  return requireValidMetadata({ ...matches[0]!, purpose });
}

/**
 * Read both current external-sales price-book identities under one shared
 * advisory lock and one transaction snapshot. Missing or ambiguous streams
 * fail closed; no previous/nearest version fallback is permitted.
 */
export async function readExternalCreateOrderPriceSnapshot(
  client: ExternalCreateOrderPriceSnapshotReadClient,
  options: { now?: Date; snapshotLockHeld?: boolean } = {},
): Promise<ExternalCreateOrderPriceSnapshot> {
  const now = options.now ?? new Date();
  if (Number.isNaN(now.getTime())) {
    throw new ExternalCreateOrderPriceSnapshotError(
      'INVALID_NOW',
      '价目簿读取时间无效',
    );
  }
  if (!options.snapshotLockHeld) {
    await acquirePriceRuleSnapshotReadLock(client);
  }

  const books = await client.customerPriceBook.findMany({
    where: {
      settlementType: OrderSettlementType.EXTERNAL_SALES,
      purpose: {
        in: [
          CustomerPriceBookPurpose.PROCESSING,
          CustomerPriceBookPurpose.LOGISTICS,
        ],
      },
      isActive: true,
      effectiveFrom: { lte: now },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
    },
    select: {
      purpose: true,
      id: true,
      code: true,
      name: true,
      version: true,
      sourceSha256: true,
    },
    orderBy: [
      { purpose: 'asc' },
      { effectiveFrom: 'desc' },
      { version: 'desc' },
      { id: 'asc' },
    ],
  });

  return {
    processing: uniqueBookForPurpose(
      books,
      CustomerPriceBookPurpose.PROCESSING,
    ),
    logistics: uniqueBookForPurpose(
      books,
      CustomerPriceBookPurpose.LOGISTICS,
    ),
  };
}

/** Standalone server entry point; transactional callers should use the reader. */
export async function loadExternalCreateOrderPriceSnapshot(
  now: Date = new Date(),
): Promise<ExternalCreateOrderPriceSnapshot> {
  return db.$transaction((tx) =>
    readExternalCreateOrderPriceSnapshot(tx, { now }),
  );
}
