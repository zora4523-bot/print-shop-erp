import { afterEach, expect, it, vi } from 'vitest';
import { startPdfCapabilityMonitor } from '../capability';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
it('starts unavailable, backs off, recovers, and expires readiness during a stuck probe', async () => {
  vi.useFakeTimers();
  const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const probe = vi.fn().mockRejectedValueOnce(new Error('secret')).mockResolvedValueOnce(undefined);
  const monitor = startPdfCapabilityMonitor(probe);
  expect(monitor.ready()).toBe(false);
  await vi.advanceTimersByTimeAsync(0);
  expect(log.mock.calls.flat().join('')).not.toContain('secret');
  await vi.advanceTimersByTimeAsync(9999);
  expect(probe).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(monitor.ready()).toBe(true);
  let release!: () => void;
  probe.mockImplementation(() => new Promise<void>((resolve) => { release = resolve; }));
  await vi.advanceTimersByTimeAsync(120001);
  expect(monitor.ready()).toBe(false);
  expect(probe).toHaveBeenCalledTimes(3);
  const stop = monitor.stop(); release(); await stop;
  expect(monitor.ready()).toBe(false);
});
it('a job failure wins over an older probe completion and shutdown stops retrying', async () => {
  vi.useFakeTimers();
  let release!: () => void;
  const probe = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
  const monitor = startPdfCapabilityMonitor(probe);
  await vi.advanceTimersByTimeAsync(0);
  monitor.invalidate(); release();
  await vi.advanceTimersByTimeAsync(0);
  expect(monitor.ready()).toBe(false);
  await monitor.stop();
  await vi.advanceTimersByTimeAsync(180000);
  expect(probe).toHaveBeenCalledTimes(1);
});
