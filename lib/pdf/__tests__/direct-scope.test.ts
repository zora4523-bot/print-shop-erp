import { afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ run: vi.fn(), render: vi.fn() }));
vi.mock('../browser-pool', () => ({ PdfBrowserPool: class { run = mocks.run; }, PdfBrowserUnavailableError: class extends Error {} }));
vi.mock('../render', () => ({ renderHtmlToPdf: mocks.render }));
import { closePdfPoolOnShutdown, renderDirectOrderPdf } from '../direct';

afterEach(() => vi.restoreAllMocks());

it('binds actual cached bytes to actor, role, full content and base URL', async () => {
  mocks.run.mockImplementation((task) => task({}, {}, new AbortController().signal));
  mocks.render.mockImplementation(async () => Buffer.from(`pdf-${mocks.render.mock.calls.length}`));
  const input = { orderId: 'scope-order', actorId: 'a', actorRole: 'ADMIN', snapshotKey: 'v1', baseUrl: 'https://erp.test', html: async () => '<html/>', signal: new AbortController().signal, regenerate: false };
  const initial = await renderDirectOrderPdf(input);
  expect(await renderDirectOrderPdf(input)).toEqual(initial);
  for (const change of [{ actorId: 'b' }, { actorRole: 'OWNER' }, { snapshotKey: 'v2' }, { baseUrl: 'https://other.test' }]) {
    expect(await renderDirectOrderPdf({ ...input, ...change })).not.toEqual(initial);
  }
  expect(mocks.render).toHaveBeenCalledTimes(5);
});

it('bounds waiting and does not cache an expired render', async () => {
  const controller = new AbortController();
  vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
  let finish!: (bytes: Buffer) => void;
  mocks.run.mockImplementationOnce(() => new Promise<Buffer>((resolve) => { finish = resolve; }));
  const input = { orderId: 'timeout-order', actorId: 'a', actorRole: 'ADMIN', snapshotKey: 'v1', baseUrl: 'https://erp.test', html: async () => '<html/>', signal: new AbortController().signal, regenerate: false };
  const pending = renderDirectOrderPdf(input);
  await Promise.resolve();
  controller.abort(new DOMException('expired', 'TimeoutError'));
  await expect(pending).rejects.toMatchObject({ name: 'TimeoutError' });
  finish(Buffer.from('late-pdf'));
  await Promise.resolve();
  vi.mocked(AbortSignal.timeout).mockReturnValue(new AbortController().signal);
  mocks.run.mockResolvedValueOnce(Buffer.from('fresh-pdf'));
  expect(await renderDirectOrderPdf(input)).toEqual(Buffer.from('fresh-pdf'));
});

describe('closePdfPoolOnShutdown', () => {
  function fakeProcess(otherListeners: number) {
    const handlers = new Map<string, () => void>();
    const proc = {
      pid: 4242,
      once: vi.fn((signal: string, handler: () => void) => { handlers.set(signal, handler); return proc; }),
      listenerCount: vi.fn(() => otherListeners),
      kill: vi.fn(() => true),
    };
    return { proc: proc as unknown as Parameters<typeof closePdfPoolOnShutdown>[3], handlers, kill: proc.kill };
  }
  afterEach(() => vi.useRealTimers());

  it('lets in-flight renders finish within the grace, then aborts them before PM2 kill_timeout', async () => {
    vi.useFakeTimers();
    let release!: () => void;
    const close = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    const shutdown = new AbortController();
    const { proc, handlers, kill } = fakeProcess(1);
    closePdfPoolOnShutdown({ close }, 15_000, shutdown, proc);
    handlers.get('SIGTERM')!();
    expect(close).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(14_999);
    expect(shutdown.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(shutdown.signal.aborted).toBe(true);
    expect(shutdown.signal.reason).toBeInstanceOf(Error);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(kill).not.toHaveBeenCalled(); // Next owns the exit when it listens too
  });

  it('does not abort when the pool drains in time, and re-raises when it is the only listener', async () => {
    vi.useFakeTimers();
    const shutdown = new AbortController();
    const { proc, handlers, kill } = fakeProcess(0);
    closePdfPoolOnShutdown({ close: async () => undefined }, 15_000, shutdown, proc);
    handlers.get('SIGINT')!();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(shutdown.signal.aborted).toBe(false);
    expect(kill).toHaveBeenCalledWith(4242, 'SIGINT');
  });
});

it('does not retain a rendered PDF whose artwork callback reports a load failure', async () => {
  mocks.run.mockImplementation((task) => task({}, {}, new AbortController().signal));
  let sequence = 0;
  mocks.render.mockImplementation(async (options) => {
    options.onArtworkUnavailable();
    return Buffer.from(`warning-${++sequence}`);
  });
  const input = { orderId: 'warning-order', actorId: 'a', actorRole: 'ADMIN', snapshotKey: 'v1', baseUrl: 'https://erp.test', html: async () => '<html/>', signal: new AbortController().signal, regenerate: false };
  expect(await renderDirectOrderPdf(input)).toEqual(Buffer.from('warning-1'));
  expect(await renderDirectOrderPdf(input)).toEqual(Buffer.from('warning-2'));
});
