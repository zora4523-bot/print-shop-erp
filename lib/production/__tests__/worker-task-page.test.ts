import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Role } from '@/generated/prisma/enums';

type RawSql = { sql: string; values: unknown[] };
const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  operationType: vi.fn(),
  progressCraftIds: vi.fn(),
  listOperations: vi.fn(),
  listProgress: vi.fn(),
  assertActor: vi.fn(),
}));
vi.mock('@/lib/db', () => ({
  db: { $transaction: vi.fn(async (callback: (tx: unknown) => unknown) => callback({ $queryRaw: mocks.queryRaw })) },
}));
vi.mock('../operation-portal', () => ({
  getReporterOperationTypeOrNull: mocks.operationType,
  getProgressCraftIdsForReporter: mocks.progressCraftIds,
  listProductionOperationsForReporter: mocks.listOperations,
  listProductionProgressForReporter: mocks.listProgress,
}));
vi.mock('../worker-report-portal', () => ({ assertWorkerPortalActor: mocks.assertActor }));
import { listWorkerTaskPage } from '../worker-task-page';

const actor = { id: 'worker-1', role: Role.WORKER };
const queries = () => mocks.queryRaw.mock.calls.map(([query]) => query as RawSql);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.operationType.mockResolvedValue(null);
  mocks.progressCraftIds.mockResolvedValue(['craft-emboss']);
  mocks.queryRaw.mockImplementation(async (query: RawSql) => (query.sql.includes('count(*)') ? [{ count: BigInt(1) }] : [{ id: 'step-1' }]));
  mocks.listProgress.mockResolvedValue([{ id: 'step-1' }]);
  mocks.listOperations.mockResolvedValue([]);
});

describe('listWorkerTaskPage progress lane', () => {
  // 审计 L-7：计数、分页和水合必须用同一条工艺车道，否则本车道步骤被他车道挤到后页。
  it('filters count and page ids by the reporter\'s progress craft lane', async () => {
    const page = await listWorkerTaskPage(actor, { view: 'progress', q: '' });
    expect(mocks.progressCraftIds).toHaveBeenCalledWith(actor);
    expect(queries()).toHaveLength(2);
    for (const query of queries()) {
      expect(query.sql).toContain('step."craftId" = ANY(');
      expect(query.values).toContainEqual(['craft-emboss']);
    }
    expect(mocks.listProgress).toHaveBeenCalledWith(actor, ['step-1']);
    expect(page).toMatchObject({ total: 1, progressSteps: [{ id: 'step-1' }] });
  });

  it('returns an empty page without querying when the account has no progress lane', async () => {
    mocks.progressCraftIds.mockResolvedValue([]);
    const page = await listWorkerTaskPage(actor, { view: 'progress', q: '' });
    expect(mocks.queryRaw).not.toHaveBeenCalled();
    expect(mocks.listProgress).not.toHaveBeenCalled();
    expect(page).toMatchObject({ total: 0, progressSteps: [], operations: [] });
  });

  it('keeps the paid view on the piecework lane only', async () => {
    mocks.operationType.mockResolvedValue('PARTIAL');
    mocks.queryRaw.mockImplementation(async (query: RawSql) => (query.sql.includes('count(*)') ? [{ count: BigInt(0) }] : []));
    await listWorkerTaskPage(actor, { view: 'paid', q: '' });
    expect(mocks.progressCraftIds).not.toHaveBeenCalled();
    for (const query of queries()) {
      expect(query.sql).not.toContain('craftId');
      expect(query.values).toContain('PARTIAL');
    }
  });
});
