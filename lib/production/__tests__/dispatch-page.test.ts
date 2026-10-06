import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  targets: vi.fn(),
  lane: vi.fn(),
  crafts: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('@/lib/production/dispatch-targets', () => ({ currentDispatchTargets: mocks.targets }));
vi.mock('@/lib/production/reporter-operation-lane', () => ({ operationTypeForReporterAccount: mocks.lane }));
vi.mock('@/lib/production/progress-reporter-lane', () => ({ progressCraftIdsForReporter: mocks.crafts }));

import { loadDispatchPageOrders } from '../dispatch-page';
import { DispatchPlanValidationError } from '../dispatch-plan-error';

const workers = [
  { id: 'w-hand', displayName: '手压师傅' },
  { id: 'w-foil', displayName: '烫金师傅' },
];

function client(jobs: unknown[]) {
  return {
    user: { findMany: vi.fn().mockResolvedValue(workers) },
    orderChangeRequest: { count: vi.fn().mockResolvedValue(0) },
    productionOperation: { count: vi.fn().mockResolvedValue(0) },
    productionProgressStep: { count: vi.fn().mockResolvedValue(0) },
    productionTask: { count: vi.fn().mockResolvedValue(0) },
    productionJob: { findMany: vi.fn().mockResolvedValue(jobs) },
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.lane.mockImplementation((worker: { id: string }) => (worker.id === 'w-hand' ? 'HAND_PRESS' : null));
  mocks.crafts.mockImplementation(async (_c: unknown, worker: { id: string }) => (worker.id === 'w-foil' ? ['craft-foil'] : []));
  mocks.targets.mockResolvedValue({
    order: { status: 'CONFIRMED', pricingStatus: 'ADMIN_CONFIRMED', customName: '', orderNo: 'GD-1', revision: 3, workOrderVersion: 2 },
    targets: [
      { key: 'op', label: '手压', quantity: '1000', operationType: 'HAND_PRESS', craftId: null },
      { key: 'progress', label: '烫金', quantity: '500', operationType: null, craftId: 'craft-foil' },
    ],
  });
});

describe('loadDispatchPageOrders', () => {
  it.each(['ON_HOLD', 'CANCELLED', 'SETTLED'])('shows a recovery reason before assigning %s orders', async status => {
    const current = await mocks.targets();
    mocks.targets.mockResolvedValueOnce({ ...current, order: { ...current.order, status } });
    const [row] = await loadDispatchPageOrders(['blocked'], client([]));
    expect(row.tasks).toEqual([]);
    expect(row.issues).toContain('当前状态不能安排生产，请返回工单处理。');
  });

  it.each(['SAMPLE_SHIPMENT', 'STANDARD'])('explains zero factory targets for %s and keeps the complete selection', async purpose => {
    mocks.targets.mockResolvedValueOnce({ order: { purpose, orderNo: 'NO-FACTORY', revision: 1, workOrderVersion: 1 }, targets: [] });
    const rows = await loadDispatchPageOrders(['zero', 'factory'], client([]));
    expect(rows).toHaveLength(2);
    expect(rows[0].tasks).toEqual([]);
    expect(rows[0].issues?.[0]).toContain(purpose === 'SAMPLE_SHIPMENT' ? '寄样工单无需' : '没有需要分配师傅');
    expect(rows[1].tasks).toHaveLength(2);
  });
  it('returns blocked orders with safe issues and keeps other selected orders visible', async () => {
    mocks.targets.mockRejectedValueOnce(new DispatchPlanValidationError(
      { id: 'bad', customName: null, orderNo: 'BAD-1', revision: 2, workOrderVersion: 1 },
      [{ code: 'UNKNOWN_CRAFT', message: '款式 #1 缺少可唯一映射的 canonical 工艺' }],
    ));
    const rows = await loadDispatchPageOrders(['bad', 'o1'], client([]));
    expect(rows[0]).toEqual({ id: 'bad', name: 'BAD-1', revision: 2, version: 1, tasks: [], issues: ['款式 #1：生产工艺不明确，请完善工艺资料。'] });
    expect(rows[1].tasks).toHaveLength(2);
    expect(mocks.targets).toHaveBeenCalledTimes(2);
  });

  it('does not disguise unexpected database failures as incomplete data', async () => {
    const error = new Error('database offline');
    mocks.targets.mockRejectedValueOnce(error);
    await expect(loadDispatchPageOrders(['o1'], client([]))).rejects.toBe(error);
  });

  it('offers workers by operation lane or progress craft, falling back to the order number', async () => {
    const [row] = await loadDispatchPageOrders(['o1'], client([]));
    expect(row).toMatchObject({ id: 'o1', name: 'GD-1', revision: 3, version: 2 });
    expect(row.tasks[0]).toEqual({ key: 'op', label: '手压', quantity: '1000', workerId: '', locked: false, options: [{ id: 'w-hand', name: '手压师傅' }] });
    expect(row.tasks[1].options).toEqual([{ id: 'w-foil', name: '烫金师傅' }]);
  });

  it('keeps an assigned worker who no longer qualifies and locks started jobs', async () => {
    const jobs = [{ sourceKey: 'op', workerId: 'w-gone', workerName: '离岗师傅', plannedQty: { toString: () => '800' }, status: 'IN_PROGRESS' }];
    const [row] = await loadDispatchPageOrders(['o1'], client(jobs));
    expect(row.tasks[0]).toMatchObject({ quantity: '800', workerId: 'w-gone', locked: true });
    expect(row.tasks[0].options).toContainEqual({ id: 'w-gone', name: '离岗师傅（原生产师傅）' });
  });
});
