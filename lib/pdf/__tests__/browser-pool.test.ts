import { afterEach, expect, it, vi } from 'vitest';
import type { Browser, BrowserContext } from 'puppeteer';
import { PdfBrowserPool } from '../browser-pool';

function setup(maxUses = 50) {
  const contexts: BrowserContext[] = [];
  const browser = { connected: true, close: vi.fn().mockResolvedValue(undefined), createBrowserContext: vi.fn(async () => {
    const context = { close: vi.fn().mockResolvedValue(undefined) } as unknown as BrowserContext;
    contexts.push(context); return context;
  }) } as unknown as Browser;
  const launch = vi.fn(async () => browser);
  return { pool: new PdfBrowserPool(launch, maxUses), browser, launch, contexts };
}
afterEach(() => vi.restoreAllMocks());
it('reuses only the browser and closes an isolated context for every render', async () => {
  const { pool, launch, contexts } = setup();
  await pool.run(async () => 'one');
  await pool.run(async () => 'two');
  expect(launch).toHaveBeenCalledTimes(1);
  expect(contexts).toHaveLength(2);
  expect(contexts[0]).not.toBe(contexts[1]);
  for (const context of contexts) expect(context.close).toHaveBeenCalledOnce();
  await pool.close();
});
it('serializes renders and refuses to run an aborted queued task', async () => {
  const { pool } = setup();
  let finish!: () => void;
  const first = pool.run(() => new Promise<void>((resolve) => { finish = resolve; }));
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  const controller = new AbortController();
  const task = vi.fn();
  const second = pool.run(task, controller.signal);
  controller.abort(); finish(); await first;
  await expect(second).rejects.toMatchObject({ name: 'AbortError' });
  expect(task).not.toHaveBeenCalled();
  await pool.close();
});
it('restarts after a failed render, disconnect or the configured use limit', async () => {
  const { pool, launch, browser } = setup(1);
  await expect(pool.run(async () => { throw new Error('render'); })).rejects.toThrow('render');
  expect(browser.close).toHaveBeenCalledOnce();
  await pool.run(async () => 'ok');
  await pool.run(async () => 'recycled');
  expect(launch).toHaveBeenCalledTimes(3);
  await pool.close();
  await expect(pool.run(async () => null)).rejects.toMatchObject({ name: 'PdfBrowserUnavailableError' });
});
it('releases idle browsers and relaunches on demand', async () => {
  vi.useFakeTimers();
  const { pool, browser, launch } = setup();
  try {
    await pool.run(async () => 'ok');
    await vi.advanceTimersByTimeAsync(60_001);
    expect(browser.close).toHaveBeenCalledOnce();
    await pool.run(async () => 'again');
    expect(launch).toHaveBeenCalledTimes(2);
    await pool.close();
  } finally { vi.useRealTimers(); }
});
