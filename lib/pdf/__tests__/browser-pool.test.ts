import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { afterEach, expect, it, vi } from 'vitest';
import type { Browser, BrowserContext } from 'puppeteer';
import { killBrowserProcessGroup, PdfBrowserPool, type PdfBrowserPoolOptions } from '../browser-pool';

type FakeChild = ChildProcess & { exit: () => void };
type FakeBrowser = Browser & { child: FakeChild; contexts: BrowserContext[] };

let nextPid = 40_000;
function fakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  Object.assign(child, { pid: nextPid++, exitCode: null, signalCode: null, kill: vi.fn() });
  child.exit = () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    Object.assign(child, { signalCode: 'SIGKILL' });
    child.emit('exit', null, 'SIGKILL');
  };
  return child;
}
function fakeBrowser(): FakeBrowser {
  const child = fakeChild();
  const contexts: BrowserContext[] = [];
  return {
    child, contexts, connected: true,
    process: () => child,
    // Puppeteer's close resolves only after the launched process has exited.
    close: vi.fn(async () => { child.exit(); }),
    createBrowserContext: vi.fn(async () => {
      const context = { close: vi.fn().mockResolvedValue(undefined) } as unknown as BrowserContext;
      contexts.push(context);
      return context;
    }),
  } as unknown as FakeBrowser;
}
function setup(options: PdfBrowserPoolOptions = {}) {
  const browsers: FakeBrowser[] = [];
  const launch = vi.fn(async () => { const browser = fakeBrowser(); browsers.push(browser); return browser as Browser; });
  return { pool: new PdfBrowserPool(launch, options), launch, browsers };
}
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const never = () => new Promise<never>(() => undefined);

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it('reuses only the browser and closes an isolated context for every render', async () => {
  const { pool, launch, browsers } = setup();
  await pool.run(async () => 'one');
  await pool.run(async () => 'two');
  expect(launch).toHaveBeenCalledTimes(1);
  const [first, second] = browsers[0]!.contexts;
  expect(first).not.toBe(second);
  for (const context of browsers[0]!.contexts) expect(context.close).toHaveBeenCalledOnce();
  await pool.close();
  expect(browsers[0]!.close).toHaveBeenCalledOnce();
});

it('serializes renders and refuses to run an aborted queued task', async () => {
  const { pool } = setup();
  const gate = deferred();
  const first = pool.run(() => gate.promise);
  const controller = new AbortController();
  const task = vi.fn();
  const second = pool.run(task, { signal: controller.signal });
  controller.abort(); gate.resolve(); await first;
  await expect(second).rejects.toMatchObject({ name: 'AbortError' });
  expect(task).not.toHaveBeenCalled();
  await pool.close();
});

it('cancelling a queued task never retires the browser of the running task', async () => {
  const { pool, browsers } = setup();
  const gate = deferred<string>();
  const running = pool.run(() => gate.promise);
  await vi.waitFor(() => expect(browsers).toHaveLength(1));
  const controller = new AbortController();
  const queued = pool.run(async () => 'never', { signal: controller.signal });
  controller.abort();
  gate.resolve('kept');
  expect(await running).toBe('kept');
  await expect(queued).rejects.toMatchObject({ name: 'AbortError' });
  expect(browsers[0]!.close).not.toHaveBeenCalled();
  await pool.close();
});

it('restarts after a failed render, disconnect or the configured use limit', async () => {
  const { pool, launch, browsers } = setup({ maxUses: 1 });
  await expect(pool.run(async () => { throw new Error('render'); })).rejects.toThrow('render');
  expect(browsers[0]!.close).toHaveBeenCalledOnce();
  await pool.run(async () => 'ok');
  await pool.run(async () => 'recycled');
  expect(launch).toHaveBeenCalledTimes(3);
  Object.assign(browsers[2]!, { connected: false });
  await pool.run(async () => 'after disconnect');
  expect(launch).toHaveBeenCalledTimes(4);
  await pool.close();
  await expect(pool.run(async () => null)).rejects.toMatchObject({ name: 'PdfBrowserUnavailableError' });
});

it('releases idle browsers and relaunches on demand', async () => {
  vi.useFakeTimers();
  const { pool, launch, browsers } = setup();
  await pool.run(async () => 'ok');
  await vi.advanceTimersByTimeAsync(60_001);
  expect(browsers[0]!.close).toHaveBeenCalledOnce();
  await pool.run(async () => 'again');
  expect(launch).toHaveBeenCalledTimes(2);
  await pool.close();
});

it('starts the task budget when the slot is owned, not while queued', async () => {
  vi.useFakeTimers();
  const { pool } = setup();
  const gate = deferred();
  const first = pool.run(() => gate.promise);
  let seen: AbortSignal | undefined;
  const second = pool.run(async (_browser, _context, signal) => {
    seen = signal;
    await new Promise((resolve) => setTimeout(resolve, 500));
    return 'fits';
  }, { budgetMs: 1_000 });
  await vi.advanceTimersByTimeAsync(5_000); // queued far longer than the budget
  gate.resolve(); await first;
  await vi.advanceTimersByTimeAsync(500);
  expect(await second).toBe('fits');
  expect(seen?.aborted).toBe(false);
  await pool.close();
});

it('aborts a task that overruns its budget and retires its browser', async () => {
  vi.useFakeTimers();
  const { pool, browsers } = setup();
  const overrun = pool.run(() => never(), { budgetMs: 1_000 });
  const rejected = expect(overrun).rejects.toMatchObject({ name: 'TimeoutError' });
  await vi.advanceTimersByTimeAsync(1_001);
  await rejected;
  expect(browsers[0]!.close).toHaveBeenCalledOnce();
  await pool.close();
});

it('bounds a hung context.close: retires the browser and serves the next task', async () => {
  vi.useFakeTimers();
  const { pool, launch, browsers } = setup({ cleanupMs: 1_000 });
  const first = pool.run(async (browser) => { vi.mocked(browsers[0]!.contexts[0]!.close).mockImplementation(never); return browser; });
  const second = pool.run(async () => 'next');
  await vi.advanceTimersByTimeAsync(1_001);
  await first;
  expect(browsers[0]!.close).toHaveBeenCalledOnce();
  expect(await second).toBe('next');
  expect(launch).toHaveBeenCalledTimes(2);
  await pool.close();
});

it('an abort during context cleanup still retires that task\'s browser', async () => {
  const { pool, browsers } = setup();
  const controller = new AbortController();
  const closing = deferred();
  const first = pool.run(async () => {
    vi.mocked(browsers[0]!.contexts[0]!.close).mockImplementation(() => closing.promise);
    return 'rendered';
  }, { signal: controller.signal });
  await vi.waitFor(() => expect(browsers[0]!.contexts[0]!.close).toHaveBeenCalled());
  controller.abort();
  await vi.waitFor(() => expect(browsers[0]!.close).toHaveBeenCalledOnce());
  closing.resolve();
  expect(await first).toBe('rendered');
  await pool.close();
});

it('kills only its own process group when browser.close hangs, then waits for exit before relaunching', async () => {
  vi.useFakeTimers();
  const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);
  const { pool, launch, browsers } = setup({ closeMs: 1_000, exitMs: 1_000 });
  const controller = new AbortController();
  const first = pool.run(() => never(), { signal: controller.signal });
  await vi.waitFor(() => expect(browsers[0]?.contexts).toHaveLength(1));
  const old = browsers[0]!;
  vi.mocked(old.close).mockImplementation(never);
  kill.mockImplementation(((pid: number) => { if (pid === -old.child.pid!) queueMicrotask(() => old.child.exit()); return true; }) as typeof process.kill);
  const next = pool.run(async () => 'next');
  const rejected = expect(first).rejects.toMatchObject({ name: 'AbortError' });
  controller.abort();
  await vi.advanceTimersByTimeAsync(999);
  expect(kill).not.toHaveBeenCalled();
  expect(launch).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(2);
  await rejected;
  expect(kill).toHaveBeenCalledWith(-old.child.pid!, 'SIGKILL');
  expect(kill).toHaveBeenCalledTimes(1);
  expect(await next).toBe('next');
  expect(launch).toHaveBeenCalledTimes(2);
  await pool.close();
});

it('treats a rejected browser.close like a hung one', async () => {
  const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);
  const { pool, browsers } = setup();
  const gate = deferred();
  const first = pool.run(async () => { await gate.promise; throw new Error('render'); });
  await vi.waitFor(() => expect(browsers[0]?.contexts).toHaveLength(1));
  const old = browsers[0]!;
  vi.mocked(old.close).mockRejectedValue(new Error('protocol'));
  kill.mockImplementation((() => { old.child.exit(); return true; }) as typeof process.kill);
  gate.resolve();
  await expect(first).rejects.toThrow('render');
  expect(kill).toHaveBeenCalledWith(-old.child.pid!, 'SIGKILL');
  await pool.close();
});

it('becomes unavailable while a killed browser has not exited, and recovers when it does', async () => {
  vi.useFakeTimers();
  const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const { pool, launch, browsers } = setup({ closeMs: 100, exitMs: 100 });
  const gate = deferred();
  const failed = pool.run(async () => { await gate.promise; throw new Error('render'); });
  await vi.waitFor(() => expect(browsers[0]?.contexts).toHaveLength(1));
  vi.mocked(browsers[0]!.close).mockImplementation(never);
  const rejected = expect(failed).rejects.toThrow('render');
  gate.resolve();
  await vi.advanceTimersByTimeAsync(201);
  await rejected;
  expect(kill).toHaveBeenCalledOnce();
  await expect(pool.run(async () => 'blocked')).rejects.toMatchObject({ name: 'PdfBrowserUnavailableError' });
  expect(launch).toHaveBeenCalledTimes(1);
  browsers[0]!.child.exit();
  await vi.advanceTimersByTimeAsync(0);
  expect(await pool.run(async () => 'recovered')).toBe('recovered');
  expect(launch).toHaveBeenCalledTimes(2);
  await pool.close();
});

it('a stale abort never touches a browser launched after its task finished', async () => {
  const { pool, browsers } = setup({ maxUses: 1 });
  const controller = new AbortController();
  await pool.run(async () => 'first', { signal: controller.signal });
  await pool.run(async () => 'second');
  expect(browsers).toHaveLength(2);
  controller.abort();
  await Promise.resolve();
  expect(browsers[1]!.close).not.toHaveBeenCalled();
  await pool.close();
});

it('never signals a process that already exited (pid reuse safety)', () => {
  const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);
  const child = fakeChild();
  child.exit();
  killBrowserProcessGroup(child);
  expect(kill).not.toHaveBeenCalled();
  expect(child.kill).not.toHaveBeenCalled();
});

it('falls back to the spawned process when it does not lead a process group', () => {
  vi.spyOn(process, 'kill').mockImplementation(() => { throw Object.assign(new Error('no group'), { code: 'ESRCH' }); });
  const child = fakeChild();
  killBrowserProcessGroup(child);
  expect(child.kill).toHaveBeenCalledWith('SIGKILL');
});

it('bounds context creation even when its promise ignores a closed browser', async () => {
  const first = fakeBrowser();
  const second = fakeBrowser();
  const entered = deferred();
  const creating = deferred<BrowserContext>();
  vi.mocked(first.createBrowserContext).mockImplementationOnce(() => { entered.resolve(); return creating.promise; });
  const launch = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second);
  const pool = new PdfBrowserPool(launch);
  const controller = new AbortController();
  const pending = pool.run(async () => 'old', { signal: controller.signal });
  const rejection = expect(pending).rejects.toMatchObject({ name: 'TimeoutError' });
  await entered.promise;
  controller.abort(new DOMException('expired', 'TimeoutError'));
  await rejection;
  expect(await pool.run(async () => 'new')).toBe('new');
  expect(second.close).not.toHaveBeenCalled();
  creating.resolve({ close: vi.fn() } as unknown as BrowserContext);
  await pool.close();
});

it('a task cancelled while the stale browser retires never launches a fresh Chromium', async () => {
  const { pool, launch, browsers } = setup({ maxUses: 1 });
  await pool.run(async () => 'first');
  const old = browsers[0]!;
  const closing = deferred();
  vi.mocked(old.close).mockImplementation(() => closing.promise.then(() => old.child.exit()));
  const controller = new AbortController();
  const task = vi.fn();
  const second = pool.run(task, { signal: controller.signal });
  await vi.waitFor(() => expect(old.close).toHaveBeenCalledOnce());
  controller.abort();
  closing.resolve();
  await expect(second).rejects.toMatchObject({ name: 'AbortError' });
  expect(launch).toHaveBeenCalledTimes(1);
  expect(task).not.toHaveBeenCalled();
  await pool.close();
  expect(browsers).toHaveLength(1);
});
