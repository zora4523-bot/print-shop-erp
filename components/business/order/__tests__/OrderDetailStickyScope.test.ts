import { describe, expect, it } from 'vitest';
import { orderDetailTimelineTop } from '../OrderDetailStickyScope';

describe('order detail sticky offsets', () => {
  it('places the timeline below the measured local header and admin header', () => {
    expect(orderDetailTimelineTop(73)).toBe(
      'calc(var(--admin-header-offset) + 73px + 16px)',
    );
  });

  it('does not allow a negative measured height to pull content under headers', () => {
    expect(orderDetailTimelineTop(-10)).toBe(
      'calc(var(--admin-header-offset) + 0px + 16px)',
    );
  });
});
