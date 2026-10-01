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

const workers = [
  { id: 'w-hand', displayName: '手压师傅' },
  { id: 'w-foil', displayName: '烫金师傅' },
];

function client(jobs: unknown[]) {
  return {
    user: { findMany: vi.fn().mockResolvedValue(workers) },
    productionJob: { findMany: vi.fn().mockResolvedValue(jobs) },
  } as never;
}

beforeEach(() => {
  mocks.lane.mockImplementation((worker: { id: string }) => (worker.id === 'w-hand' ? 'HAND_PRESS' : null));
  mocks.crafts.mockImplementation(async (_c: unknown, worker: { id: string }) => (worker.id === 'w-foil' ? ['craft-foil'] : []));
  mocks.targets.mockResolvedValue({
    order: { customName: '', orderNo: 'GD-1', revision: 3, workOrderVersion: 2 },
    targets: [
      { key: 'op', label: '手压', quantity: '1000', operationType: 'HAND_PRESS', craftId: null },
      { key: 'progress', label: '烫金', quantity: '500', operationType: null, craftId: 'craft-foil' },
    ],
  });
});

describe('loadDispatchPageOrders', () => {
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
