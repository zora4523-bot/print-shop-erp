import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import type {
  PieceworkPriceBookV1Manifest,
  PieceworkPublicationPreview,
  PieceworkPublicationReceipt,
} from '../../lib/salary/piecework-price-book-admin';
import {
  parsePieceworkPublisherCliOptions,
  runPieceworkPriceBookV1Publisher,
  type PieceworkPublisherDependencies,
} from '../publish-piecework-price-book-v1';

const manifest: PieceworkPriceBookV1Manifest = {
  schemaVersion: 1,
  priceBookVersion: 1,
  effectiveFrom: '2026-08-29T00:00:00.000Z',
  sourceName: '工价确认单',
  publishNote: '首版发布',
  rules: [
    { operationType: 'PARTIAL', unit: 'PER_PASS', amount: '0.0075' },
    { operationType: 'FULL', unit: 'PER_PIECE', amount: '0.0125' },
    { operationType: 'PACKING', unit: 'PER_BAG', amount: '0.3000' },
  ],
};
const rawManifest = JSON.stringify(manifest);
const sourceSha256 = createHash('sha256').update(rawManifest).digest('hex');

const preview: PieceworkPublicationPreview = {
  bookId: 'piecework-v1',
  bookStatus: 'DRAFT',
  draftUpdatedAt: '2026-08-28T02:00:00.000Z',
  sourceSha256,
  manifestSha256: 'a'.repeat(64),
  ruleSetSha256: 'b'.repeat(64),
  readyToPublish: true,
  issues: [],
  rules: manifest.rules,
};

function receipt(
  outcome: PieceworkPublicationReceipt['outcome'],
): PieceworkPublicationReceipt {
  return {
    outcome,
    bookId: 'piecework-v1',
    version: 1,
    effectiveFrom: '2026-08-29T00:00:00.000Z',
    rules: manifest.rules.map((rule) => ({
      operationType: rule.operationType,
      unit: rule.unit,
      rate: rule.amount!,
    })),
    sourceSha256,
    manifestSha256: 'a'.repeat(64),
    ruleSetSha256: 'b'.repeat(64),
    auditLogId: 'audit-1',
  };
}

function dependencies(): PieceworkPublisherDependencies {
  return {
    readManifest: vi.fn().mockResolvedValue({
      rawText: rawManifest,
      value: manifest,
    }),
    parseManifest: vi.fn().mockReturnValue(manifest),
    preview: vi.fn().mockResolvedValue(preview),
    resolveActor: vi.fn().mockResolvedValue({
      id: 'admin-1',
      role: 'ADMIN',
      username: 'owner',
      displayName: '管理员',
    }),
    publish: vi.fn().mockResolvedValue(receipt('PUBLISHED')),
    writeOutput: vi.fn(),
  };
}

describe('publish-piecework-price-book-v1 CLI', () => {
  it('defaults to dry-run and never invokes the publisher', async () => {
    const options = parsePieceworkPublisherCliOptions([]);
    const deps = dependencies();
    expect(options).toEqual({
      apply: false,
      manifestPath: 'config/piecework-price-books/v1.json',
      actorUsername: null,
      expectedDraftUpdatedAt: null,
    });

    await expect(
      runPieceworkPriceBookV1Publisher(options, deps),
    ).resolves.toEqual(preview);
    expect(deps.preview).toHaveBeenCalledWith(manifest, sourceSha256);
    expect(deps.resolveActor).not.toHaveBeenCalled();
    expect(deps.publish).not.toHaveBeenCalled();
    expect(deps.writeOutput).toHaveBeenCalledWith(
      expect.stringContaining('"mode": "DRY_RUN"'),
    );
  });

  it('requires actor and the exact dry-run revision before apply', async () => {
    const deps = dependencies();
    await expect(
      runPieceworkPriceBookV1Publisher(
        parsePieceworkPublisherCliOptions(['--apply']),
        deps,
      ),
    ).rejects.toThrow('--actor');
    await expect(
      runPieceworkPriceBookV1Publisher(
        parsePieceworkPublisherCliOptions(['--apply', '--actor=owner']),
        deps,
      ),
    ).rejects.toThrow('--expected-draft-updated-at');
    expect(deps.publish).not.toHaveBeenCalled();
  });

  it.each(['PUBLISHED', 'ALREADY_PUBLISHED'] as const)(
    'prints an auditable %s receipt from explicit apply',
    async (outcome) => {
      const deps = dependencies();
      vi.mocked(deps.publish).mockResolvedValue(receipt(outcome));
      const options = parsePieceworkPublisherCliOptions([
        '--apply',
        '--actor=owner',
        '--expected-draft-updated-at=2026-08-28T02:00:00.000Z',
      ]);

      await expect(
        runPieceworkPriceBookV1Publisher(options, deps),
      ).resolves.toMatchObject({ outcome, auditLogId: 'audit-1' });
      expect(deps.publish).toHaveBeenCalledWith({
        manifest,
        actor: expect.objectContaining({ id: 'admin-1', role: 'ADMIN' }),
        expectedDraftUpdatedAt: new Date('2026-08-28T02:00:00.000Z'),
        sourceSha256,
      });
      expect(deps.writeOutput).toHaveBeenCalledWith(
        expect.stringContaining(`"outcome": "${outcome}"`),
      );
    },
  );
});
