import { beforeEach, describe, expect, it, vi } from 'vitest';

const { dbMock } = vi.hoisted(() => ({
  dbMock: { $executeRaw: vi.fn() },
}));

vi.mock('@/lib/db', () => ({ db: dbMock }));

import {
  scrubOrderExportFiltersForBackgroundJob,
  scrubTerminalOrderExportFilters,
} from '../export-retention';

beforeEach(() => {
  dbMock.$executeRaw.mockReset().mockResolvedValue(1);
});

describe('order export filter retention', () => {
  it('retains only normalized scope for a failed export owned by the terminal job', async () => {
    await expect(
      scrubOrderExportFiltersForBackgroundJob('job-export-1'),
    ).resolves.toBe(1);

    const [strings, jobId] = dbMock.$executeRaw.mock.calls[0] as [
      TemplateStringsArray,
      string,
    ];
    const sql = strings.join('?');
    expect(jobId).toBe('job-export-1');
    expect(sql).toContain('"filters" = jsonb_build_object(');
    expect(sql).toContain("WHEN \"filters\"->>'scope' = 'all' THEN 'all'");
    expect(sql).toContain("ELSE 'filtered'");
    expect(sql).toContain('"backgroundJobId" = ?');
    expect(sql).toContain('"status" = \'FAILED\'::"OrderExportStatus"');
    expect(sql).toContain('"filters" IS DISTINCT FROM jsonb_build_object(');
    expect(sql).not.toContain("- 'params'");
    expect(sql).not.toContain('filterHash');
  });

  it('backfills scope-only receipts for every terminal status', async () => {
    await expect(scrubTerminalOrderExportFilters()).resolves.toBe(1);

    const [strings] = dbMock.$executeRaw.mock.calls[0] as [
      TemplateStringsArray,
    ];
    const sql = strings.join('?');
    expect(sql).toContain('"filters" = jsonb_build_object(');
    expect(sql).toContain("WHEN \"filters\"->>'scope' = 'all' THEN 'all'");
    expect(sql).toContain("ELSE 'filtered'");
    expect(sql).toContain('\'READY\'::"OrderExportStatus"');
    expect(sql).toContain('\'FAILED\'::"OrderExportStatus"');
    expect(sql).toContain('\'EXPIRED\'::"OrderExportStatus"');
    expect(sql).not.toContain("'PENDING'::\"OrderExportStatus\"");
    expect(sql).not.toContain("- 'params'");
    expect(sql).not.toContain('filterHash');
  });
});
