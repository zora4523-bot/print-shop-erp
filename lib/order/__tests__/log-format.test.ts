import { describe, it, expect } from 'vitest';
import {
  actionLabel,
  fieldLabel,
  formatLogValue,
  formatOrderLogChanges,
} from '../log-format';

describe('fieldLabel', () => {
  it('maps known field names to Chinese labels', () => {
    expect(fieldLabel('customerRef')).toBe('客户代号');
    expect(fieldLabel('isUrgent')).toBe('急单');
    expect(fieldLabel('status')).toBe('状态');
  });

  it('falls back to the raw field name for unknown keys', () => {
    expect(fieldLabel('mysteryField')).toBe('mysteryField');
  });
});

describe('formatLogValue', () => {
  it('renders booleans as 是 / 否', () => {
    expect(formatLogValue('isUrgent', true)).toBe('是');
    expect(formatLogValue('isUrgent', false)).toBe('否');
  });

  it('renders null / undefined / empty string as em-dash', () => {
    expect(formatLogValue('remark', null)).toBe('—');
    expect(formatLogValue('remark', undefined)).toBe('—');
    expect(formatLogValue('remark', '')).toBe('—');
  });

  it('translates status enum values to Chinese labels', () => {
    expect(formatLogValue('status', 'DRAFT')).toBe('草稿');
    expect(formatLogValue('status', 'IN_PRODUCTION')).toBe('生产中');
    expect(formatLogValue('status', 'CANCELLED')).toBe('已取消');
  });

  it('falls back to the raw string for unknown status values (forward-compat)', () => {
    // If a future OrderStatus variant is added but not yet labelled,
    // render the raw value rather than "—" so readers can still trace
    // what happened.
    expect(formatLogValue('status', 'NEW_STATE')).toBe('NEW_STATE');
  });

  it('stringifies unexpected object shapes', () => {
    expect(formatLogValue('remark', { weird: 1 })).toBe('{"weird":1}');
  });

  it('coerces numeric values through String()', () => {
    expect(formatLogValue('trackingNo', 12345)).toBe('12345');
  });
});

describe('formatOrderLogChanges', () => {
  it('returns a row per field with label + before / after', () => {
    const rows = formatOrderLogChanges({
      remark: { before: null, after: '新备注' },
      isUrgent: { before: false, after: true },
    });
    expect(rows).toHaveLength(2);
    const byField = Object.fromEntries(rows.map((r) => [r.field, r]));
    expect(byField.remark).toMatchObject({
      label: '工单备注',
      before: '—',
      after: '新备注',
    });
    expect(byField.isUrgent).toMatchObject({
      label: '急单',
      before: '否',
      after: '是',
    });
  });

  it('translates a status transition row', () => {
    const rows = formatOrderLogChanges({
      status: { before: 'DRAFT', after: 'SUBMITTED' },
    });
    expect(rows).toEqual([
      { field: 'status', label: '状态', before: '草稿', after: '已提交' },
    ]);
  });

  it('handles null / undefined changedFields by returning []', () => {
    expect(formatOrderLogChanges(null)).toEqual([]);
    expect(formatOrderLogChanges(undefined)).toEqual([]);
  });

  it('skips malformed entries instead of throwing', () => {
    // before/after both missing = not a real diff entry; skip.
    // An older schema may have stored a string or number instead of
    // the `{ before, after }` shape — we don't want that to crash the
    // detail page.
    const rows = formatOrderLogChanges({
      legacy: 'just a string',
      broken: null,
      good: { before: 'a', after: 'b' },
      empty: {},
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].field).toBe('good');
  });
});

describe('actionLabel', () => {
  it('maps the four known actions', () => {
    expect(actionLabel('CREATE')).toBe('创建');
    expect(actionLabel('UPDATE')).toBe('编辑');
    expect(actionLabel('STATUS_CHANGE')).toBe('状态变更');
    expect(actionLabel('DELETE')).toBe('删除');
  });

  it('falls back to the raw action for unknown values', () => {
    expect(actionLabel('EXPORT')).toBe('EXPORT');
  });
});
