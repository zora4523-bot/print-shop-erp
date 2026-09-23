import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
import {
  PieceworkOperationType,
  ProductionOperationStatus,
  Role,
} from '@/generated/prisma/enums';

// 扫码、任务列表和工单页进入报工页都不带 reportBatch。默认批次必须由服务端按本人在该
// 工序/步骤已有的报工条数推导，并固定进地址栏：刷新同一地址仍是同一批，报成功后重新
// 进入就是新的一批，同量第二批不会被当成重复提交吞掉（审计 M-2）。
const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  operation: vi.fn(),
  progress: vi.fn(),
  operationForm: vi.fn(),
  progressForm: vi.fn(),
  defaultBatch: vi.fn(),
}));
vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('@/lib/production/report-batch', () => ({ defaultReportBatch: mocks.defaultBatch }));
vi.mock('@/lib/auth/session', () => ({ requireSession: mocks.session }));
vi.mock('next/navigation', () => ({
  notFound: () => { throw new Error('NOT_FOUND'); },
  redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); },
}));
vi.mock('@/lib/production/operation-reporting', () => ({ OperationReportingError: class extends Error {} }));
vi.mock('@/lib/production/operation-portal', () => ({
  getProductionOperationForReporter: mocks.operation,
  getProductionProgressForReporter: mocks.progress,
}));
vi.mock('@/lib/production/legacy-task-reader', () => ({ getLegacyProductionTaskDetail: vi.fn().mockResolvedValue(null) }));
vi.mock('@/lib/production/task-dispute', () => ({ listWorkerTaskDisputes: vi.fn().mockResolvedValue([]) }));
vi.mock('@/lib/salary/piecework-rate-selection', () => ({
  resolveReporterPieceworkRate: vi.fn().mockResolvedValue({
    key: 'rate-key', source: 'UNIFORM', book: { version: 3 },
    rule: { amount: '0.0100', smallOrderAmount: null, setupAmount: null },
  }),
}));
vi.mock('@/lib/background-jobs/clock', () => ({ databaseClockNow: vi.fn().mockResolvedValue(new Date('2026-09-23T02:00:00Z')) }));
vi.mock('@/components/business/production/OperationReportForm', () => ({
  OperationReportForm: (props: { idempotencyKey: string }) => { mocks.operationForm(props); return null; },
  ProgressReportForm: (props: { idempotencyKey: string }) => { mocks.progressForm(props); return null; },
}));
vi.mock('@/components/business/production/WorkerOperationSources', () => ({ WorkerOperationSources: () => null }));
vi.mock('@/components/business/production/TaskDisputePanel', () => ({ TaskDisputePanel: () => null }));
vi.mock('@/components/business/order/DesignImageGallery', () => ({ DesignImageGallery: () => null }));
vi.mock('@/lib/oss/read-url', () => ({ signDesignReadUrl: (url: string) => url }));
import Page from '../worker/tasks/[id]/page';

const operationFixture = {
  id: 'op-1', orderId: 'order-1', orderNo: 'GD-260923-001', isUrgent: false,
  status: ProductionOperationStatus.IN_PROGRESS, operationType: PieceworkOperationType.PARTIAL,
  unit: 'PER_PIECE', sources: [], customName: null, plannedCompletedQty: '1000', completedQty: '500',
  defectQty: '0', reworkQty: '0', workOrderTotalQty: '1000', workOrderProgressQty: '500',
  payrollPassCount: 1, payrollRevision: 0, promisedDate: null, packageRequirement: null, orderRemark: null,
};
const progressFixture = {
  id: 'step-1', orderId: 'order-1', orderNo: 'GD-260923-001', isUrgent: false,
  status: ProductionOperationStatus.IN_PROGRESS, craftName: '压凹', orderItemSequence: 1, orderItemName: '款式一',
  plannedQty: '1000', completedQty: '500', defectQty: '0', reworkQty: '0', promisedDate: null,
  packageRequirement: null, orderRemark: null,
  item: { sequence: 1, name: '款式一', specification: null, paperType: null, quantity: 1000, remark: null, designs: [] },
};

async function render(searchParams: { reportBatch?: string }, id: string) {
  return renderToStaticMarkup(await Page({ params: Promise.resolve({ id }), searchParams: Promise.resolve(searchParams) }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ user: { id: 'worker-1', role: Role.WORKER, displayName: '师傅甲' } });
  mocks.operation.mockResolvedValue(null);
  mocks.progress.mockResolvedValue(null);
  mocks.defaultBatch.mockResolvedValue(0);
});

it('pins a fresh piecework entry to the reporter\'s existing report count', async () => {
  mocks.operation.mockResolvedValue(operationFixture);
  mocks.defaultBatch.mockResolvedValue(1);
  await expect(render({}, 'op-1')).rejects.toThrow('REDIRECT:/worker/tasks/op-1?reportBatch=1');
  expect(mocks.defaultBatch).toHaveBeenCalledWith('operation', 'op-1', 'worker-1');
  expect(mocks.operationForm).not.toHaveBeenCalled();
});

it('pins a fresh progress entry to the reporter\'s existing progress report count', async () => {
  mocks.progress.mockResolvedValue(progressFixture);
  mocks.defaultBatch.mockResolvedValue(2);
  await expect(render({}, 'step-1')).rejects.toThrow('REDIRECT:/worker/tasks/step-1?reportBatch=2');
  expect(mocks.defaultBatch).toHaveBeenCalledWith('progress', 'step-1', 'worker-1');
  expect(mocks.progressForm).not.toHaveBeenCalled();
});

it('keeps the batch already in the address bar so a refresh reuses the same key', async () => {
  mocks.operation.mockResolvedValue(operationFixture);
  await render({ reportBatch: '7' }, 'op-1');
  expect(mocks.operationForm).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: 'batch:7' }));
  mocks.progress.mockResolvedValue(progressFixture);
  mocks.operation.mockResolvedValue(null);
  await render({ reportBatch: '0' }, 'step-1');
  expect(mocks.progressForm).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: 'batch:0' }));
  expect(mocks.defaultBatch).not.toHaveBeenCalled();
});

it('replaces a malformed address bar batch with the derived one', async () => {
  mocks.progress.mockResolvedValue(progressFixture);
  mocks.defaultBatch.mockResolvedValue(3);
  await expect(render({ reportBatch: '-1' }, 'step-1')).rejects.toThrow('REDIRECT:/worker/tasks/step-1?reportBatch=3');
});

it('does not derive a batch for a step that no longer accepts reports', async () => {
  mocks.operation.mockResolvedValue({ ...operationFixture, status: ProductionOperationStatus.COMPLETED });
  const html = await render({}, 'op-1');
  expect(html).toContain('工序进度');
  expect(mocks.defaultBatch).not.toHaveBeenCalled();
  expect(mocks.operationForm).not.toHaveBeenCalled();
});
