import Decimal from 'decimal.js';
import { describe, expect, it, vi } from 'vitest';
import { buildAdminOrderDetailModel, type AdminOrderDetailInput } from '../admin-order-detail-model';
import { batchOrder } from './admin-order-batch-fixture';
import { buildTrustedAdminItemPricingSnapshot, buildTrustedAdminPackagingPricingSnapshot, type AdminItemPricingSnapshotFacts, type AdminPackagingPricingSnapshotFacts } from '@/lib/order/admin-pricing-snapshot';

function fixture(): AdminOrderDetailInput {
  const order = {
    id: 'order-1', orderNo: 'GD-260907-001', revision: 4, workOrderVersion: 2, editVersion: 3,
    status: 'CONFIRMED', customName: '中秋红包', isUrgent: false,
    packagingAmount: new Decimal('0'),
    items: [{
      id: 'item-1', fig: 1, sequence: 1, name: '红包', quantity: 1000, pack: null,
      craftNames: ['局部烫金'], paperType: '红卡', paperWeightGsm: 120, specification: '大号',
      actualWidthMm: new Decimal('90.50'), actualHeightMm: new Decimal('165'),
      frontFoilColors: ['金'], backFoilColors: [], foilColors: ['金'], isDoubleSided: false,
      subtotal: new Decimal('100.10'), remark: null,
      designs: [{ id: 'image-1', fileType: 'IMAGE', fileUrl: 'design/image.jpg', fileName: '效果图.jpg' },
        { id: 'cdr-1', fileType: 'CDR', fileUrl: 'design/source.cdr', fileName: '生产.cdr' }],
      plateDetails: [{ id: 'plate-1', isActive: true, name: '正面', amount: new Decimal('0') },
        { id: 'plate-old', isActive: false, name: '旧版', amount: new Decimal('999') }],
    }],
    packagingGroups: [], customerCharges: [], changeRequests: [], logs: [], shipments: [],
  } as unknown as AdminOrderDetailInput['order'];
  return { order, workspace: batchOrder(), signImageUrl: (url) => `signed:${url}` };
}

function change(overrides: Record<string, unknown> = {}) {
  return {
    id: 'change-1', status: 'APPROVED', type: 'MODIFY', reason: '客户加量',
    createdAt: new Date('2026-09-06T01:00:00Z'), reviewedAt: new Date('2026-09-06T02:00:00Z'),
    reviewedBy: { displayName: '管理员' }, requester: { displayName: '销售甲' },
    baseWorkOrderVersion: 1, workOrderVersionAfter: 2,
    beforeSnapshot: { items: [{ id: 'item-1', sequence: 1, name: '红包', quantity: 500 }] },
    proposedChanges: { items: [{ operation: 'UPDATE', itemId: 'item-1', quantity: 1000 }] },
    ...overrides,
  } as unknown as AdminOrderDetailInput['order']['changeRequests'][number];
}

function confirmedManualFixture(subtotal: string): AdminOrderDetailInput {
  const input = fixture();
  const facts: AdminItemPricingSnapshotFacts = {
    orderId: 'order-1', id: 'item-1', productId: null, pricingRoute: 'CUSTOM_SINGLE_FLAT_FOIL',
    craft: null, productStructure: 'STANDARD_ENVELOPE', plateGroupId: null, pricingGroup: null,
    manualQuoteReason: '特殊工艺人工核价', specification: '大号', actualWidthMm: '90.50', actualHeightMm: '165',
    paperType: '红卡', paperWeightGsm: 120, quantity: 1000, pack: null, crafts: ['foil'],
    frontFoilColors: ['金'], backFoilColors: [], foilColors: ['金'], foilTechnique: 'FLAT',
    hasLocalFoil: true, lamination: 'NONE', printColors: [], printColorsKnown: true,
    isDoubleSided: false, isDoubleColor: false, quoteDisposition: 'MANUAL_PRICING_REQUIRED',
    unitPrice: '0', fixedFee: subtotal, subtotal, priceOverrideReason: '按客户确认工艺核定整款费用',
  };
  Object.assign(input.order.items[0]!, facts, {
    pricingSnapshot: buildTrustedAdminItemPricingSnapshot({
      previous: null, now: new Date('2026-09-07T01:00:00Z'), actorId: 'admin-1',
      previousPriceRevision: 4, item: facts,
    }),
  });
  return input;
}

function packagingFixture(snapshot: unknown, subtotal = '0.00'): AdminOrderDetailInput {
  const input = fixture();
  Object.assign(input.order, { packagingAmount: subtotal });
  input.order.packagingGroups = [{
    id: 'group-1', sequence: 1, name: '单款装', mode: 'SINGLE_STYLE', actualBagCount: 100,
    unitPrice: new Decimal(subtotal).div(100).toString(), subtotal,
    priceOverrideReason: '管理员核对入袋要求', pricingSnapshot: snapshot,
    lines: [{ id: 'line-1', unitsPerBag: 10, orderItem: { id: 'item-1', sequence: 1, name: '红包' } }],
  }] as unknown as AdminOrderDetailInput['order']['packagingGroups'];
  return input;
}

describe('admin order detail projection', () => {
  it.each([
    ['160g珠光艳闪', 160, '160g珠光艳闪'],
    ['珠光艳闪 160 G', 160, '珠光艳闪 160 G'],
    ['珠光艳闪（160克）', 160, '珠光艳闪（160克）'],
    ['珠光艳闪 160gsm', 160, '珠光艳闪 160gsm'],
    ['珠光艳闪', 160, '珠光艳闪 · 160g'],
    ['120g珠光艳闪', 160, '120g珠光艳闪 · 160g'],
    ['160g珠光艳闪', 60, '160g珠光艳闪 · 60g'],
    ['1600g红卡', 160, '1600g红卡 · 160g'],
    ['160.5g珠光艳闪', 160, '160.5g珠光艳闪 · 160g'],
    ['珠光艳闪', null, '珠光艳闪'],
    ['160g珠光闪红', 160, '160g珠光暗红'],
    [null, 160, '160g'],
    [null, null, '未记录'],
  ])('preserves paper facts without repeating the same weight: %s / %s', (paperType, paperWeightGsm, expected) => {
    const input = fixture();
    Object.assign(input.order.items[0]!, { paperType, paperWeightGsm });
    expect(buildAdminOrderDetailModel(input).items[0]!.specs.find((spec) => spec.label === '纸张')?.value).toBe(expected);
  });

  it('retains exact persisted amounts, zero plate fees and nullable fee stages', () => {
    const input = fixture();
    input.workspace.feeStages = { quoted: '9007199254.01', confirmed: '0.00', settled: null, active: 'CONFIRMED' };
    input.workspace.fee = { amount: '0.00', source: 'CONFIRMED', estimated: false };
    const result = buildAdminOrderDetailModel(input);
    expect(result.total).toBe('0.00');
    expect(result.feeSource).toBe('CONFIRMED');
    expect(result.feeStages.map((stage) => stage.total)).toEqual(['9007199254.01', '0.00', null]);
    expect(result.feeStages.map((stage) => stage.current)).toEqual([false, true, false]);
    expect(result.items[0]!.fees).toEqual([
      { id: 'item-1-subtotal', label: '款式加工费', amount: '100.10' },
      { id: 'plate-1', label: '版费 · 正面', amount: '0.00' },
    ]);
    expect(result.orderFees).toEqual([{ id: 'packaging', label: '包装费', amount: '0.00' }]);
    expect(result.feeStages[0]).not.toHaveProperty('processingAmount');
  });

  it('signs only IMAGE URLs and emits no CDR object key or server Decimal/Date', () => {
    const input = fixture();
    const sign = vi.fn(input.signImageUrl);
    const result = buildAdminOrderDetailModel({ ...input, signImageUrl: sign });
    expect(sign).toHaveBeenCalledExactlyOnceWith('design/image.jpg');
    expect(result.items[0]!.hasCdr).toBe(true);
    expect(result.items[0]!.images[0]!.url).toBe('signed:design/image.jpg');
    expect(JSON.stringify(result)).not.toContain('source.cdr');
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });

  it('does not show the storage zero sentinel as an actual manual quote', () => {
    const input = fixture();
    input.order.items[0]!.quoteDisposition = 'MANUAL_PRICING_REQUIRED';
    Object.assign(input.order.items[0]!, { subtotal: new Decimal('0') });
    expect(buildAdminOrderDetailModel(input).items[0]!.fees[0]!.amount).toBeNull();
  });

  it.each(['123.45', '0.00'])('shows the trusted reviewed subtotal %s even when the original manual disposition remains', (subtotal) => {
    const input = confirmedManualFixture(subtotal);
    expect(input.order.items[0]!.quoteDisposition).toBe('MANUAL_PRICING_REQUIRED');
    expect(buildAdminOrderDetailModel(input).items[0]!.fees[0]!.amount).toBe(subtotal);
  });

  it('does not treat an administrator marker without a row-bound confirmation as a completed quote', () => {
    const input = confirmedManualFixture('123.45');
    Object.assign(input.order.items[0]!, { pricingSnapshot: { source: 'ADMIN_SNAPSHOT_CONFIRMATION', status: 'ADMIN_CONFIRMED' } });
    expect(buildAdminOrderDetailModel(input).items[0]!.fees[0]!.amount).toBeNull();
  });

  it('reopens a manual fee when live item facts no longer match the saved confirmation', () => {
    const input = confirmedManualFixture('123.45');
    input.order.items[0]!.quantity = 2000;
    expect(buildAdminOrderDetailModel(input).items[0]!.fees[0]!.amount).toBeNull();
  });

  it('shows unknown packaging instead of its legacy zero storage placeholder', () => {
    const input = packagingFixture({
      source: 'EXTERNAL_SUBMIT_MANUAL_REQUIRED', complete: false,
      actual: { amount: null, provisional: true },
    });
    expect(buildAdminOrderDetailModel(input).orderFees[0]!.amount).toBeNull();
  });

  it('keeps a real automatic zero packaging quote even while another order fee is pending', () => {
    const input = packagingFixture({
      source: 'EXTERNAL_SUBMIT_QUOTE', complete: true,
      actual: { subtotal: '0.00', provisional: false },
    });
    input.workspace.fee = { amount: null, source: 'PENDING', estimated: false };
    input.workspace.feeStages = { quoted: null, confirmed: null, settled: null, active: 'PENDING' };
    expect(buildAdminOrderDetailModel(input).orderFees[0]!.amount).toBe('0.00');
  });

  it.each(['0.00', '25.00'])('keeps trusted reviewed packaging %s and detects a stale bag-count binding', (subtotal) => {
    const input = packagingFixture(null, subtotal);
    const facts: AdminPackagingPricingSnapshotFacts = {
      orderId: 'order-1', id: 'group-1', mode: 'SINGLE_STYLE', actualBagCount: 100,
      unitPrice: new Decimal(subtotal).div(100).toString(), subtotal,
      priceOverrideReason: '管理员核对入袋要求', lines: [{ orderItemId: 'item-1', unitsPerBag: 10 }],
    };
    Object.assign(input.order.packagingGroups[0]!, {
      pricingSnapshot: buildTrustedAdminPackagingPricingSnapshot({
        previous: { source: 'EXTERNAL_SUBMIT_MANUAL_REQUIRED', actual: { amount: null, provisional: true } },
        now: new Date('2026-09-07T01:00:00Z'), actorId: 'admin-1', previousPriceRevision: 4, group: facts,
      }),
    });
    expect(buildAdminOrderDetailModel(input).orderFees[0]!.amount).toBe(subtotal);
    input.order.packagingGroups[0]!.actualBagCount = 101;
    expect(buildAdminOrderDetailModel(input).orderFees[0]!.amount).toBeNull();
  });

  it('preserves historical packaging amounts without inventing a new pending envelope', () => {
    const input = packagingFixture({ status: 'MANUAL_PRICING_REQUIRED', actual: { subtotal: '12.30' } }, '12.30');
    expect(buildAdminOrderDetailModel(input).orderFees[0]!.amount).toBe('12.30');
    input.workspace.fee = { amount: '12.30', source: 'LEGACY', estimated: false };
    expect(buildAdminOrderDetailModel(input).feeSource).toBe('LEGACY');
  });

  it('rejects cross-order or cross-revision snapshots before exposing any images', () => {
    for (const update of [{ id: 'other' }, { revision: 5 }, { workOrderVersion: 3 }, { editVersion: 4 }]) {
      const input = fixture();
      const sign = vi.fn(input.signImageUrl);
      expect(() => buildAdminOrderDetailModel({ ...input, workspace: { ...input.workspace, ...update }, signImageUrl: sign })).toThrow('版本已变化');
      expect(sign).not.toHaveBeenCalled();
    }
  });

  it('shows approved current-version differences and keeps pending requests out of the version banner', () => {
    const input = fixture();
    input.order.changeRequests = [change({ id: 'pending', status: 'PENDING', workOrderVersionAfter: null }), change()];
    const result = buildAdminOrderDetailModel(input);
    expect(result.vdiff).toMatchObject({ from: 1, to: 2, at: '2026/09/06 10:00' });
    expect(result.vdiff?.items).toEqual([{ id: 'change-1-0-quantity', label: '第 1 款 · 数量', before: '500', after: '1,000', targetItemId: 'item-1' }]);
    expect(result.changes).toHaveLength(2);
    expect(result.changes[1]).toMatchObject({ reviewer: '管理员', requester: '销售甲' });
    input.order.changeRequests = [change({ workOrderVersionAfter: 1 })];
    expect(buildAdminOrderDetailModel(input).vdiff).toBeNull();
  });

  it.each(['ADD', 'UPDATE'])('shows the blank target specification in %s approval differences', (operation) => {
    const input = fixture();
    const request = change({
      beforeSnapshot: { items: [{ id: 'item-1', sequence: 1, specification: '中号封80×115' }] },
      proposedChanges: { items: [{ operation, itemId: 'item-1', templateItemId: 'item-1',
        targetBlankIdentity: { paperType: '红卡', paperWeightGsm: 180, specification: '大号封90×165' } }] },
    });
    input.order.changeRequests = [request];
    const original = JSON.stringify(request.proposedChanges);
    expect(buildAdminOrderDetailModel(input).vdiff?.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: expect.stringContaining('规格'), after: '大号封90×165' }),
    ]));
    expect(JSON.stringify(request.proposedChanges)).toBe(original);
  });

  it('marks new items only when the approved snapshot proves they were absent', () => {
    const input = fixture();
    input.order.changeRequests = [change({ beforeSnapshot: { items: [] } })];
    expect(buildAdminOrderDetailModel(input).items[0]!.isNew).toBe(true);
    input.order.changeRequests = [change({ beforeSnapshot: {} })];
    expect(buildAdminOrderDetailModel(input).items[0]!.isNew).toBe(false);
  });

  it('locates added styles and delivery-date changes in their actual sections', () => {
    const input = fixture();
    input.order.changeRequests = [change({
      beforeSnapshot: { promisedDate: '2026-09-09', items: [] },
      proposedChanges: { promisedDate: '2026-09-10', items: [{ operation: 'ADD', name: '新款', quantity: 2000 }] },
    })];
    const changes = buildAdminOrderDetailModel(input).vdiff?.items;
    expect(changes?.[0]).toMatchObject({ label: '承诺交期', targetItemId: null, targetSection: 'overview' });
    expect(changes?.slice(1).map((row) => ({ targetItemId: row.targetItemId, targetSection: row.targetSection }))).toEqual([
      { targetItemId: null, targetSection: 'items' }, { targetItemId: null, targetSection: 'items' },
    ]);
  });

  it('does not distribute cross-item payroll lanes and sums only addressed progress with carry', () => {
    const input = fixture();
    input.productionOperations = [{ id: 'lane', carriedCompletedQty: new Decimal('100'), sources: [{ orderItemId: 'item-1' }, { orderItemId: 'item-2' }] }] as unknown as NonNullable<AdminOrderDetailInput['productionOperations']>;
    expect(buildAdminOrderDetailModel(input).items[0]!.progress).toEqual([]);
    input.productionProgressSteps = [{ id: 'step', orderItemId: 'item-1', craftName: '清废', plannedQty: new Decimal('1000'), carriedCompletedQty: new Decimal('100'), reports: [{ completedQty: new Decimal('200') }, { completedQty: new Decimal('300') }] }] as unknown as NonNullable<AdminOrderDetailInput['productionProgressSteps']>;
    expect(buildAdminOrderDetailModel(input).items[0]!.progress).toEqual([{ label: '清废', done: '600', total: '1000', unit: '个' }]);
  });

  it('keeps only current-version work reports without inventing a cumulative total', () => {
    const input = fixture();
    input.workReports = [
      { id: 'old', reportedAt: new Date('2026-09-06T01:00:00Z'), reporterName: '师傅甲', stage: 'FOILING', quantity: '999', workOrderVersion: 1 },
      { id: 'current', reportedAt: new Date('2026-09-07T01:00:00Z'), reporterName: '师傅甲', stage: 'FOILING', quantity: new Decimal('200'), workOrderVersion: 2 },
    ];
    expect(buildAdminOrderDetailModel(input).works).toEqual([{ id: 'current', at: '2026/09/07 09:00', actor: '师傅甲', label: '烫金报工', quantity: '200', cumulative: null, unit: '个' }]);
  });

  it('does not duplicate linked plate charges or show waived replacement charges as payable', () => {
    const input = fixture();
    input.order.customerCharges = [
      { id: 'plate-charge', businessKey: 'PLATE_DETAIL:plate-1', status: 'FINAL', amount: new Decimal('0'), category: { name: '制版费' }, shipment: null },
      { id: 'old-plate', businessKey: 'PLATE_PENDING', status: 'WAIVED', amount: new Decimal('0'), category: { name: '旧暂估版费' }, shipment: null },
      { id: 'shipping', businessKey: 'SHIPPING:1', status: 'FINAL', amount: new Decimal('20.05'), category: { name: '运费' }, shipment: { sequence: 1 } },
    ] as unknown as AdminOrderDetailInput['order']['customerCharges'];
    expect(buildAdminOrderDetailModel(input).orderFees).toEqual([
      { id: 'packaging', label: '包装费', amount: '0.00' },
      { id: 'shipping', label: '运费 · 第 1 票', amount: '20.05' },
    ]);
  });

  it('keeps missing data empty instead of fabricating designs, shipping or zero fees', () => {
    const input = fixture();
    input.order.items = [];
    input.workspace.fee = { amount: null, source: 'INCOMPLETE', estimated: false };
    const result = buildAdminOrderDetailModel(input);
    expect(result).toMatchObject({ total: null, items: [], works: [], logs: [], shipments: [], changes: [], vdiff: null });
  });
});


describe('list/detail delivery and craft consistency', () => {
  it('preserves canonical crafts when dictionary labels are missing and omits distant countdowns', () => {
    const input = fixture();
    input.workspace.craftTags = ['专版烫金', '彩印'];
    input.workspace.promisedDate = '2099-12-31';
    input.workspace.promisedDaysLeft = 26777;
    input.workspace.dueAlert = null;
    input.order.items[0]!.craft = 'PRINT';
    input.order.items[0]!.craftNames = [];
    const model = buildAdminOrderDetailModel(input);
    expect(model.craft).toBe('专版烫金 · 彩印');
    expect(model.items[0]!.specs[0]!.value).toBe('彩印');
    expect(model.due).toBe('2099-12-31');
    expect(model.dueLeft).toBe('');
  });
  it('uses the same imminent and overdue delivery labels as the list', () => {
    const input = fixture();
    input.workspace.dueAlert = { kind: 'due-soon', days: 1 };
    expect(buildAdminOrderDetailModel(input).dueLeft).toBe('明天到期');
    input.workspace.dueAlert = { kind: 'overdue', days: 2 };
    expect(buildAdminOrderDetailModel(input).dueLeft).toBe('逾期 2 天');
  });
});


it('keeps the order-level note separate from style notes', () => {
  const input = fixture();
  input.order.remark = '先核对样稿\n再安排生产';
  expect(buildAdminOrderDetailModel(input).remark).toBe(input.order.remark);
});
