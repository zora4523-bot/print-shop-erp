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
import { DispatchPlanValidationError } from '@/lib/production/dispatch-plan-error';

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

it('renders an actionable incomplete-order notice without a partial batch form', async () => {
  mocks.workers.mockResolvedValue([]);
  mocks.targets.mockRejectedValueOnce(new DispatchPlanValidationError(
    { id: 'bad', customName: '待完善工单', orderNo: 'BAD-1', revision: 1, workOrderVersion: 1 },
    [{ code: 'NO_PACKAGING_GROUPS', message: '工单没有包装组，无法确定打包计件数' }],
  ));
  const html = renderToStaticMarkup(await ProductionDispatchPage({ searchParams: Promise.resolve({ ids: 'bad,order' }) }));
  expect(html).toContain('工单资料不完整，暂不能安排本批生产');
  expect(html).toContain('已选择 2 张工单');
  expect(html).toContain('href="/orders/bad"');
  expect(html).toContain('待完善工单');
  expect(html).toContain('未填写包装组，请完善包装资料。');
  expect(html).toContain('返回工单列表');
  expect(mocks.form).not.toHaveBeenCalled();
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
