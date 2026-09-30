import { createHash } from 'node:crypto';
import { PdfBrowserPool } from './browser-pool';
import { renderHtmlToPdf } from './render';

const CACHE_TTL_MS = 5 * 60_000;
const CACHE_BYTES = 32 * 1024 * 1024;

/** Per Web process, bounded and private. Callers must recheck access/content before serving. */
export class PdfRequestCache {
  private readonly completed = new Map<string, { bytes: Buffer; expires: number }>();
  private readonly pending = new Map<string, Promise<Buffer>>();
  private size = 0;

  constructor(private readonly capacity = CACHE_BYTES, private readonly ttl = CACHE_TTL_MS) {}

  get(key: string, generate: () => Promise<Buffer>, regenerate = false): Promise<Buffer> {
    // Regeneration also joins existing work; repeated clicks cannot start duplicate browsers.
    const existing = this.pending.get(key);
    if (existing) return existing;
    for (const [id, value] of this.completed) if (value.expires <= Date.now()) this.remove(id);
    const cached = this.completed.get(key);
    if (cached && !regenerate) return Promise.resolve(cached.bytes);
    if (this.pending.size >= 4) return Promise.reject(new PdfBusyError());
    if (regenerate) this.remove(key);
    const result = Promise.resolve().then(generate).then((bytes) => {
      if (bytes.byteLength <= this.capacity) {
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

const cache = new PdfRequestCache();
const pool = new PdfBrowserPool(async () => {
  const { default: puppeteer } = await import('puppeteer');
  return puppeteer.launch({ headless: true, timeout: 20_000, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
});

export function renderDirectOrderPdf(input: {
  orderId: string; actorId: string; actorRole: string; snapshotKey: string; baseUrl: string;
  html: () => Promise<string>; signal: AbortSignal; regenerate: boolean;
}): Promise<Buffer> {
  input.signal.throwIfAborted();
  const key = createHash('sha256').update(JSON.stringify([
    input.orderId, input.actorId, input.actorRole, input.snapshotKey, input.baseUrl,
  ])).digest('hex');
  const result = cache.get(key, async () => {
    const signal = AbortSignal.timeout(45_000);
    return waitForPdf(pool.run(async (browser, context) => {
      const html = await input.html();
      signal.throwIfAborted();
      return renderHtmlToPdf({ html, browser, context, signal });
    }, signal), signal);
  }, input.regenerate);
  return waitForPdf(result, input.signal);
}

export class PdfBusyError extends Error {
  constructor() { super('PDF capacity reached'); this.name = 'PdfBusyError'; }
}
