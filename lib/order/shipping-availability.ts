import { OrderStatus } from '@/generated/prisma/enums';
import { isOrderEditable } from '@/lib/order/editable-fields';
import type { ShipmentInput } from './shipping-fields';

export type OrderShippingAvailabilityInput = {
  isAdministrator: boolean;
  status: OrderStatus;
  incompleteProductionCount: number;
  hasLiveOutsource: boolean;
  /** Required outsourcing has no live order or does not cover every item (same facts as the ship gate). */
  hasOutsourceGap?: boolean;
  /**
   * Single-owner production facts of the current version. When present, confirming
   * shipment registers the pending jobs at plan (DECISIONS 2026-10-01), so an order
   * still in RELEASED/FOILING is shippable unless a job needs approval or is unassigned.
   */
  plannedCompletion?: { pendingJobs: number; requestedJobs: number; unassignedUnits: number } | null;
  isPricingPending: boolean;
  hasShipment: boolean;
  hasPendingChange: boolean;
};

type OrderShippingBlocker = 'STATUS' | 'CHANGE' | 'PRICING' | 'OUTSOURCE' | 'OUTSOURCE_GAP' | 'PRODUCTION' | 'PRODUCTION_REQUESTED' | 'PRODUCTION_UNASSIGNED' | 'ADDRESS';

/** Shared presentation facts. Actual writes still enforce their transactional guards. */
/** Pending single-owner jobs that confirming shipment will register at plan. */
export function shipmentCompletesPlannedProduction(input: Pick<OrderShippingAvailabilityInput, 'status' | 'plannedCompletion'>): boolean {
  return !!input.plannedCompletion && input.plannedCompletion.pendingJobs > 0
    && (input.status === OrderStatus.RELEASED || input.status === OrderStatus.FOILING);
}

export function orderShippingBlocker(input: OrderShippingAvailabilityInput): OrderShippingBlocker | null {
  const planned = input.plannedCompletion && (input.status === OrderStatus.RELEASED || input.status === OrderStatus.FOILING)
    ? input.plannedCompletion : null;
  if (input.status !== OrderStatus.PACKING && input.status !== OrderStatus.COMPLETED && !planned) return 'STATUS';
  if (input.hasPendingChange) return 'CHANGE';
  if (input.isPricingPending) return 'PRICING';
  if (input.hasLiveOutsource) return 'OUTSOURCE';
  if (input.hasOutsourceGap) return 'OUTSOURCE_GAP';
  if (planned?.requestedJobs) return 'PRODUCTION_REQUESTED';
  if (planned?.unassignedUnits) return 'PRODUCTION_UNASSIGNED';
  if (planned ? planned.pendingJobs === 0 : input.incompleteProductionCount > 0) return 'PRODUCTION';
  if (!input.hasShipment) return 'ADDRESS';
  return null;
}

const SHIPPING_BLOCKER_LABELS: Record<Exclude<OrderShippingBlocker, 'STATUS'>, string> = {
  CHANGE: '存在待审的工单变更',
  PRICING: '价格待管理员确认',
  OUTSOURCE: '外协尚未收回，请先核对外协进度',
  OUTSOURCE_GAP: '外协单缺失或数量未覆盖工单，请先补齐外协',
  PRODUCTION: '生产工序尚未完成，请先核对报工',
  PRODUCTION_REQUESTED: '有生产数量待审批，请先在生产安排中审批',
  PRODUCTION_UNASSIGNED: '仍有未安排师傅的生产，请先排单',
  ADDRESS: '缺少发货地址，无法发货',
};

function shippingStatusReason(status: OrderStatus): string {
  switch (status) {
    case OrderStatus.DRAFT:
    case OrderStatus.REJECTED:
      return '提交并完成生产后才可发货';
    case OrderStatus.PENDING_FACTORY:
    case OrderStatus.SUBMITTED:
      return '工厂确认并完成生产后才可发货';
    case OrderStatus.CONFIRMED:
    case OrderStatus.SCHEDULING:
      return '下发并完成生产后才可发货';
    case OrderStatus.RELEASED:
    case OrderStatus.FOILING:
    case OrderStatus.IN_PRODUCTION:
      return '生产完工后才可发货';
    case OrderStatus.ON_HOLD:
      return '工单已暂停，请先恢复生产再核对发货条件';
    case OrderStatus.SHIPPED:
      return '工单已发货，无需重复发货';
    case OrderStatus.SETTLED:
      return '工单已结算，无需重复发货';
    case OrderStatus.FINISHED:
      return '工单已结束，无需重复发货';
    case OrderStatus.CANCELLED:
      return '工单已取消，无法发货';
    default:
      return '当前工单状态不支持发货';
  }
}

export function orderShippingRecoveryHref(input: OrderShippingAvailabilityInput): string | null {
  const blocker = orderShippingBlocker(input);
  switch (blocker) {
    case 'CHANGE': case 'STATUS': return '#order-detail-actions';
    case 'PRICING': return '#pricing-review';
    case 'OUTSOURCE': case 'OUTSOURCE_GAP': return '/foreman/outsource';
    case 'PRODUCTION': case 'PRODUCTION_REQUESTED': case 'PRODUCTION_UNASSIGNED': return '#detail-business-records';
    case 'ADDRESS': return isOrderEditable(input.status) ? '#shipment-registration' : null;
    case null: return '#shipment-registration';
  }
}

export function orderShippingAvailability(
  input: OrderShippingAvailabilityInput,
): { canShip: boolean; disabledReason: string | null } {
  const blocker = orderShippingBlocker(input);
  return {
    canShip: input.isAdministrator && blocker === null,
    disabledReason: blocker === 'STATUS'
      ? shippingStatusReason(input.status)
      : blocker ? SHIPPING_BLOCKER_LABELS[blocker] : null,
  };
}

type ShipmentSource = Omit<
  ShipmentInput,
  | 'weightKg'
  | 'shippingFee'
  | 'packingMaterialFee'
  | 'customerChargeOverrideReason'
> & {
  weightKg: unknown;
};

type ShipmentCharge = {
  amount: { toString(): string } | null;
  overrideReason: string | null;
};

export function buildShipOrderShipmentInputs(
  shipments: readonly ShipmentSource[],
  chargesByShipmentAndCategory: ReadonlyMap<string, ShipmentCharge>,
): ShipmentInput[] {
  return shipments.map((shipment) => {
    const shippingCharge = chargesByShipmentAndCategory.get(
      `${shipment.id}:SHIPPING_FEE`,
    );
    const packingCharge = chargesByShipmentAndCategory.get(
      `${shipment.id}:PACKING_MATERIAL`,
    );
    return {
      ...shipment,
      weightKg: shipment.weightKg ? String(shipment.weightKg) : null,
      shippingFee: shippingCharge?.amount?.toString() ?? null,
      packingMaterialFee: packingCharge?.amount?.toString() ?? null,
      customerChargeOverrideReason:
        shippingCharge?.overrideReason ?? packingCharge?.overrideReason ?? null,
    };
  });
}
