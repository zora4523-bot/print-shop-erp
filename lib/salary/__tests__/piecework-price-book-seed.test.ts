import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '../../../generated/prisma/client';
import { PieceworkPriceBookStatus } from '../../../generated/prisma/enums';
import { seedPieceworkPriceBookV1Placeholder } from '../piecework-price-book-seed';

describe('seedPieceworkPriceBookV1Placeholder', () => {
  it('can run twice without publishing or overwriting a rule', async () => {
    type Rule = { operationType: 'PARTIAL' | 'FULL' | 'PACKING'; unit: 'PER_PASS' | 'PER_PIECE' | 'PER_BAG'; amount: string | null };
    let book: {
      id: string;
      status: PieceworkPriceBookStatus;
      rules: Rule[];
    } | null = null;

    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(0),
      pieceworkPriceBook: {
        findUnique: vi.fn(async () => book),
        create: vi.fn(async ({ data }: { data: { status: PieceworkPriceBookStatus; rules: { create: Rule[] } } }) => {
          book = { id: 'piecework-v1', status: data.status, rules: data.rules.create };
          return { id: book.id, status: book.status };
        }),
      },
      pieceworkPriceRule: {
        createMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    };
    const client = {
      $transaction: vi.fn(async (run: (value: typeof tx) => Promise<unknown>) => run(tx)),
    } as unknown as Pick<PrismaClient, '$transaction'>;

    const first = await seedPieceworkPriceBookV1Placeholder(client);
    const second = await seedPieceworkPriceBookV1Placeholder(client);

    expect(first).toMatchObject({ createdBook: true, createdRules: 3, status: 'DRAFT' });
    expect(second).toMatchObject({ createdBook: false, createdRules: 0, status: 'DRAFT' });
    expect(tx.pieceworkPriceBook.create).toHaveBeenCalledTimes(1);
    expect(tx.pieceworkPriceRule.createMany).not.toHaveBeenCalled();
    expect(tx.$executeRaw).toHaveBeenCalledTimes(2);
    const persistedBook = book as {
      id: string;
      status: PieceworkPriceBookStatus;
      rules: Rule[];
    } | null;
    expect(persistedBook?.rules).toEqual([
      { operationType: 'PARTIAL', unit: 'PER_PASS', amount: null },
      { operationType: 'FULL', unit: 'PER_PIECE', amount: null },
      { operationType: 'PACKING', unit: 'PER_BAG', amount: null },
    ]);
  });

  it('leaves an already-published v1 untouched', async () => {
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(0),
      pieceworkPriceBook: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'piecework-v1',
          status: PieceworkPriceBookStatus.PUBLISHED,
          rules: [],
        }),
        create: vi.fn(),
      },
      pieceworkPriceRule: { createMany: vi.fn() },
    };
    const client = {
      $transaction: vi.fn(async (run: (value: typeof tx) => Promise<unknown>) => run(tx)),
    } as unknown as Pick<PrismaClient, '$transaction'>;

    await expect(seedPieceworkPriceBookV1Placeholder(client)).resolves.toEqual({
      bookId: 'piecework-v1',
      status: PieceworkPriceBookStatus.PUBLISHED,
      createdBook: false,
      createdRules: 0,
    });
    expect(tx.pieceworkPriceBook.create).not.toHaveBeenCalled();
    expect(tx.pieceworkPriceRule.createMany).not.toHaveBeenCalled();
  });
});
