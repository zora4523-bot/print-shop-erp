import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  workers: vi.fn(),
  jobs: vi.fn(),
  targets: vi.fn(),
  form: vi.fn(() => null),
}));
vi.mock('@/lib/auth/permissions', () => ({
  requirePermission: vi.fn().mockResolvedValue({ id: 'admin', role: 'ADMIN' }),
}));
vi.mock('@/lib/db', () => ({ db: {
  user: { findMany: mocks.workers },
  productionJob: { findMany: mocks.jobs },
} }));
vi.mock('@/lib/production/dispatch-targets', () => ({ currentDispatchTargets: mocks.targets }));
vi.mock('@/lib/production/reporter-operation-lane', () => ({
  operationTypeForReporterAccount: (worker: { lane: string }) => worker.lane,
}));
vi.mock('@/lib/production/progress-reporter-lane', () => ({
  progressCraftIdsForReporter: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/components/business/production/ProductionDispatchForm', () => ({
  ProductionDispatchForm: mocks.form,
}));

import ProductionDispatchPage from '../orders/production/page';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.targets.mockResolvedValue({
    order: { id: 'order', customName: '工单', revision: 2, workOrderVersion: 1 },
    targets: [{ key: 'PARTIAL:item', label: '局部烫金', quantity: '1000', operationType: 'PARTIAL' }],
  });
  mocks.jobs.mockResolvedValue([{
    sourceKey: 'PARTIAL:item', workerId: 'original', workerName: '原师傅',
    plannedQty: 1000, status: 'PENDING',
  }]);
});

it.each(['岗位调整', '账号停用'])('保留%s后的原生产归属选项', async scenario => {
  mocks.workers.mockResolvedValue([
    { id: 'eligible', displayName: '可安排师傅', lane: 'PARTIAL' },
    ...(scenario === '岗位调整' ? [{ id: 'original', displayName: '原师傅', lane: 'FULL' }] : []),
  ]);
  renderToStaticMarkup(await ProductionDispatchPage({ searchParams: Promise.resolve({ ids: 'order' }) }));
  expect(mocks.form).toHaveBeenCalledWith(expect.objectContaining({
    orders: [expect.objectContaining({ tasks: [expect.objectContaining({
      workerId: 'original',
      options: [
        { id: 'eligible', name: '可安排师傅' },
        { id: 'original', name: '原师傅（原生产师傅）' },
      ],
    })] })],
  }), undefined);
});
