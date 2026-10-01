import { createHash } from 'node:crypto';
import { PdfBrowserPool, PdfBrowserUnavailableError } from './browser-pool';
import { PDF_DIRECT_BUDGET_MS, pdfLaunchOptions } from './launch-options';
import { renderHtmlToPdf } from './render';

const CACHE_TTL_MS = 5 * 60_000;
const CACHE_BYTES = 32 * 1024 * 1024;

/** Per Web process, bounded and private. Callers must recheck access/content before serving. */
export class PdfRequestCache {
  private readonly completed = new Map<string, { bytes: Buffer; expires: number }>();
  private readonly pending = new Map<string, Promise<Buffer>>();
  private size = 0;

  constructor(private readonly capacity = CACHE_BYTES, private readonly ttl = CACHE_TTL_MS) {}

  get(key: string, generate: () => Promise<Buffer>, regenerate = false, shouldCache: () => boolean = () => true): Promise<Buffer> {
    // Regeneration also joins existing work; repeated clicks cannot start duplicate browsers.
    const existing = this.pending.get(key);
    if (existing) return existing;
    for (const [id, value] of this.completed) if (value.expires <= Date.now()) this.remove(id);
    const cached = this.completed.get(key);
    if (cached && !regenerate) return Promise.resolve(cached.bytes);
    if (this.pending.size >= 4) return Promise.reject(new PdfBusyError());
    if (regenerate) this.remove(key);
    const result = Promise.resolve().then(generate).then((bytes) => {
      if (shouldCache() && bytes.byteLength <= this.capacity) {
        while (this.completed.size >= 16 || this.size + bytes.byteLength > this.capacity) {
          this.remove(this.completed.keys().next().value!);
        }
        this.completed.set(key, { bytes, expires: Date.now() + this.ttl });
        this.size += bytes.byteLength;
      }
      return bytes;
    }).finally(() => { this.pending.delete(key); });
    this.pending.set(key, result);
    return result;
  }

  private remove(key: string) {
    const value = this.completed.get(key);
    if (value) { this.size -= value.bytes.byteLength; this.completed.delete(key); }
  }
}

/** Disconnecting one subscriber must not cancel another subscriber's render. */
export function waitForPdf(result: Promise<Buffer>, signal: AbortSignal): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    result.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

/**
 * PM2 gives the Web process `kill_timeout` (30 s) after SIGINT before SIGKILL,
 * which would skip Puppeteer's exit-time kill and orphan Chromium. In-flight
 * renders get this grace, then are aborted so their requests answer, Next's
 * graceful shutdown completes and the process exits normally.
 */
const PDF_WEB_SHUTDOWN_GRACE_MS = 15_000;

type ShutdownProcess = Pick<NodeJS.Process, 'once' | 'listenerCount' | 'kill' | 'pid'>;

/** On SIGINT/SIGTERM: stop the pool and, after `graceMs`, abort renders still running. */
export function closePdfPoolOnShutdown(
  target: Pick<PdfBrowserPool, 'close'>, graceMs: number, shutdown: AbortController, proc: ShutdownProcess = process,
) {
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    proc.once(signal, () => {
      // Nobody else listening (not under Next): re-raise once drained so the
      // default termination still happens.
      const alone = proc.listenerCount(signal) === 0;
      const timer = setTimeout(() => shutdown.abort(new PdfBrowserUnavailableError()), graceMs);
      timer.unref();
      void target.close().catch(() => {
        shutdown.abort(new PdfBrowserUnavailableError());
        console.error('[pdf-render] PDF_SHUTDOWN_CLEANUP_FAILED');
      }).finally(() => {
        clearTimeout(timer);
        if (alone) proc.kill(proc.pid, signal);
      });
    });
  }
}

const cache = new PdfRequestCache();
const shutdown = new AbortController();
let shutdownHooked = false;
const pool = new PdfBrowserPool(async () => {
  // Hook signals only once this process really owns a Chromium.
  if (!shutdownHooked) { shutdownHooked = true; closePdfPoolOnShutdown(pool, PDF_WEB_SHUTDOWN_GRACE_MS, shutdown); }
  const { default: puppeteer } = await import('puppeteer');
  return puppeteer.launch(pdfLaunchOptions());
});

export function renderDirectOrderPdf(input: {
  orderId: string; actorId: string; actorRole: string; snapshotKey: string; baseUrl: string;
  html: () => Promise<string>; signal: AbortSignal; regenerate: boolean;
}): Promise<Buffer> {
  input.signal.throwIfAborted();
  const key = createHash('sha256').update(JSON.stringify([
    input.orderId, input.actorId, input.actorRole, input.snapshotKey, input.baseUrl,
  ])).digest('hex');
  let completeArtwork = true;
  const result = cache.get(key, async () => {
    const signal = AbortSignal.any([AbortSignal.timeout(PDF_DIRECT_BUDGET_MS), shutdown.signal]);
    return waitForPdf(pool.run(async (browser, context, taskSignal) => {
      const html = await input.html();
      taskSignal.throwIfAborted();
      return renderHtmlToPdf({ html, browser, context, signal: taskSignal,
        onArtworkUnavailable: () => { completeArtwork = false; },
      });
    }, { signal }), signal);
  }, input.regenerate, () => completeArtwork);
  return waitForPdf(result, input.signal);
}

class PdfBusyError extends Error {
  constructor() { super('PDF capacity reached'); this.name = 'PdfBusyError'; }
}
