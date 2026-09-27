vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('@/lib/order/production-readiness', () => ({}));
import { describe, expect, it, vi } from 'vitest';
import { actionLabel } from '../log-format';
import { orderPricingSourceLabel } from '../pricing-source';
import { orderShippingAvailability, orderShippingRecoveryHref } from '../shipping-availability';
import { resolveAdminOrderShipDisabledReason } from '../admin-workspace';

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
  expect(orderShippingRecoveryHref(input)).toBe('#detail-production-records');
  input.incompleteProductionCount = 0;
  expect(orderShippingRecoveryHref(input)).toBe('#shipment-registration');
  input.hasShipment = true;
  expect(orderShippingAvailability({ ...input, isAdministrator: false }).canShip).toBe(false);
});
