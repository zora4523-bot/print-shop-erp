import type { ChildProcess } from 'node:child_process';
import type { Browser, BrowserContext } from 'puppeteer';

export type PdfBrowserPoolOptions = {
  maxUses?: number;
  idleMs?: number;
  maxLifetimeMs?: number;
  maxPending?: number;
  /** Deadline for closing one task's BrowserContext before the browser is retired. */
  cleanupMs?: number;
  /** Deadline for a graceful `browser.close()` before its process group is killed. */
  closeMs?: number;
  /** Deadline for the killed process to report `exit`; afterwards the pool is unavailable. */
  exitMs?: number;
};

type Slot = { browser: Browser; born: number; uses: number };
type RunOptions = { signal?: AbortSignal; budgetMs?: number };

/**
 * Process-local, serial reuse. Every render gets a separate incognito context.
 * Cleanup is bounded: a browser that does not close in time has the process
 * group this pool launched killed, and no new browser starts until that exit
 * is confirmed. Abort handlers only ever retire the browser their task used.
 */
export class PdfBrowserPool {
  private current?: Slot;
  private readonly retirements = new Map<Browser, Promise<void>>();
  private tail: Promise<unknown> = Promise.resolve();
  private idle?: ReturnType<typeof setTimeout>;
  private pending = 0;
  private stopped = false;
  private unavailable = false;
  private readonly settings: Required<PdfBrowserPoolOptions>;

  constructor(private readonly launch: () => Promise<Browser>, options: PdfBrowserPoolOptions = {}) {
    this.settings = {
      maxUses: 50, idleMs: 60_000, maxLifetimeMs: 300_000, maxPending: 8,
      cleanupMs: 5_000, closeMs: 5_000, exitMs: 5_000, ...options,
    };
  }

  /** `budgetMs` starts when the task owns the slot, so queueing never consumes it. */
  run<T>(
    task: (browser: Browser, context: BrowserContext, signal: AbortSignal) => Promise<T>,
    options: RunOptions = {},
  ): Promise<T> {
    if (this.stopped || this.unavailable || this.pending >= this.settings.maxPending) {
      return Promise.reject(new PdfBrowserUnavailableError());
    }
    this.pending++;
    clearTimeout(this.idle);
    const queued = performance.now();
    const result = this.tail.then(() => this.execute(task, options, queued));
    this.tail = result.catch(() => undefined).finally(() => {
      this.pending--;
      if (!this.pending && !this.stopped) {
        this.idle = setTimeout(() => { if (!this.pending && this.current) void this.retire(this.current); }, this.settings.idleMs);
        this.idle.unref();
      }
    });
    return result;
  }

  /** Stops new work, lets admitted tasks finish or abort, then retires the browser. */
  async close() {
    this.stopped = true;
    clearTimeout(this.idle);
    await this.tail;
    if (this.current) await this.retire(this.current);
    await this.settled();
  }

  private async execute<T>(
    task: (browser: Browser, context: BrowserContext, signal: AbortSignal) => Promise<T>,
    { signal, budgetMs }: RunOptions,
    queued: number,
  ): Promise<T> {
    signal?.throwIfAborted();
    await this.settled();
    if (this.stopped || this.unavailable) throw new PdfBrowserUnavailableError();
    const budget = new AbortController();
    const budgetTimer = budgetMs
      ? setTimeout(() => budget.abort(new DOMException('PDF render budget exceeded', 'TimeoutError')), budgetMs)
      : undefined;
    const taskSignal = AbortSignal.any([...(signal ? [signal] : []), budget.signal]);
    try {
      return await this.executeOwned(task, taskSignal, queued);
    } finally {
      clearTimeout(budgetTimer);
    }
  }

  private async executeOwned<T>(
    task: (browser: Browser, context: BrowserContext, signal: AbortSignal) => Promise<T>,
    taskSignal: AbortSignal,
    queued: number,
  ): Promise<T> {
    taskSignal.throwIfAborted();
    const { maxUses, maxLifetimeMs } = this.settings;
    const stale = this.current;
    if (stale && (!stale.browser.connected || stale.uses >= maxUses || Date.now() - stale.born >= maxLifetimeMs)) {
      await this.retire(stale);
      if (this.unavailable) throw new PdfBrowserUnavailableError();
      // Retirement can take seconds; a task cancelled meanwhile must not launch Chromium.
      taskSignal.throwIfAborted();
    }
    const start = performance.now();
    if (!this.current) {
      let browser: Browser;
      try { browser = await this.launch(); }
      catch { throw new PdfBrowserUnavailableError(); }
      this.current = { browser, born: Date.now(), uses: 0 };
    }
    const owned = this.current;
    let context: BrowserContext | undefined;
    // Registered until cleanup ends: an abort while closing the context still
    // retires this task's browser, and never a browser launched afterwards.
    const abort = () => { void this.retire(owned); };
    taskSignal.addEventListener('abort', abort, { once: true });
    try {
      taskSignal.throwIfAborted();
      context = await untilAborted(owned.browser.createBrowserContext(), taskSignal);
      taskSignal.throwIfAborted();
      const rendered = performance.now();
      // The slot is released on abort even if the task ignores its signal.
      const value = await untilAborted(Promise.resolve(task(owned.browser, context, taskSignal)), taskSignal);
      owned.uses++;
      console.info('[pdf-render]', JSON.stringify({ queueMs: Math.round(start - queued), browserMs: Math.round(rendered - start), renderMs: Math.round(performance.now() - rendered), reused: owned.uses > 1, workerRssBytes: process.memoryUsage().rss }));
      return value;
    } catch (error) {
      await this.retire(owned);
      throw error;
    } finally {
      if (context && this.current === owned) {
        const closed = await withDeadline(context.close().then(() => true, () => false), this.settings.cleanupMs, false);
        if (!closed) await this.retire(owned);
      }
      taskSignal.removeEventListener('abort', abort);
    }
  }

  private retire(slot: Slot): Promise<void> {
    if (this.current === slot) this.current = undefined;
    const existing = this.retirements.get(slot.browser);
    if (existing) return existing;
    const retirement = this.terminate(slot.browser).then((exited) => {
      if (!exited) this.markUnavailable(slot.browser.process());
    }).finally(() => { this.retirements.delete(slot.browser); });
    this.retirements.set(slot.browser, retirement);
    return retirement;
  }

  private async settled() {
    while (this.retirements.size) await Promise.all(this.retirements.values());
  }

  /** Resolves true once the browser this pool launched is known to have exited. */
  private async terminate(browser: Browser): Promise<boolean> {
    const child = browser.process();
    const exited = child ? processExit(child) : undefined;
    const graceful = await withDeadline(browser.close().then(() => true, () => false), this.settings.closeMs, false);
    if (!child || !exited) return graceful;
    if (hasExited(child)) return true;
    try { killBrowserProcessGroup(child); } catch { return false; }
    return withDeadline(exited.then(() => true), this.settings.exitMs, false);
  }

  private markUnavailable(child: ChildProcess | null) {
    this.unavailable = true;
    console.error('[pdf-render] PDF_BROWSER_EXIT_UNCONFIRMED');
    // Recovery follows the process, not a request: new browsers start only
    // after the old one has actually gone.
    if (child) void processExit(child).then(() => { this.unavailable = false; });
  }
}

/**
 * Kills only the Chromium this pool launched. Puppeteer spawns it detached, so
 * its pid is also its process-group id; group kill takes renderer/GPU helpers
 * with it. An exited child is never signalled, so a recycled pid is never hit.
 */
export function killBrowserProcessGroup(child: ChildProcess) {
  if (child.pid === undefined || hasExited(child)) return;
  if (process.platform !== 'win32') {
    try { process.kill(-child.pid, 'SIGKILL'); return; }
    catch { /* not a group leader: fall back to the single process we spawned */ }
  }
  child.kill('SIGKILL');
}

function hasExited(child: ChildProcess) {
  return child.exitCode !== null || child.signalCode !== null;
}

function processExit(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (hasExited(child)) resolve();
    else child.once('exit', () => resolve());
  });
}

function untilAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  work.catch(() => undefined); // an abandoned task may still reject later
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

function withDeadline<T>(work: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<T>((resolve) => { timer = setTimeout(() => resolve(fallback), ms); });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}

export class PdfBrowserUnavailableError extends Error {
  constructor() { super('PDF browser unavailable'); this.name = 'PdfBrowserUnavailableError'; }
}
