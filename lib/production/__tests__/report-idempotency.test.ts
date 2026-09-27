import { describe, expect, it } from 'vitest';
import { reportIdempotencyKey } from '../report-idempotency';
const facts = { key: 'batch:0', kind: 'operation' as const, targetId: 'op-1', reporterId: 'worker-1', completedQty: 100, defectQty: 2, reworkQty: 1, workOrderProgressQuantity: 80 };
const now = new Date('2026-09-21T00:00:00Z');
describe('refresh-stable report identity', () => {
  // 同一批次（刷新同一地址后重提）才复用标识；新进入页面的批次号由报工条数推导，见 report-batch。
  it('reuses the same Shanghai-day facts when the same batch is resubmitted', () => {
    expect(reportIdempotencyKey({ ...facts }, now)).toBe(reportIdempotencyKey({ ...facts }, new Date('2026-09-21T15:59:59Z')));
  });
  it.each([{ key: 'batch:1' }, { completedQty: 101 }, { defectQty: 3 }, { reworkQty: 2 }, { workOrderProgressQuantity: 81 }, { reporterId: 'worker-2' }, { targetId: 'op-2' }, { kind: 'progress' as const }])('separates changed facts %j', change => {
    expect(reportIdempotencyKey({ ...facts, ...change }, now)).not.toBe(reportIdempotencyKey(facts, now));
  });
  it('rolls over at Shanghai midnight, not UTC midnight', () => {
    expect(reportIdempotencyKey(facts, new Date('2026-09-21T16:00:00Z'))).not.toBe(reportIdempotencyKey(facts, now));
  });
  it('retains old clients and rejects invalid explicit batch scopes', () => {
    expect(reportIdempotencyKey({ ...facts, key: 'legacy-request' }, now)).toBe('legacy-request');
    expect(() => reportIdempotencyKey({ ...facts, key: 'batch:-1' }, now)).toThrow();
  });
});
