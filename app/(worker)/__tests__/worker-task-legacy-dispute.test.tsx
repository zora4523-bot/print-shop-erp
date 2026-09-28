vi.mock('@/components/business/production/WorkerCompletionDetail', () => ({ WorkerCompletionDetail: () => null }));
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
import { Role, WorkerType, TaskStatus, ProductionTaskDisputeStatus } from '@/generated/prisma/enums';
const { legacy, disputes, session } = vi.hoisted(() => ({ legacy: vi.fn(), disputes: vi.fn(), session: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: { productionJob: { findFirst: vi.fn().mockResolvedValue(null) } } }));
vi.mock('@/lib/production/operation-reporting', () => ({ OperationReportingError: class extends Error {} }));
vi.mock('@/lib/auth/session', () => ({ requireSession: session }));
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NOT_FOUND'); } }));
vi.mock('@/lib/production/operation-portal', () => ({ getProductionOperationForReporter: vi.fn().mockResolvedValue(null), getProductionProgressForReporter: vi.fn().mockResolvedValue(null) }));
vi.mock('@/lib/production/legacy-task-reader', () => ({ getLegacyProductionTaskDetail: legacy }));
vi.mock('@/lib/production/task-dispute', () => ({ listWorkerTaskDisputes: disputes }));
vi.mock('@/actions/task-disputes', () => ({ createTaskDisputeAction: vi.fn() }));
vi.mock('@/components/business/production/OperationReportForm', () => ({ OperationReportForm: () => null, ProgressReportForm: () => null }));
vi.mock('@/components/business/order/DesignImageGallery', () => ({ DesignImageGallery: () => null }));
vi.mock('@/lib/oss/read-url', () => ({ signDesignReadUrl: (url: string) => url }));
import Page from '../worker/tasks/[id]/page';
beforeEach(() => {
  vi.clearAllMocks();
  session.mockResolvedValue({ user: { id: 'worker-1', role: Role.WORKER } });
  legacy.mockResolvedValue({
    id: 'legacy-1', status: TaskStatus.COMPLETED, workerType: WorkerType.MACHINE,
    plannedQty: 100, completedQty: 100, defectQty: 0, reworkQty: 0, pieceworkAmount: '12.34',
    craft: { name: '烫金' },
    orderItem: { sequence: 1, name: '历史款式', designs: [], remark: null, order: { orderNo: 'GD-260915-001', isUrgent: false } },
  });
  disputes.mockResolvedValue([]);
});
it('renders the dispute form on a legacy salary task link with the current actor', async () => {
  const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}), params: Promise.resolve({ id: 'legacy-1' }) }));
  expect(legacy).toHaveBeenCalledWith('legacy-1', { id: 'worker-1', role: Role.WORKER });
  expect(disputes).toHaveBeenCalledWith('legacy-1', { id: 'worker-1', role: Role.WORKER });
  expect(html).toContain('任务 / 计件异议');
  expect(html).toContain('name="reason"');
  expect(html).toContain('提交异议');
});
it('renders existing pending disputes and suppresses duplicate submission', async () => {
  disputes.mockResolvedValue([{ id: 'd1', productionTaskId: 'legacy-1', status: ProductionTaskDisputeStatus.PENDING,
    reason: '合格数量需要复核', resolution: null, resolvedAt: null, resolvedBy: null, createdAt: new Date('2026-09-01'), updatedAt: new Date('2026-09-01') }]);
  const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}), params: Promise.resolve({ id: 'legacy-1' }) }));
  expect(html).toContain('合格数量需要复核');
  expect(html).not.toContain('name="reason"');
});
it('does not query disputes when the scoped legacy task does not exist', async () => {
  legacy.mockResolvedValue(null);
  await expect(Page({ searchParams: Promise.resolve({}), params: Promise.resolve({ id: 'other-task' }) })).rejects.toThrow('NOT_FOUND');
  expect(disputes).not.toHaveBeenCalled();
});
it('propagates the dispute ownership rejection instead of rendering a form', async () => {
  disputes.mockRejectedValue(new Error('任务不存在或不属于当前师傅'));
  await expect(Page({ searchParams: Promise.resolve({}), params: Promise.resolve({ id: 'legacy-1' }) })).rejects.toThrow('不属于当前师傅');
});
