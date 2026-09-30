import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => [] as string[]);
vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('@/lib/background-jobs/clock', () => ({ databaseClockNow: async () => new Date('2026-10-01T04:00:00.000Z') }));
vi.mock('@/lib/production-completion', () => ({ dispatchProductionCompletionNotification: vi.fn() }));
vi.mock('../completion-registration', () => ({
  registerProductionCompletionInTx: vi.fn(async (_tx: unknown, input: { jobId: string }) => { calls.push(`register:${input.jobId}`); return { orderId: 'o1', status: 'COMPLETED' }; }),
}));

const { completePlannedProductionInTx } = await import('../planned-completion');

function job(id: string, workerId: string) {
  return { id, revision: 0, label: '局部烫金', workerId, workerName: workerId, plannedQty: { toString: () => '1000' }, status: 'PENDING', operationId: `op-${id}`, progressStepId: null };
}

describe('completePlannedProductionInTx lock order', () => {
  beforeEach(() => { calls.length = 0; });
  it('takes every worker lock, sorted, before registering any job', async () => {
    const tx = {
      $executeRaw: vi.fn(async (strings: TemplateStringsArray, key: string) => { calls.push(`lock:${key}`); }),
      order: { findUnique: vi.fn(async () => ({ simpleProduction: true, status: 'RELEASED', workOrderVersion: 1 })) },
      orderChangeRequest: { count: vi.fn(async () => 0) },
      productionJob: { findMany: vi.fn(async () => [job('j1', 'worker-b'), job('j2', 'worker-a')]) },
      productionOperation: { findMany: vi.fn(async () => []) },
      productionProgressStep: { findMany: vi.fn(async () => []) },
      user: { findMany: vi.fn(async () => [{ id: 'worker-a', displayName: 'A', employmentStartDate: null, employmentEndDate: null }, { id: 'worker-b', displayName: 'B', employmentStartDate: null, employmentEndDate: null }]) },
    };
    await completePlannedProductionInTx(tx as never, 'o1', { id: 'admin', role: 'ADMIN' }, 'ADMIN_BATCH');
    const workerLocks = calls.filter(call => call.startsWith('lock:') && call.includes('worker-'));
    expect(workerLocks).toHaveLength(2);
    expect(workerLocks[0]).toContain('worker-a');
    expect(workerLocks[1]).toContain('worker-b');
    expect(calls.indexOf(workerLocks[1])).toBeLessThan(calls.indexOf('register:j1'));
    expect(calls.filter(call => call.startsWith('register:'))).toEqual(['register:j1', 'register:j2']);
  });
});
