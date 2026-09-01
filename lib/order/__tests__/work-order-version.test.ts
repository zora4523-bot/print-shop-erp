import { describe, expect, it } from 'vitest';
import {
  isCurrentWorkOrderVersion,
  parseScannedWorkOrderVersion,
} from '../work-order-version';

describe('work order QR version guard', () => {
  it('accepts only a positive integer equal to the current paper version', () => {
    expect(parseScannedWorkOrderVersion('2')).toBe(2);
    expect(isCurrentWorkOrderVersion(2, 2)).toBe(true);
  });

  it('fails closed for an old, future, missing, duplicate-first-invalid or malformed version', () => {
    for (const raw of ['1', '3', undefined, '', '2.0', '-1']) {
      expect(
        isCurrentWorkOrderVersion(parseScannedWorkOrderVersion(raw), 2),
      ).toBe(false);
    }
    expect(parseScannedWorkOrderVersion(['bad', '2'])).toBeNull();
  });
});
