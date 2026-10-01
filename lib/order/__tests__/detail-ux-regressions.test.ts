vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('@/lib/order/production-readiness', () => ({}));
import { describe, expect, it, vi } from 'vitest';
import { actionLabel } from '../log-format';
import { orderPricingSourceLabel } from '../pricing-source';
import { orderShippingAvailability, orderShippingRecoveryHref, shipmentCompletesPlannedProduction } from '../shipping-availability';
import { resolveAdminOrderShipDisabledReason } from '../admin-workspace';
import { OrderStatus } from '@/generated/prisma/enums';

const facts = { status: 'COMPLETED' as const, hasPendingChange: true, pricingPending: true,
  hasLiveOutsource: true, hasIncompleteProduction: true, hasShipment: false };

describe('order detail UX regressions', () => {
  it('uses the same first shipping blocker in the workspace and detail, including multiple blockers', () => {
    const detail = orderShippingAvailability({ ...facts, isAdministrator: true,
      isPricingPending: facts.pricingPending, incompleteProductionCount: 2 });
    expect(detail.canShip).toBe(false);
    expect(detail.disabledReason).toBe(resolveAdminOrderShipDisabledReason(facts));
    expect(detail.disabledReason).toContain('待审');
  });
  it.each([
    ['OPERATIONS_RELEASED', '下发生产'], ['OPERATIONS_MATERIALIZED', '生成生产工序'],
    ['OPERATIONS_REMATERIALIZED', '更新生产工序版本'], ['FACTORY_HELD', '暂停生产'],
    ['ORDER_PRINT_REQUESTED', '创建打印任务'], ['ORDER_PRINTED', '确认已打印'],
    ['ORDER_PRINT_REQUESTS_SUPERSEDED', '旧版打印任务失效'], ['ORDER_SETTLED_V2', '工单结算'],
    ['CHANGE_REQUEST_CREATED', '提交工单变更申请'], ['REPORT_DISPUTE_REVIEWED', '回复报工异议'],
    ['BLANK_MATERIAL_PRICE_CONFIRMED', '确认历史材料单价'],
  ])('labels current audit writer %s for the activity feed and export', (key, label) => {
    expect(actionLabel(key)).toBe(label);
  });
  it.each([
    ['ORDER_READY_FOR_PRODUCTION', '自动校验通过'],
    ['SF_COLLECT_MANUAL_FREIGHT_WAIVED', '到付免收手工运费'],
    ['CHANGE_REQUEST_APPLIED_ADMIN_CONFIRMED', '工单变更人工核价'],
  ])('labels actual pricing source %s', (key, label) => {
    expect(orderPricingSourceLabel(key)).toBe(label);
  });
});

it.each(['DRAFT', 'SETTLED', 'FINISHED', 'CANCELLED', 'ON_HOLD'] as const)('never offers shipping in %s', status => {
  const input = { status, isAdministrator: true, hasPendingChange: false, isPricingPending: false, hasLiveOutsource: false, incompleteProductionCount: 0, hasShipment: true };
  expect(orderShippingAvailability(input).canShip).toBe(false);
  expect(orderShippingRecoveryHref(input)).toBe('#order-detail-actions');
});

it('selects an existing recovery destination for each first blocker', () => {
  const input = { status: 'PACKING' as const, isAdministrator: true, hasPendingChange: true, isPricingPending: true, hasLiveOutsource: true, incompleteProductionCount: 2, hasShipment: false };
  expect(orderShippingRecoveryHref(input)).toBe('#order-detail-actions');
  input.hasPendingChange = false;
  expect(orderShippingRecoveryHref(input)).toBe('#pricing-review');
  input.isPricingPending = false;
  expect(orderShippingRecoveryHref(input)).toBe('/foreman/outsource');
  input.hasLiveOutsource = false;
  expect(orderShippingRecoveryHref(input)).toBe('#detail-business-records');
  input.incompleteProductionCount = 0;
  expect(orderShippingRecoveryHref(input)).toBe('#shipment-registration');
  input.hasShipment = true;
  expect(orderShippingAvailability({ ...input, isAdministrator: false }).canShip).toBe(false);
});

it.each([
  [OrderStatus.RELEASED, '生产完工后才可发货'],
  [OrderStatus.FOILING, '生产完工后才可发货'],
  [OrderStatus.IN_PRODUCTION, '生产完工后才可发货'],
  [OrderStatus.CONFIRMED, '下发并完成生产后才可发货'],
  [OrderStatus.ON_HOLD, '工单已暂停，请先恢复生产再核对发货条件'],
  [OrderStatus.CANCELLED, '工单已取消，无法发货'],
  [OrderStatus.SETTLED, '工单已结算，无需重复发货'],
] as const)('explains the next step or terminal restriction in %s without bypassing status priority', (status, reason) => {
  const result = orderShippingAvailability({ status, isAdministrator: true, hasPendingChange: true,
    isPricingPending: true, hasLiveOutsource: true, incompleteProductionCount: 2, hasShipment: false });
  expect(result).toEqual({ canShip: false, disabledReason: reason });
});

it('does not offer address recovery when the order cannot be edited', () => {
  const input = { status: OrderStatus.COMPLETED, isAdministrator: true, hasPendingChange: false,
    isPricingPending: false, hasLiveOutsource: false, incompleteProductionCount: 0, hasShipment: false };
  expect(orderShippingRecoveryHref(input)).toBeNull();
  expect(orderShippingRecoveryHref({ ...input, status: OrderStatus.PACKING })).toBe('#shipment-registration');
});

it('blocks shipping when required outsourcing is missing or does not cover the order', () => {
  const input = { status: OrderStatus.PACKING, isAdministrator: true, hasPendingChange: false,
    isPricingPending: false, hasLiveOutsource: false, hasOutsourceGap: true, incompleteProductionCount: 0, hasShipment: true };
  expect(orderShippingAvailability(input)).toEqual({ canShip: false, disabledReason: '外协单缺失或数量未覆盖工单，请先补齐外协' });
  expect(orderShippingRecoveryHref(input)).toBe('/foreman/outsource');
  expect(orderShippingAvailability({ ...input, hasOutsourceGap: false }).canShip).toBe(true);
});

it('lets a released single-owner order ship when confirming shipment completes its pending jobs at plan', () => {
  const input = { status: OrderStatus.RELEASED, isAdministrator: true, hasPendingChange: false, isPricingPending: false, hasLiveOutsource: false,
    incompleteProductionCount: 1, hasShipment: true, plannedCompletion: { pendingJobs: 1, requestedJobs: 0, unassignedUnits: 0 } };
  expect(orderShippingAvailability(input)).toEqual({ canShip: true, disabledReason: null });
  expect(shipmentCompletesPlannedProduction(input)).toBe(true);
  expect(orderShippingAvailability({ ...input, plannedCompletion: null })).toEqual({ canShip: false, disabledReason: '生产完工后才可发货' });
  expect(orderShippingAvailability({ ...input, status: OrderStatus.ON_HOLD }).canShip).toBe(false);
  expect(orderShippingAvailability({ ...input, hasOutsourceGap: true }).disabledReason).toBe('外协单缺失或数量未覆盖工单，请先补齐外协');
  expect(orderShippingRecoveryHref({ ...input, plannedCompletion: { pendingJobs: 1, requestedJobs: 1, unassignedUnits: 0 } })).toBe('#detail-business-records');
  expect(shipmentCompletesPlannedProduction({ status: OrderStatus.PACKING, plannedCompletion: { pendingJobs: 0, requestedJobs: 0, unassignedUnits: 0 } })).toBe(false);
});
