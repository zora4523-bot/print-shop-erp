import { describe, expect, it } from 'vitest';
import { shouldProtectOrderFormLeave } from '../use-order-form-leave-guard';

describe('order form leave protection', () => {
  it('protects dirty forms and pending design files', () => {
    expect(
      shouldProtectOrderFormLeave({
        enabled: true,
        dirty: true,
        pendingFileCount: 0,
        submitted: false,
      }),
    ).toBe(true);
    expect(
      shouldProtectOrderFormLeave({
        enabled: true,
        dirty: false,
        pendingFileCount: 1,
        submitted: false,
      }),
    ).toBe(true);
  });

  it('does not protect clean, disabled or submitted forms', () => {
    expect(
      shouldProtectOrderFormLeave({
        enabled: true,
        dirty: false,
        pendingFileCount: 0,
        submitted: false,
      }),
    ).toBe(false);
    expect(
      shouldProtectOrderFormLeave({
        enabled: false,
        dirty: true,
        pendingFileCount: 2,
        submitted: false,
      }),
    ).toBe(false);
    expect(
      shouldProtectOrderFormLeave({
        enabled: true,
        dirty: true,
        pendingFileCount: 2,
        submitted: true,
      }),
    ).toBe(false);
  });
});

