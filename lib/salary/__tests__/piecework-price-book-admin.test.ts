import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Role } from '../../../generated/prisma/enums';

const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    $executeRaw: vi.fn(),
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
    pieceworkPriceBook: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    pieceworkPriceRule: { updateMany: vi.fn() },
    user: { findUnique: vi.fn() },
    businessAuditLog: { create: vi.fn(), findFirst: vi.fn() },
  },
}));

vi.mock('@/lib/db', () => ({ db: dbMock }));

import {
  calculatePieceworkManifestSha256,
  calculatePieceworkRuleSetSha256,
  parsePieceworkPriceBookV1Manifest,
  PieceworkPriceBookAdminError,
  previewPieceworkPriceBookV1Publication,
  publishPieceworkPriceBookV1,
  type PieceworkPriceBookV1Manifest,
} from '../piecework-price-book-admin';

const actor = {
  id: 'admin-1',
  role: Role.ADMIN,
  username: 'owner',
  displayName: '管理员',
};
const draftUpdatedAt = new Date('2026-08-28T02:00:00.000Z');
const now = new Date('2026-08-28T03:00:00.000Z');
const sourceSha256 = 'c'.repeat(64);

function manifest(
  overrides: Partial<PieceworkPriceBookV1Manifest> = {},
): PieceworkPriceBookV1Manifest {
  return {
    schemaVersion: 1,
    priceBookVersion: 1,
    effectiveFrom: '2026-08-29T00:00:00.000Z',
    sourceName: '经负责人确认的计件工价',
    publishNote: '首版三类工序工价',
    rules: [
      { operationType: 'PARTIAL', unit: 'PER_PASS', amount: '0.0075' },
      { operationType: 'FULL', unit: 'PER_PIECE', amount: '0.0125' },
      { operationType: 'PACKING', unit: 'PER_BAG', amount: '0.3000' },
    ],
    ...overrides,
  };
}

function draftBook(): {
  id: string;
  version: number;
  status: string;
  effectiveFrom: Date | null;
  sourceName: string | null;
  sourceSha256: string | null;
  manifestSha256: string | null;
  ruleSetSha256: string | null;
  publishNote: string | null;
  updatedAt: Date;
  rules: Array<{
    id: string;
    operationType: 'PARTIAL' | 'FULL' | 'PACKING';
    unit: 'PER_PASS' | 'PER_PIECE' | 'PER_BAG';
    amount: string | null;
  }>;
} {
  return {
    id: 'piecework-v1',
    version: 1,
    status: 'DRAFT',
    effectiveFrom: null,
    sourceName: null,
    sourceSha256: null,
    manifestSha256: null,
    ruleSetSha256: null,
    publishNote: null,
    updatedAt: draftUpdatedAt,
    rules: [
      {
        id: 'partial-rule',
        operationType: 'PARTIAL',
        unit: 'PER_PASS',
        amount: null,
      },
      {
        id: 'full-rule',
        operationType: 'FULL',
        unit: 'PER_PIECE',
        amount: null,
      },
      {
        id: 'packing-rule',
        operationType: 'PACKING',
        unit: 'PER_BAG',
        amount: null,
      },
    ],
  };
}

beforeEach(() => {
  dbMock.$executeRaw.mockReset().mockResolvedValue(0);
  dbMock.$queryRaw.mockReset().mockResolvedValue([]);
  dbMock.$transaction
    .mockReset()
    .mockImplementation(
      async (run: (tx: typeof dbMock) => Promise<unknown>) => run(dbMock),
    );
  for (const delegate of [
    dbMock.pieceworkPriceBook,
    dbMock.pieceworkPriceRule,
    dbMock.user,
    dbMock.businessAuditLog,
  ]) {
    for (const method of Object.values(delegate)) method.mockReset();
  }
  dbMock.pieceworkPriceRule.updateMany.mockResolvedValue({ count: 1 });
  dbMock.pieceworkPriceBook.updateMany.mockResolvedValue({ count: 1 });
  dbMock.user.findUnique.mockResolvedValue({ ...actor, isActive: true });
  dbMock.businessAuditLog.create.mockResolvedValue({ id: 'audit-1' });
});

describe('piecework v1 manifest', () => {
  it('parses a strict manifest and hashes canonical rule order', () => {
    const parsed = parsePieceworkPriceBookV1Manifest(manifest());
    const reversed = manifest({ rules: [...manifest().rules].reverse() });
    expect(calculatePieceworkManifestSha256(parsed)).toMatch(/^[0-9a-f]{64}$/);
    expect(calculatePieceworkRuleSetSha256(parsed.rules)).toBe(
      calculatePieceworkRuleSetSha256(reversed.rules),
    );
  });

  it('rejects unknown manifest fields and preserves null as unavailable', () => {
    expect(() =>
      parsePieceworkPriceBookV1Manifest({ ...manifest(), unexpected: true }),
    ).toThrow(PieceworkPriceBookAdminError);
    expect(
      parsePieceworkPriceBookV1Manifest(
        manifest({
          effectiveFrom: null,
          rules: manifest().rules.map((rule) => ({ ...rule, amount: null })),
        }),
      ).rules.every((rule) => rule.amount === null),
    ).toBe(true);
  });

  it('dry-run reports placeholders without writing', async () => {
    dbMock.pieceworkPriceBook.findUnique.mockResolvedValue(draftBook());
    const preview = await previewPieceworkPriceBookV1Publication(
      manifest({
        effectiveFrom: null,
        rules: manifest().rules.map((rule) => ({ ...rule, amount: null })),
      }),
      sourceSha256,
    );
    expect(preview.readyToPublish).toBe(false);
    expect(preview.issues).toEqual(
      expect.arrayContaining([
        'effectiveFrom 尚未填写',
        'PARTIAL 金额尚未填写',
        'FULL 金额尚未填写',
        'PACKING 金额尚未填写',
      ]),
    );
    expect(dbMock.$transaction).not.toHaveBeenCalled();
  });
});

describe('publishPieceworkPriceBookV1', () => {
  it('fills only null rates and publishes with hashes and audit in one transaction', async () => {
    dbMock.pieceworkPriceBook.findUnique.mockResolvedValue(draftBook());

    const receipt = await publishPieceworkPriceBookV1(
      {
        manifest: manifest(),
        expectedDraftUpdatedAt: draftUpdatedAt,
        sourceSha256,
        actor,
      },
      now,
    );

    expect(receipt).toMatchObject({
      outcome: 'PUBLISHED',
      bookId: 'piecework-v1',
      version: 1,
      auditLogId: 'audit-1',
      rules: [
        { operationType: 'PARTIAL', unit: 'PER_PASS', rate: '0.0075' },
        { operationType: 'FULL', unit: 'PER_PIECE', rate: '0.0125' },
        { operationType: 'PACKING', unit: 'PER_BAG', rate: '0.3000' },
      ],
    });
    expect(dbMock.$executeRaw).toHaveBeenCalledTimes(1);
    expect(dbMock.$queryRaw).toHaveBeenCalledTimes(2);
    expect(dbMock.pieceworkPriceRule.updateMany).toHaveBeenCalledTimes(3);
    expect(dbMock.pieceworkPriceRule.updateMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ where: { id: 'partial-rule', amount: null } }),
    );
    expect(dbMock.pieceworkPriceBook.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'piecework-v1',
          status: 'DRAFT',
          updatedAt: draftUpdatedAt,
        },
        data: expect.objectContaining({
          status: 'PUBLISHED',
          publishedById: actor.id,
          manifestSha256: receipt.manifestSha256,
          ruleSetSha256: receipt.ruleSetSha256,
        }),
      }),
    );
    expect(dbMock.businessAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'PUBLISH_VERSION',
          entityType: 'PieceworkPriceBook',
          entityId: 'piecework-v1',
        }),
      }),
    );
  });

  it('returns the original receipt for an exact replay without any write', async () => {
    const inputManifest = manifest();
    const manifestSha256 = calculatePieceworkManifestSha256(inputManifest);
    const ruleSetSha256 = calculatePieceworkRuleSetSha256(inputManifest.rules);
    dbMock.pieceworkPriceBook.findUnique.mockResolvedValue({
      ...draftBook(),
      status: 'PUBLISHED',
      effectiveFrom: new Date(inputManifest.effectiveFrom!),
      sourceName: inputManifest.sourceName,
      sourceSha256,
      manifestSha256,
      ruleSetSha256,
      publishNote: inputManifest.publishNote,
      rules: draftBook().rules.map((rule, index) => ({
        ...rule,
        amount: inputManifest.rules[index]!.amount,
      })),
    });
    dbMock.businessAuditLog.findFirst.mockResolvedValue({ id: 'audit-original' });

    await expect(
      publishPieceworkPriceBookV1(
        {
          manifest: inputManifest,
          expectedDraftUpdatedAt: draftUpdatedAt,
          sourceSha256,
          actor,
        },
        new Date('2027-01-01T00:00:00.000Z'),
      ),
    ).resolves.toMatchObject({
      outcome: 'ALREADY_PUBLISHED',
      auditLogId: 'audit-original',
    });
    expect(dbMock.pieceworkPriceRule.updateMany).not.toHaveBeenCalled();
    expect(dbMock.pieceworkPriceBook.updateMany).not.toHaveBeenCalled();
    expect(dbMock.businessAuditLog.create).not.toHaveBeenCalled();
  });

  it('fails closed on stale drafts, inactive actors, or amount overwrite attempts', async () => {
    dbMock.pieceworkPriceBook.findUnique.mockResolvedValue(draftBook());
    await expect(
      publishPieceworkPriceBookV1(
        {
          manifest: manifest(),
          expectedDraftUpdatedAt: new Date('2026-08-28T01:00:00.000Z'),
          sourceSha256,
          actor,
        },
        now,
      ),
    ).rejects.toThrow('草稿已变更');

    dbMock.pieceworkPriceBook.findUnique.mockResolvedValue(draftBook());
    dbMock.user.findUnique.mockResolvedValue({ ...actor, isActive: false });
    await expect(
      publishPieceworkPriceBookV1(
        {
          manifest: manifest(),
          expectedDraftUpdatedAt: draftUpdatedAt,
          sourceSha256,
          actor,
        },
        now,
      ),
    ).rejects.toThrow('活跃管理员');

    const changed = draftBook();
    changed.rules[0]!.amount = '9.9999';
    dbMock.pieceworkPriceBook.findUnique.mockResolvedValue(changed);
    dbMock.user.findUnique.mockResolvedValue({ ...actor, isActive: true });
    await expect(
      publishPieceworkPriceBookV1(
        {
          manifest: manifest(),
          expectedDraftUpdatedAt: draftUpdatedAt,
          sourceSha256,
          actor,
        },
        now,
      ),
    ).rejects.toThrow('禁止覆盖');
  });
});
