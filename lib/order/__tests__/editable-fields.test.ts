import { describe, it, expect } from 'vitest';
import { OrderStatus } from '../../../generated/prisma/enums';
import {
  FULL_EDITABLE_FIELDS,
  SHIPPING_EDITABLE_FIELDS,
  editableFieldsetForStatus,
  editableFieldsForStatus,
  isOrderEditable,
  canEditOrderSfCollect,
} from '../editable-fields';

describe('editableFieldsetForStatus (SPEC §3.6)', () => {
  it('FULL for DRAFT and SUBMITTED', () => {
    expect(editableFieldsetForStatus(OrderStatus.DRAFT)).toBe('FULL');
    expect(editableFieldsetForStatus(OrderStatus.SUBMITTED)).toBe('FULL');
  });

  it('SHIPPING_ONLY for SCHEDULING and IN_PRODUCTION', () => {
    expect(editableFieldsetForStatus(OrderStatus.SCHEDULING)).toBe('SHIPPING_ONLY');
    expect(editableFieldsetForStatus(OrderStatus.IN_PRODUCTION)).toBe('SHIPPING_ONLY');
  });

  it('NONE for every terminal or post-production status', () => {
    for (const s of [
      OrderStatus.COMPLETED,
      OrderStatus.SHIPPED,
      OrderStatus.FINISHED,
      OrderStatus.CANCELLED,
    ]) {
      expect(editableFieldsetForStatus(s), `status=${s}`).toBe('NONE');
    }
  });

  it('covers every OrderStatus variant (exhaustiveness guard)', () => {
    // If a new OrderStatus is added to the schema, TypeScript will
    // catch it at compile time in editableFieldsetForStatus's switch.
    // This test pins the runtime expectation: every enum value maps
    // to one of the three buckets, no undefined fallthrough.
    for (const s of Object.values(OrderStatus)) {
      const set = editableFieldsetForStatus(s);
      expect(['FULL', 'SHIPPING_ONLY', 'NONE']).toContain(set);
    }
  });
});

describe('editable-field lists (SPEC §3.6 — 仅改收货信息/备注)', () => {
  it('SHIPPING_EDITABLE_FIELDS is a subset of FULL_EDITABLE_FIELDS', () => {
    // The shipping-only subset must never contain a field the full set
    // doesn't, otherwise a status-specific edit could touch something
    // we don't otherwise allow (e.g. customerRef once production has
    // started).
    for (const f of SHIPPING_EDITABLE_FIELDS) {
      expect(FULL_EDITABLE_FIELDS as readonly string[]).toContain(f);
    }
  });

  it('excludes customerRef and isUrgent from the shipping subset', () => {
    // These two are the discriminators between the two sets; if they
    // leak into SHIPPING_ONLY, schedulers / operators can change a
    // customer code or flip urgent mid-production, which SPEC §3.6
    // explicitly forbids.
    expect(SHIPPING_EDITABLE_FIELDS as readonly string[]).not.toContain('customerRef');
    expect(SHIPPING_EDITABLE_FIELDS as readonly string[]).not.toContain('customName');
    expect(SHIPPING_EDITABLE_FIELDS as readonly string[]).not.toContain('isUrgent');
  });

  it('allows the custom name while a draft is fully editable', () => {
    expect(FULL_EDITABLE_FIELDS as readonly string[]).toContain('customName');
  });

  it('keeps 顺丰到付 out of generic fieldsets so its dedicated command can recalculate charges', () => {
    expect(FULL_EDITABLE_FIELDS as readonly string[]).not.toContain(
      'isSfCollect',
    );
    expect(SHIPPING_EDITABLE_FIELDS as readonly string[]).not.toContain(
      'isSfCollect',
    );
  });

  it('editableFieldsForStatus returns the bucket contents', () => {
    expect(editableFieldsForStatus(OrderStatus.DRAFT)).toEqual(FULL_EDITABLE_FIELDS);
    expect(editableFieldsForStatus(OrderStatus.SCHEDULING)).toEqual(
      SHIPPING_EDITABLE_FIELDS,
    );
    expect(editableFieldsForStatus(OrderStatus.FINISHED)).toEqual([]);
  });
});

describe('canEditOrderSfCollect', () => {
  it('allows correction through SHIPPED but keeps terminal states immutable', () => {
    for (const status of [
      OrderStatus.DRAFT,
      OrderStatus.SUBMITTED,
      OrderStatus.SCHEDULING,
      OrderStatus.IN_PRODUCTION,
      OrderStatus.COMPLETED,
      OrderStatus.SHIPPED,
    ]) {
      expect(canEditOrderSfCollect(status), `status=${status}`).toBe(true);
    }
    expect(canEditOrderSfCollect(OrderStatus.FINISHED)).toBe(false);
    expect(canEditOrderSfCollect(OrderStatus.CANCELLED)).toBe(false);
  });
});

describe('isOrderEditable', () => {
  it('true for DRAFT/SUBMITTED/SCHEDULING/IN_PRODUCTION', () => {
    for (const s of [
      OrderStatus.DRAFT,
      OrderStatus.SUBMITTED,
      OrderStatus.SCHEDULING,
      OrderStatus.IN_PRODUCTION,
    ]) {
      expect(isOrderEditable(s), `status=${s}`).toBe(true);
    }
  });

  it('false once the order is completed or terminal', () => {
    for (const s of [
      OrderStatus.COMPLETED,
      OrderStatus.SHIPPED,
      OrderStatus.FINISHED,
      OrderStatus.CANCELLED,
    ]) {
      expect(isOrderEditable(s), `status=${s}`).toBe(false);
    }
  });
});
