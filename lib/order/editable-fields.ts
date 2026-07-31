import { OrderStatus } from '../../generated/prisma/enums';

// Which subset of top-level Order fields is editable at each status,
// per SPEC §3.6:
//
//   DRAFT / SUBMITTED              → 全部可改  (FULL)
//   SCHEDULING / IN_PRODUCTION     → 仅改收货信息/备注 (SHIPPING_ONLY)
//   COMPLETED / SHIPPED / FINISHED → 不可改 (NONE)
//   CANCELLED                      → 不可改 (NONE) — terminal
//
// E-lean scope (2026-04-23 decision): editing is top-level Order fields
// only. Item add / remove / edit is deferred to a P1 ticket; for now
// users delete-and-recreate.

export type EditableFieldset = 'FULL' | 'SHIPPING_ONLY' | 'NONE';

// Fields that round-trip through the edit form. Listed as a readonly
// tuple (not a Set) so tests can assert the exact set + the action
// layer can map directly to Zod schema keys.
export const FULL_EDITABLE_FIELDS = [
  'customName',
  'customerRef',
  'receiverName',
  'receiverPhone',
  'receiverAddress',
  'expressCode',
  'packageRequirement',
  'remark',
  'promisedDate',
  'isUrgent',
  'isSfCollect',
] as const;

export const SHIPPING_EDITABLE_FIELDS = [
  'receiverName',
  'receiverPhone',
  'receiverAddress',
  'expressCode',
  'packageRequirement',
  'remark',
  'isSfCollect',
] as const;

export type FullEditableField = (typeof FULL_EDITABLE_FIELDS)[number];
export type ShippingEditableField = (typeof SHIPPING_EDITABLE_FIELDS)[number];

export function editableFieldsetForStatus(status: OrderStatus): EditableFieldset {
  switch (status) {
    case OrderStatus.DRAFT:
    case OrderStatus.SUBMITTED:
      return 'FULL';
    case OrderStatus.SCHEDULING:
    case OrderStatus.IN_PRODUCTION:
      return 'SHIPPING_ONLY';
    case OrderStatus.COMPLETED:
    case OrderStatus.SHIPPED:
    case OrderStatus.FINISHED:
    case OrderStatus.CANCELLED:
      return 'NONE';
  }
}

export function editableFieldsForStatus(
  status: OrderStatus,
): readonly string[] {
  switch (editableFieldsetForStatus(status)) {
    case 'FULL':
      return FULL_EDITABLE_FIELDS;
    case 'SHIPPING_ONLY':
      return SHIPPING_EDITABLE_FIELDS;
    case 'NONE':
      return [];
  }
}

export function isOrderEditable(status: OrderStatus): boolean {
  return editableFieldsetForStatus(status) !== 'NONE';
}

// 顺丰到付只影响履约方式，不改变款式、金额或生产数据，因此允许在
// 完工 / 发货后补录或纠正；FINISHED 与 CANCELLED 仍保持终态不可变。
export function canEditOrderSfCollect(status: OrderStatus): boolean {
  return status !== OrderStatus.FINISHED && status !== OrderStatus.CANCELLED;
}
