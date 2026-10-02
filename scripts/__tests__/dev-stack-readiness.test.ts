import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WORKER_HEARTBEAT_ACTIVE_WINDOW_MS } from '@/lib/background-jobs/heartbeat-timing.mjs';
const m = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn(), end: vi.fn() }));
vi.mock('pg', () => ({ default: { Client: class { query = m.query; connect = m.connect; end = m.end; } } }));
import { waitForWorkers } from '../dev-stack.mjs';
beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(0); });
afterEach(() => { vi.useRealTimers(); });
it('accepts a healthy worker whose first ready heartbeat arrives at the maximum 60-second interval', async () => {
  m.query.mockImplementation(async (sql: string) => sql.startsWith('SET') ? {} : { rows: Date.now() >= 60_000 ? [{ queue: 'LIGHT' }, { queue: 'HEAVY' }] : [{ queue: 'LIGHT' }] });
  const ready = waitForWorkers({ APP_VERSION: 'test', WORKER_HEARTBEAT_MS: '60000' }, () => false);
  await vi.advanceTimersByTimeAsync(60_000);
  await ready;
  expect(m.query).toHaveBeenLastCalledWith(expect.stringContaining('$2 * interval'), ['test', WORKER_HEARTBEAT_ACTIVE_WINDOW_MS]);
  expect(m.end).toHaveBeenCalledOnce();
});
it('still bounds startup and closes the connection when workers never become ready', async () => {
  m.query.mockResolvedValue({ rows: [] });
  const failed = expect(waitForWorkers({ APP_VERSION: 'test' }, () => false)).rejects.toThrow('DEV_WORKERS_NOT_READY');
  await vi.advanceTimersByTimeAsync(240_000);
  await failed;
  expect(m.end).toHaveBeenCalledOnce();
});
