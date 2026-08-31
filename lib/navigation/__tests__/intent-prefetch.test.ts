import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  INTENT_PREFETCH_DELAY_MS,
  IntentPrefetchScheduler,
} from '../intent-prefetch';

describe('IntentPrefetchScheduler', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('requires sustained intent before enabling a prefetch', () => {
    vi.useFakeTimers();
    const onReady = vi.fn();
    const scheduler = new IntentPrefetchScheduler(onReady);
    const target = { href: '/orders', pathname: '/owner' };

    scheduler.schedule(target);
    vi.advanceTimersByTime(INTENT_PREFETCH_DELAY_MS - 1);
    expect(onReady).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onReady).toHaveBeenCalledOnce();
    expect(onReady).toHaveBeenCalledWith(target);
  });

  it('cancels, replaces, and disposes pending pointer intent', () => {
    vi.useFakeTimers();
    const onReady = vi.fn();
    const scheduler = new IntentPrefetchScheduler(onReady);

    scheduler.schedule({ href: '/orders', pathname: '/owner' });
    scheduler.cancel();
    vi.runAllTimers();
    expect(onReady).not.toHaveBeenCalled();

    scheduler.schedule({ href: '/orders', pathname: '/owner' });
    scheduler.schedule({ href: '/owner/settings', pathname: '/owner' });
    vi.runAllTimers();
    expect(onReady).toHaveBeenCalledOnce();
    expect(onReady).toHaveBeenLastCalledWith({
      href: '/owner/settings',
      pathname: '/owner',
    });

    scheduler.schedule({ href: '/owner/warehouses', pathname: '/owner' });
    scheduler.dispose();
    vi.runAllTimers();
    expect(onReady).toHaveBeenCalledOnce();
  });
});
