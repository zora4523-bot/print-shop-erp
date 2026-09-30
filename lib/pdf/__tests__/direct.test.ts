import { afterEach, expect, it, vi } from 'vitest';
import { PdfRequestCache, waitForPdf } from '../direct';

afterEach(() => vi.useRealTimers());

it('coalesces repeated requests, including regenerate, and reuses completed bytes', async () => {
  const cache = new PdfRequestCache();
  let finish!: (bytes: Buffer) => void;
  const generate = vi.fn(() => new Promise<Buffer>((resolve) => { finish = resolve; }));
  const first = cache.get('actor+snapshot', generate);
  const repeat = cache.get('actor+snapshot', generate, true);
  await Promise.resolve();
  finish(Buffer.from('PDF'));
  expect(await first).toEqual(await repeat);
  expect(await cache.get('actor+snapshot', generate)).toEqual(Buffer.from('PDF'));
  expect(generate).toHaveBeenCalledOnce();
});

it('does not reuse failed work and isolates distinct actors/content keys', async () => {
  const cache = new PdfRequestCache();
  await expect(cache.get('a', async () => { throw new Error('failed'); })).rejects.toThrow('failed');
  expect(await cache.get('a', async () => Buffer.from('fixed'))).toEqual(Buffer.from('fixed'));
  expect(await cache.get('b', async () => Buffer.from('other'))).toEqual(Buffer.from('other'));
  expect(await cache.get('a', async () => Buffer.from('fresh'), true)).toEqual(Buffer.from('fresh'));
});

it('expires cached bytes and bounds cached memory, including oversized artifacts', async () => {
  vi.useFakeTimers();
  const cache = new PdfRequestCache(4, 100);
  const generate = vi.fn(async () => Buffer.from('123'));
  await cache.get('a', generate);
  await cache.get('b', generate); // evicts a to stay within four bytes
  await cache.get('a', generate);
  expect(generate).toHaveBeenCalledTimes(3);
  await vi.advanceTimersByTimeAsync(101);
  await cache.get('a', generate);
  expect(generate).toHaveBeenCalledTimes(4);
  const oversized = vi.fn(async () => Buffer.alloc(5));
  await cache.get('large', oversized);
  await cache.get('large', oversized);
  expect(oversized).toHaveBeenCalledTimes(2);
});

it('refuses excess distinct renders but still joins an admitted request', async () => {
  const cache = new PdfRequestCache();
  let finish!: (bytes: Buffer) => void;
  const work = new Promise<Buffer>((resolve) => { finish = resolve; });
  const admitted = Array.from({ length: 4 }, (_, id) => cache.get(String(id), () => work));
  await expect(cache.get('overflow', () => work)).rejects.toMatchObject({ name: 'PdfBusyError' });
  const repeat = cache.get('0', () => work);
  finish(Buffer.from('done'));
  expect(await repeat).toEqual(Buffer.from('done'));
  await Promise.all(admitted);
});

it('aborts one caller promptly without cancelling a shared request or another caller', async () => {
  let finish!: (bytes: Buffer) => void;
  const work = new Promise<Buffer>((resolve) => { finish = resolve; });
  const controller = new AbortController();
  const first = waitForPdf(work, controller.signal);
  const other = waitForPdf(work, new AbortController().signal);
  controller.abort();
  await expect(first).rejects.toMatchObject({ name: 'AbortError' });
  finish(Buffer.from('done'));
  expect(await other).toEqual(Buffer.from('done'));
});

it('shares an incomplete result only while pending, never caching the warning PDF', async () => {
  const cache = new PdfRequestCache();
  const generate = vi.fn(async () => Buffer.from('warning PDF'));
  const first = cache.get('artwork', generate, false, () => false);
  expect(cache.get('artwork', generate)).toBe(first);
  await first;
  await cache.get('artwork', generate);
  expect(generate).toHaveBeenCalledTimes(2);
});
