import { beforeEach, describe, expect, it, vi } from 'vitest';

const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    businessCodeSequence: {
      upsert: vi.fn(),
    },
    $executeRaw: vi.fn(),
  },
}));

vi.mock('@/lib/db', () => ({ db: dbMock }));

import {
  BusinessCodeExhaustedError,
  nextBusinessCode,
  resolveBusinessCode,
} from '../business-code';

beforeEach(() => {
  dbMock.businessCodeSequence.upsert.mockReset();
  dbMock.$executeRaw.mockReset().mockResolvedValue(1);
});

describe('nextBusinessCode', () => {
  it.each([
    ['PRODUCT', 'PRD-000001'],
    ['CRAFT', 'CRF_000001'],
    ['PARTY', 'PTY-000001'],
    ['MATERIAL', 'MAT-000001'],
    ['WAREHOUSE', 'WH-000001'],
    ['LOCATION', 'LOC-000001'],
  ] as const)('formats %s codes', async (kind, expected) => {
    dbMock.businessCodeSequence.upsert.mockResolvedValueOnce({ value: 1 });

    await expect(nextBusinessCode(kind)).resolves.toBe(expected);
    expect(dbMock.businessCodeSequence.upsert).toHaveBeenCalledWith({
      where: { key: kind },
      create: { key: kind, value: 1 },
      update: { value: { increment: 1 } },
      select: { value: true },
    });
  });

  it('rejects exhausted sequences instead of widening the public format', async () => {
    dbMock.businessCodeSequence.upsert.mockResolvedValueOnce({ value: 1_000_000 });
    await expect(nextBusinessCode('PRODUCT')).rejects.toBeInstanceOf(
      BusinessCodeExhaustedError,
    );
  });
});

describe('resolveBusinessCode', () => {
  it('keeps an explicitly supplied code without consuming a sequence', async () => {
    await expect(resolveBusinessCode('MATERIAL', '  PAPER-A4  ')).resolves.toBe(
      'PAPER-A4',
    );
    expect(dbMock.businessCodeSequence.upsert).not.toHaveBeenCalled();
    expect(dbMock.$executeRaw).not.toHaveBeenCalled();
  });

  it('advances the sequence for a custom code using the automatic format', async () => {
    await expect(resolveBusinessCode('MATERIAL', 'mat-000042')).resolves.toBe(
      'mat-000042',
    );
    expect(dbMock.businessCodeSequence.upsert).not.toHaveBeenCalled();
    expect(dbMock.$executeRaw).toHaveBeenCalledTimes(1);
    expect(dbMock.$executeRaw.mock.calls[0]!.slice(1)).toEqual(['MATERIAL', 42]);
  });

  it('generates a code when the field is blank', async () => {
    dbMock.businessCodeSequence.upsert.mockResolvedValueOnce({ value: 42 });
    await expect(resolveBusinessCode('PARTY', '')).resolves.toBe('PTY-000042');
  });
});
