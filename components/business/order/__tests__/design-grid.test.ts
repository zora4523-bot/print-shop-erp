import { describe, it, expect } from 'vitest';
import {
  DESIGN_GRID_WARN_THRESHOLD,
  pickDesignGridClass,
} from '../design-grid';

describe('pickDesignGridClass (SPEC 附录 E.2.1)', () => {
  it('maps each documented bucket to the right class', () => {
    expect(pickDesignGridClass(1)).toBe('count-1');
    expect(pickDesignGridClass(2)).toBe('count-2');
    expect(pickDesignGridClass(3)).toBe('count-3-4');
    expect(pickDesignGridClass(4)).toBe('count-3-4');
    expect(pickDesignGridClass(5)).toBe('count-5-6');
    expect(pickDesignGridClass(6)).toBe('count-5-6');
    expect(pickDesignGridClass(7)).toBe('count-7-9');
    expect(pickDesignGridClass(9)).toBe('count-7-9');
    expect(pickDesignGridClass(10)).toBe('count-many');
    expect(pickDesignGridClass(25)).toBe('count-many');
  });

  it('falls back to count-1 for non-positive / non-finite inputs', () => {
    // Callers are expected to branch on the empty case before this, but
    // we return a safe default so a corrupted join doesn't explode the
    // print-view render.
    expect(pickDesignGridClass(0)).toBe('count-1');
    expect(pickDesignGridClass(-3)).toBe('count-1');
    expect(pickDesignGridClass(Number.NaN)).toBe('count-1');
    expect(pickDesignGridClass(Number.POSITIVE_INFINITY)).toBe('count-1');
  });

  it('warn threshold sits at 10 (matches SPEC E.2.1 advisory copy)', () => {
    // The >=10 bucket is both the "count-many" class AND where the
    // print view shows the "设计图较多，建议分款式打印" banner. Pin
    // the threshold to the same number so the two stay in lockstep.
    expect(DESIGN_GRID_WARN_THRESHOLD).toBe(10);
    expect(pickDesignGridClass(DESIGN_GRID_WARN_THRESHOLD)).toBe('count-many');
    expect(pickDesignGridClass(DESIGN_GRID_WARN_THRESHOLD - 1)).not.toBe('count-many');
  });
});
