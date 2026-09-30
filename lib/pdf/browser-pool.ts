import type { Browser, BrowserContext } from 'puppeteer';

/** Process-local, serial reuse. Every render gets a separate incognito context. */
export class PdfBrowserPool {
  private browser?: Browser;
  private disposing?: Promise<void>;
  private tail: Promise<unknown> = Promise.resolve();
  private idle?: ReturnType<typeof setTimeout>;
  private uses = 0;
  private born = 0;
  private stopped = false;
  private pending = 0;

  constructor(private readonly launch: () => Promise<Browser>, private readonly maxUses = 50, private readonly idleMs = 60_000) {}

  run<T>(task: (browser: Browser, context: BrowserContext) => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (this.stopped || this.pending >= 8) return Promise.reject(new PdfBrowserUnavailableError());
    this.pending++;
    clearTimeout(this.idle);
    const queued = performance.now();
    const result = this.tail.then(async () => {
      signal?.throwIfAborted();
      await this.disposing;
      signal?.throwIfAborted();
      if (this.browser && (!this.browser.connected || this.uses >= this.maxUses || Date.now() - this.born >= 300_000)) await this.dispose();
      const start = performance.now();
      if (!this.browser) {
        try { this.browser = await this.launch(); }
        catch { throw new PdfBrowserUnavailableError(); }
        this.born = Date.now();
      }
      const browser = this.browser;
      let context: BrowserContext | undefined;
      const abort = () => { void this.dispose(); };
      signal?.addEventListener('abort', abort, { once: true });
      try {
        signal?.throwIfAborted();
        context = await browser.createBrowserContext();
        signal?.throwIfAborted();
        const rendered = performance.now();
        const value = await task(browser, context);
        this.uses++;
        console.info('[pdf-render]', JSON.stringify({ queueMs: Math.round(start - queued), browserMs: Math.round(rendered - start), renderMs: Math.round(performance.now() - rendered), reused: this.uses > 1, workerRssBytes: process.memoryUsage().rss }));
        return value;
      } catch (error) {
        await this.dispose();
        throw error;
      } finally {
        signal?.removeEventListener('abort', abort);
        if (context) await context.close().catch(() => this.dispose());
      }
    });
    this.tail = result.catch(() => undefined).finally(() => {
      this.pending--;
      if (!this.pending && !this.stopped) {
        this.idle = setTimeout(() => { void this.dispose(); }, this.idleMs);
        this.idle.unref();
      }
    });
    return result;
  }

  async close() {
    this.stopped = true;
    clearTimeout(this.idle);
    await this.tail;
    await this.dispose();
  }

  private async dispose() {
    const browser = this.browser;
    this.browser = undefined;
    this.uses = 0;
    if (!browser) { await this.disposing; return; }
    const closing = browser.close().catch(() => undefined);
    this.disposing = closing;
    try { await closing; }
    finally { if (this.disposing === closing) this.disposing = undefined; }
  }
}
class PdfBrowserUnavailableError extends Error {
  constructor() { super('PDF browser unavailable'); this.name = 'PdfBrowserUnavailableError'; }
}
