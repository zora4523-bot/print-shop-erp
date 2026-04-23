// Pure classifier for the print-view design grid. Kept separate from the
// React component so it can be unit-tested without pulling in JSX / DOM.
//
// Rules lifted verbatim from SPEC-v1.2 附录 E.2.1 — bucketing is by
// count, and each bucket maps to a CSS modifier class that locks in a
// fixed single-image size (60mm, 45mm, 35mm, 28mm, 25mm, 22mm).

export type DesignGridClass =
  | 'count-1'
  | 'count-2'
  | 'count-3-4'
  | 'count-5-6'
  | 'count-7-9'
  | 'count-many';

export function pickDesignGridClass(count: number): DesignGridClass {
  if (!Number.isFinite(count) || count < 1) {
    // 0 / negative / NaN — caller should handle the empty case before
    // invoking this; default to 'count-1' so a single-cell fallback
    // renders instead of throwing and breaking the whole print view.
    return 'count-1';
  }
  if (count === 1) return 'count-1';
  if (count === 2) return 'count-2';
  if (count <= 4) return 'count-3-4';
  if (count <= 6) return 'count-5-6';
  if (count <= 9) return 'count-7-9';
  return 'count-many';
}

// 10+ designs is legible but very small — SPEC E.2.1 asks us to surface
// a "split this order for clarity" warning in the print view. This stays
// advisory, not a hard block.
export const DESIGN_GRID_WARN_THRESHOLD = 10;
