import { expect, it } from 'vitest';
import { paperDisplayLabel } from '../paper-label';

// Display-only: persisted catalog facts keep '珠光闪红'; every render site must
// go through this so the create form, order detail, print view, export and
// worker task pages agree on the current name.
it('renames 珠光闪红 for display and leaves other papers untouched', () => {
  expect(paperDisplayLabel('160g珠光闪红')).toBe('160g珠光暗红');
  expect(paperDisplayLabel('珠光闪红')).toBe('珠光暗红');
  expect(paperDisplayLabel('160g珠光艳闪')).toBe('160g珠光艳闪');
  expect(paperDisplayLabel('珠光暗红')).toBe('珠光暗红');
});
