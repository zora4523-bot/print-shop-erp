import { describe, expect, it } from 'vitest';
import { orderPdfMode } from '../mode.mjs';

describe('explicit production PDF mode', () => {
  it.each([undefined, '', 'typo'])('rejects missing or unknown production mode %s', (mode) => {
    expect(orderPdfMode({ NODE_ENV: 'production', PDF_ORDER_MODE: mode })).toBeNull();
  });
  it('defaults development to direct', () => expect(orderPdfMode({ NODE_ENV: 'development' })).toBe('direct'));
  it('requires durable for queued, never silently generates in Web', () => {
    expect(orderPdfMode({ PDF_ORDER_MODE: 'queued', BACKGROUND_JOBS_MODE: 'inline' })).toBeNull();
    expect(orderPdfMode({ NODE_ENV: 'production', PDF_ORDER_MODE: 'queued' })).toBe('queued');
    expect(orderPdfMode({ PDF_ORDER_MODE: 'queued', BACKGROUND_JOBS_MODE: 'durable' })).toBe('queued');
  });
});
