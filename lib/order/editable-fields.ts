import { OrderStatus, Role } from '../../generated/prisma/enums';

// Which subset of top-level Order fields is editable at each status,
// per SPEC §3.6:
//
//   DRAFT / PENDING_FACTORY / SUBMITTED → 全部可改  (FULL)
//   SCHEDULING / IN_PRODUCTION     → 仅改收货信息/备注 (SHIPPING_ONLY)
//   COMPLETED / SHIPPED / FINISHED → 不可改 (NONE)
//   CANCELLED                      → 不可改 (NONE) — terminal
//
// 款式变更走独立申请与审批，不随基本信息保存直接覆盖生产事实。

export type EditableFieldset = 'FULL' | 'SHIPPING_ONLY' | 'NONE';

// Fields that round-trip through the edit form. Listed as a readonly
// tuple (not a Set) so tests can assert the exact set + the action
// layer can map directly to Zod schema keys.
export const FULL_EDITABLE_FIELDS = [
  'customName',
  'customerRef',
  'customerPartyId',
  'receiverName',
  'receiverPhone',
  'receiverAddress',
  'expressCode',
  'packageRequirement',
  'remark',
  'promisedDate',
  'isUrgent',
] as const;

export const SHIPPING_EDITABLE_FIELDS = [
  'receiverName',
  'receiverPhone',
  'receiverAddress',
  'expressCode',
  'packageRequirement',
  'remark',
] as const;

export type FullEditableField = (typeof FULL_EDITABLE_FIELDS)[number];
export type ShippingEditableField = (typeof SHIPPING_EDITABLE_FIELDS)[number];

export function editableFieldsetForStatus(status: OrderStatus): EditableFieldset {
  switch (status) {
    case OrderStatus.DRAFT:
    case OrderStatus.PENDING_FACTORY:
    case OrderStatus.REJECTED:
    case OrderStatus.SUBMITTED:
      return 'FULL';
    case OrderStatus.CONFIRMED:
    case OrderStatus.ON_HOLD:
    case OrderStatus.RELEASED:
    case OrderStatus.FOILING:
    case OrderStatus.PACKING:
    case OrderStatus.SCHEDULING:
    case OrderStatus.IN_PRODUCTION:
      return 'SHIPPING_ONLY';
    case OrderStatus.COMPLETED:
    case OrderStatus.SHIPPED:
    case OrderStatus.SETTLED:
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

// 顺丰到付通过详情页专用 action 维护，因为外部销售工单必须同步重算
// 对客快递应收；不能混入普通字段 UPDATE。FINISHED / CANCELLED 终态不变。
export function canEditOrderSfCollect(status: OrderStatus): boolean {
  return (
    status !== OrderStatus.SETTLED &&
    status !== OrderStatus.FINISHED &&
    status !== OrderStatus.CANCELLED
  );
}

export const ORDER_MODIFIABLE_STATUSES: readonly OrderStatus[] = [
  OrderStatus.DRAFT, OrderStatus.PENDING_FACTORY, OrderStatus.REJECTED, OrderStatus.SUBMITTED,
  OrderStatus.SCHEDULING, OrderStatus.IN_PRODUCTION, OrderStatus.CONFIRMED,
  OrderStatus.RELEASED, OrderStatus.FOILING, OrderStatus.PACKING,
  OrderStatus.ON_HOLD,
];

export function canRequestOrderModification(actor: { id: string; role: Role }, order: { submitterId: string; status: OrderStatus }, hasPendingRequest = false) {
  return !hasPendingRequest && ORDER_MODIFIABLE_STATUSES.includes(order.status) && (
    actor.role === Role.ADMIN || ((actor.role === Role.SALES || actor.role === Role.CUSTOMER_SERVICE) && actor.id === order.submitterId)
  );
}
