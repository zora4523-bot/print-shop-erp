import { describe, it, expect, vi, beforeEach } from 'vitest';

const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    $queryRaw: vi.fn(),
  },
}));
vi.mock('@/lib/db', () => ({ db: dbMock }));

import { listSearchIndexReadiness } from '../search-readiness';

beforeEach(() => {
  dbMock.$queryRaw.mockReset();
});

describe('listSearchIndexReadiness', () => {
  it('normalizes nullable arrays and exposes EXPLAIN SQL', async () => {
    dbMock.$queryRaw.mockResolvedValue([
      {
        surfaceKey: 'order-search-v1',
        routePath: '/orders?q=...',
        businessArea: '工单搜索',
        sampleQuery: '苹果福',
        requiredExtensions: ['pg_trgm', 'pg_pinyin'],
        optionalExtensions: ['pg_bigm'],
        requiredIndexes: ['public."Order_orderNo_trgm_idx"'],
        optionalIndexes: ['public."Order_orderNo_bigm_idx"'],
        missingRequiredExtensions: null,
        missingOptionalExtensions: ['pg_bigm'],
        missingRequiredIndexes: null,
        missingOptionalIndexes: ['public."Order_orderNo_bigm_idx"'],
        readyForSearch: true,
        blockers: null,
        explainSql:
          'EXPLAIN (ANALYZE, BUFFERS) SELECT "id" FROM public."Order";',
        priority: 10,
        rationale: 'search rollout check',
      },
    ]);

    await expect(listSearchIndexReadiness()).resolves.toEqual([
      expect.objectContaining({
        surfaceKey: 'order-search-v1',
        readyForSearch: true,
        missingRequiredExtensions: [],
        missingOptionalExtensions: ['pg_bigm'],
        missingRequiredIndexes: [],
        missingOptionalIndexes: ['public."Order_orderNo_bigm_idx"'],
        blockers: [],
        explainSql: expect.stringContaining('EXPLAIN'),
      }),
    ]);
  });
});
