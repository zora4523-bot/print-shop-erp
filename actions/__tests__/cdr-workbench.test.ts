import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ permission: vi.fn(), enqueue: vi.fn(), create: vi.fn(), revalidate: vi.fn(), find: vi.fn(), regenerate: vi.fn(), mode: vi.fn(), progress: vi.fn() }));
vi.mock('@/lib/auth/permissions', () => ({ requirePermission: mocks.permission }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
vi.mock('@/lib/db', () => ({ db: { designBundle: { findUnique: mocks.find } } }));
vi.mock('@/lib/cdr/workbench', () => ({ workbenchRegenerationSelection: mocks.regenerate }));
vi.mock('@/lib/cdr/history', () => ({ readCdrProgress: mocks.progress }));
vi.mock('@/lib/cdr/bundle', () => ({ createBundle: mocks.create, enqueueBundle: mocks.enqueue, CdrBundleError: class extends Error {} }));
vi.mock('@/lib/public-base-url', () => ({ derivePublicBaseUrl: async () => 'https://erp.example.com' }));
vi.mock('@/lib/background-jobs/mode', () => ({ backgroundJobsMode: mocks.mode }));
import { createWorkbenchBundleAction, getWorkbenchBundleProgressAction } from '../cdr-workbench';
beforeEach(() => { vi.resetAllMocks(); mocks.permission.mockResolvedValue({ id: 'admin' }); mocks.mode.mockReturnValue('durable'); });
it('permission is the first gate even on invalid input and regeneration', async () => {
  mocks.permission.mockRejectedValue(new Error('Forbidden'));
  await expect(createWorkbenchBundleAction(null, new FormData())).rejects.toThrow('Forbidden');
  expect(mocks.find).not.toHaveBeenCalled(); expect(mocks.enqueue).not.toHaveBeenCalled();
});
it('rejects duplicate and malformed inputs before enqueue', async () => {
  const form = new FormData(); form.set('selection', 'invalid');
  expect((await createWorkbenchBundleAction(null, form)).status).toBe('error');
  form.set('selection', JSON.stringify([{ id: 'o1', version: 'a'.repeat(64) }, { id: 'o1', version: 'a'.repeat(64) }]));
  expect((await createWorkbenchBundleAction(null, form)).status).toBe('error'); expect(mocks.enqueue).not.toHaveBeenCalled();
});
it('queues server-validated selection and revalidates both entries without leaking internal fields', async () => {
  mocks.enqueue.mockResolvedValue({ bundleId: 'b1', jobId: 'j1', fileCount: 2, downloadUrl: 'private', relativePath: 'private' });
  const form = new FormData(); form.set('selection', JSON.stringify([{ id: 'o1', version: 'a'.repeat(64) }]));
  expect(await createWorkbenchBundleAction(null, form)).toEqual({ status: 'queued', bundleId: 'b1', jobId: 'j1', fileCount: 2 });
  expect(mocks.permission).toHaveBeenCalledWith('design:bundle:create');
  expect(mocks.revalidate.mock.calls).toEqual([['/owner'], ['/foreman/cdr']]);
});

it('regenerates original orders with current versions, then uses inline mode safely', async () => {
  mocks.mode.mockReturnValue('inline');
  mocks.regenerate.mockResolvedValue([{ id: 'o1', version: 'a'.repeat(64) }]);
  mocks.create.mockResolvedValue({ bundleId: 'b2', fileCount: 1, downloadUrl: 'https://erp.example.com/api/cdr/bundles/token', relativePath: '/api/cdr/bundles/token', expiresAt: new Date(), isMock: false });
  const form = new FormData(); form.set('bundleId', 'b1');
  expect((await createWorkbenchBundleAction(null, form)).status).toBe('success');
  expect(mocks.regenerate).toHaveBeenCalledWith('b1');
  expect(mocks.enqueue).not.toHaveBeenCalled();
});
it('refreshes stale candidates on domain failure without leaking unexpected errors', async () => {
  const { CdrBundleError } = await import('@/lib/cdr/bundle');
  mocks.enqueue.mockRejectedValue(new CdrBundleError('工单已更新'));
  const form = new FormData(); form.set('selection', JSON.stringify([{ id: 'o1', version: 'a'.repeat(64) }]));
  expect(await createWorkbenchBundleAction(null, form)).toEqual({ status: 'error', message: '工单已更新' });
  expect(mocks.revalidate).toHaveBeenCalledWith('/owner');
});
it('progress lookup enforces permission and selects the requested bundle directly', async () => {
  mocks.progress.mockResolvedValue({ id: 'old-pending' });
  expect(await getWorkbenchBundleProgressAction('old-pending')).toEqual({ id: 'old-pending' });
  mocks.permission.mockRejectedValue(new Error('Forbidden'));
  await expect(getWorkbenchBundleProgressAction('old-pending')).rejects.toThrow('Forbidden');
  expect(mocks.progress).toHaveBeenCalledTimes(1);
});
