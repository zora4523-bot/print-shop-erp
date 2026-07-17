import { describe, expect, it } from 'vitest';
import { backgroundJobErrorCode, retryDelayMs } from '../policy';

describe('background job retry policy', () => {
  it('uses bounded exponential backoff', () => {
    expect(retryDelayMs(1)).toBe(30_000);
    expect(retryDelayMs(2)).toBe(60_000);
    expect(retryDelayMs(3)).toBe(120_000);
    expect(retryDelayMs(99)).toBe(30 * 60_000);
  });

  it('normalizes invalid attempts to the first delay', () => {
    expect(retryDelayMs(0)).toBe(30_000);
    expect(retryDelayMs(Number.NaN)).toBe(30_000);
  });

  it('stores only an error code, never the error message', () => {
    const error = new Error('customer phone 13800000000');
    error.name = 'Webhook Timeout/Error';
    expect(backgroundJobErrorCode(error)).toBe('Webhook_Timeout_Error');
    expect(backgroundJobErrorCode(error)).not.toContain('13800000000');
    expect(backgroundJobErrorCode('raw secret')).toBe('UnknownError');
  });
});
