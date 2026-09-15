import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@/generated/prisma/client';
import {
  assertLocalFixtureDatabase,
  buildCompletionInput,
  completionSkipReason,
  type CompletionOrder,
} from '../dashboard-order-completion';

// These tests exercise selection and production facts without importing the
// persistence graph or opening a database connection. Actual quotes are checked
// by the script's rollback-only run against the local published price books.
vi.mock('@/lib/order/submit-external-order', () => ({
  ExternalOrderQuoteChangedError: class extends Error {},
  finalizeExternalOrderQuoteInTx: vi.fn(),
}));

const runId = 'fb9ddbe2000a64d3';
const ownerId = `e2e-dash-${runId}-sales`;

function shell(
  suffix: '1' | '2' | '3-urgent' = '1',
  overrides: Partial<CompletionOrder> = {},
): CompletionOrder {
  return {
    id: `e2e-dash-${runId}-sub-${suffix}`,
    orderNo: `E2E-DASH-${runId}-SUB-${suffix.toUpperCase()}`,
    submitterId: ownerId,
    createdById: ownerId,
    submitterRole: 'SALES',
    submitter: { id: ownerId, username: ownerId, role: 'SALES', isActive: false },
    status: 'SUBMITTED',
    kind: 'NORMAL',
    billingMode: 'CHARGE',
    settlementType: 'EXTERNAL_SALES',
    customerPartyId: null,
    sourceOrderId: null,
    reworkCause: null,
    reworkReason: null,
    requiresOutsource: false,
    isUrgent: suffix === '3-urgent',
    customName: null,
    customerRef: null,
    receiverName: null,
    receiverPhone: null,
    receiverAddress: null,
    expressCode: null,
    isSfCollect: false,
    packageRequirement: null,
    remark: null,
    nextItemFig: 1,
    clientSubmissionId: null,
    processingAmount: new Prisma.Decimal(0),
    packagingAmount: new Prisma.Decimal(0),
    totalAmount: new Prisma.Decimal(0),
    quotedFee: null,
    confirmedFee: null,
    settledFee: null,
    effectiveCustomerFee: new Prisma.Decimal(0),
    settledAt: null,
    settlementContractVersion: null,
    quotedFeeCompleteness: null,
    quotedPricingRevisionId: null,
    revision: 1,
    workOrderVersion: 1,
    editVersion: 0,
    pricingStatus: 'PENDING_ADMIN_CONFIRMATION',
    priceRevision: 1,
    pricingConfirmedAt: null,
    pricingConfirmedById: null,
    promisedDate: null,
    trackingNo: null,
    searchPinyin: null,
    searchPinyinInitials: null,
    submittedAt: new Date('2026-09-07T04:00:00.000Z'),
    scheduledAt: null,
    completedAt: null,
    shippedAt: null,
    finishedAt: null,
    createdAt: new Date('2026-09-07T04:00:00.000Z'),
    updatedAt: new Date('2026-09-07T04:00:00.000Z'),
    agentMonthlyBillItem: null,
    _count: {
      reworkOrders: 0, items: 0, packagingGroups: 0, shipments: 0,
      outsourceOrders: 0, logs: 0, billItems: 0, changeRequests: 0,
      costEntries: 0, customerCharges: 0, csSalesEntries: 0,
      pricingRevisions: 0, productionOperations: 0, productionProgressSteps: 0,
      productionWorkOrderProgress: 0, productionScanClaims: 0, stars: 0,
      printJobs: 0, workflowDecisions: 0, exportSelections: 0,
    },
    purpose: 'STANDARD',
    pricingMode: 'ITEMIZED',
    samplePackagingRuleCode: null,
    ...overrides,
  };
}

describe('local fixture database boundary', () => {
  it.each([
    'postgresql://localhost/print_shop_erp',
    'postgres://127.0.0.1:5432/erp_dev',
    'postgresql://[::1]:5432/erp_test?schema=public',
  ])('accepts a local development database: %s', (url) => {
    expect(() => assertLocalFixtureDatabase(url, 'development')).not.toThrow();
  });

  it.each([
    ['postgresql://localhost/erp_test', 'production'],
    ['postgresql://db.example.com/erp_test', 'development'],
    ['postgresql://127.0.0.1.example.com/erp_test', 'development'],
    ['https://localhost/erp_test', 'development'],
    ['postgresql://localhost/production', 'development'],
    ['postgresql://localhost/%70%72%6f%64', 'development'],
    ['postgresql://localhost/erp_test?host=remote.example.com', 'development'],
    ['postgresql://localhost/erp_test?hostaddr=10.0.0.1', 'development'],
    ['postgresql://localhost/erp_test?service=live', 'development'],
    ['not-a-database-url', 'development'],
  ])('rejects unsafe destination %s (%s)', (url, environment) => {
    expect(() => assertLocalFixtureDatabase(url, environment)).toThrow();
  });
});

describe('dashboard shell eligibility', () => {
  it.each(['1', '2', '3-urgent'] as const)('accepts the untouched %s fixture', (suffix) => {
    expect(completionSkipReason(shell(suffix))).toBeNull();
  });

  it('preserves harmless stars and edit logs instead of treating them as financial history', () => {
    const order = shell();
    order._count.logs = 2;
    order._count.stars = 1;
    expect(completionSkipReason(order)).toBeNull();
  });

  const protectedRelations = [
    'items', 'packagingGroups', 'shipments', 'pricingRevisions', 'customerCharges',
    'costEntries', 'billItems', 'csSalesEntries', 'changeRequests', 'workflowDecisions',
    'printJobs', 'outsourceOrders', 'productionOperations', 'productionProgressSteps',
    'productionWorkOrderProgress', 'productionScanClaims', 'reworkOrders', 'exportSelections',
  ] as const;
  it.each(protectedRelations)('refuses an order with existing %s', (relation) => {
    const order = shell();
    order._count[relation] = 1;
    expect(completionSkipReason(order)).not.toBeNull();
  });

  const disqualifyingFacts: Array<[string, Partial<CompletionOrder>]> = [
    ['business order id', { id: 'order-actual-customer' }],
    ['another dashboard family', { id: `e2e-dash-${runId}-completed-1` }],
    ['different display number', { orderNo: 'GD-260907-001' }],
    ['different submitter', { submitterId: 'real-sales' }],
    ['different creator', { createdById: 'real-admin' }],
    ['different role snapshot', { submitterRole: 'CUSTOMER_SERVICE' }],
    ['different settlement path', { settlementType: 'FACTORY_DIRECT' }],
    ['completed state', { status: 'COMPLETED' }],
    ['customer association', { customerPartyId: 'actual-customer' }],
    ['parent order', { sourceOrderId: 'actual-order' }],
    ['agent bill', { agentMonthlyBillItem: { id: 'actual-bill-line' } }],
    ['processing amount', { processingAmount: new Prisma.Decimal('0.01') }],
    ['packaging amount', { packagingAmount: new Prisma.Decimal('0.01') }],
    ['legacy total', { totalAmount: new Prisma.Decimal('3000') }],
    ['zero quote is still history', { quotedFee: new Prisma.Decimal(0) }],
    ['confirmed amount', { confirmedFee: new Prisma.Decimal('3000') }],
    ['settled amount', { settledFee: new Prisma.Decimal('3000') }],
    ['pricing snapshot link', { quotedPricingRevisionId: 'actual-revision' }],
    ['quote completeness', { quotedFeeCompleteness: 'COMPLETE' }],
    ['advanced price revision', { priceRevision: 2 }],
    ['advanced order revision', { revision: 2 }],
    ['printed version', { workOrderVersion: 2 }],
    ['retired style numbers', { nextItemFig: 3 }],
    ['formal create submission', { clientSubmissionId: '88bfe16e-ab6e-4bc1-ad20-6c1a2a54c0ab' }],
    ['receiver edited by user', { receiverName: '真实收货人' }],
    ['shipping address', { receiverAddress: '用户已填写的地址' }],
    ['collect shipment', { isSfCollect: true }],
    ['tracking number', { trackingNo: 'tracking-existing' }],
    ['scheduled production', { scheduledAt: new Date() }],
    ['settlement timestamp', { settledAt: new Date() }],
  ];
  it.each(disqualifyingFacts)('refuses %s', (_label, patch) => {
    expect(completionSkipReason(shell('1', patch))).not.toBeNull();
  });

  it.each([
    { isActive: true },
    { role: 'CUSTOMER_SERVICE' as const },
    { username: 'e2e-unrelated-account' },
    { id: 'different-owner' },
  ])('refuses a changed fixture principal: %j', (patch) => {
    const order = shell();
    order.submitter = { ...order.submitter, ...patch };
    expect(completionSkipReason(order)).not.toBeNull();
  });
});

describe('complete production facts', () => {
  it.each([
    ['1', [1000]],
    ['2', [1000, 1000]],
    ['3-urgent', [500, 500, 500, 500]],
  ] as const)('builds valid production and bag allocations for sub-%s', (suffix, quantities) => {
    const order = shell(suffix);
    const before = structuredClone({ id: order.id, status: order.status, isUrgent: order.isUrgent });
    const input = buildCompletionInput(order);
    expect(input.items.map((item) => item.quantity)).toEqual(quantities);
    // The published ZTO policy applies its cap to the whole order, not to
    // each style or shipment. Demo cases must remain automatically quotable.
    expect(input.items.reduce((sum, item) => sum + item.quantity, 0)).toBeLessThanOrEqual(2000);
    expect(input.items.map((item) => item.fig)).toEqual(quantities.map((_, i) => i + 1));
    expect(input.nextItemFig).toBe(quantities.length + 1);
    expect(input.packagingGroups).toHaveLength(input.items.length);
    expect(input.additionalShipments).toEqual([]);
    expect(input.receiverAddress).toContain('演示地址');
    expect(input.destinationProvince).toBe('广东省');
    expect(input.isUrgent).toBe(before.isUrgent);
    expect({ id: order.id, status: order.status, isUrgent: order.isUrgent }).toEqual(before);
    expect(input.promisedDate?.getUTCFullYear()).toBe(2099);
    for (const [index, item] of input.items.entries()) {
      const membership = input.packagingGroups.flatMap((group) => {
        expect(group.itemUnitsPerBag).toHaveLength(input.items.length);
        const units = group.itemUnitsPerBag[index];
        return units > 0 ? [{ group, units }] : [];
      });
      expect(membership).toHaveLength(1);
      const { group, units } = membership[0]!;
      expect(group.mode).toBe('SINGLE_STYLE');
      expect(group.itemUnitsPerBag.filter((count) => count > 0)).toHaveLength(1);
      expect(units).toBe(item.pack);
      expect(group.actualBagCount).toBe(Math.ceil(item.quantity / units));
      expect((group.actualBagCount - 1) * units).toBeLessThan(item.quantity);
      expect(group.actualBagCount * units).toBeGreaterThanOrEqual(item.quantity);
      expect(item.frontFoilColors).toEqual(['亚金']);
      expect(item.backFoilColors).toEqual([]);
      expect(item.pricingRoute).toBe('STOCK_BLANK');
      expect(item.remark).toContain('未提供 CDR');
    }
  });

  it('retains user-entered metadata, instructions, urgency and due date', () => {
    const promisedDate = new Date('2026-10-20T00:00:00.000Z');
    const input = buildCompletionInput(shell('2', {
      customName: '客户已经填写的名称', customerRef: '客户简称',
      remark: '请先校对内容', packageRequirement: '封口并贴标签',
      promisedDate, isUrgent: true,
    }));
    expect(input.customName).toBe('客户已经填写的名称');
    expect(input.customerRef).toBe('客户简称');
    expect(input.remark).toBe('请先校对内容');
    expect(input.packageRequirement).toBe('封口并贴标签');
    expect(input.promisedDate).toEqual(promisedDate);
    expect(input.isUrgent).toBe(true);
  });

  it('does not prepare a payload for unrelated ids', () => {
    expect(() => buildCompletionInput(shell('1', { id: 'real-order' }))).toThrow();
  });
});
