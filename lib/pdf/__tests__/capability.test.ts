import { afterEach, expect, it, vi } from 'vitest';
import { PDF_PROBE_HEALTHY_INTERVAL_MS, PDF_READY_TTL_MS, startPdfCapabilityMonitor } from '../capability';

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
  await vi.advanceTimersByTimeAsync(PDF_READY_TTL_MS + 1);
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
it('healthy probes run on a long interval and readiness spans it without flapping', async () => {
  vi.useFakeTimers();
  const probe = vi.fn().mockResolvedValue(undefined);
  const monitor = startPdfCapabilityMonitor(probe);
  await vi.advanceTimersByTimeAsync(0);
  expect(PDF_PROBE_HEALTHY_INTERVAL_MS).toBeGreaterThan(60_000); // > pool idleMs, lets Chromium idle out
  expect(PDF_READY_TTL_MS).toBeGreaterThan(PDF_PROBE_HEALTHY_INTERVAL_MS);
  await vi.advanceTimersByTimeAsync(PDF_PROBE_HEALTHY_INTERVAL_MS - 1);
  expect(probe).toHaveBeenCalledTimes(1);
  expect(monitor.ready()).toBe(true);
  await vi.advanceTimersByTimeAsync(1);
  expect(probe).toHaveBeenCalledTimes(2);
  expect(monitor.ready()).toBe(true);
  await monitor.stop();
});
it('an invalidation during an in-flight probe schedules the 10s retry, not the healthy interval', async () => {
  vi.useFakeTimers();
  let release!: () => void;
  const probe = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
  const monitor = startPdfCapabilityMonitor(probe);
  await vi.advanceTimersByTimeAsync(0);
  monitor.invalidate(); release();
  await vi.advanceTimersByTimeAsync(9_999);
  expect(probe).toHaveBeenCalledTimes(1);
  expect(monitor.ready()).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(probe).toHaveBeenCalledTimes(2);
  release();
  await vi.advanceTimersByTimeAsync(0);
  expect(monitor.ready()).toBe(true);
  await monitor.stop();
});
