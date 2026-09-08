vi.mock('@/lib/order/production-readiness', () => ({ prepareOrderForProductionInTx: vi.fn().mockResolvedValue({ ready: true, status: 'CONFIRMED', issues: [] }) }));
import Decimal from 'decimal.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrderStatus, Role } from '@/generated/prisma/enums';
import { adminOrderEditSchema } from '../admin-edit-schema';
import type { AdminOrderEditCommand, AdminOrderEditInput } from '../admin-edit-schema';
vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  find: vi.fn(),
  lock: vi.fn(),
  update: vi.fn(),
  create: vi.fn(),
  preview: vi.fn(),
  review: vi.fn(),
  dispatch: vi.fn(),
}));
vi.mock('@/lib/db', () => ({ db: { $transaction: mocks.transaction } }));
vi.mock('@/lib/order', () => ({
  updateOrderFields: mocks.update,
  OrderInvariantError: class extends Error {},
}));
vi.mock('../change-request', () => ({
  createOrderChangeRequest: mocks.create,
  previewOrderChangeRequestPricing: mocks.preview,
  reviewOrderChangeRequest: mocks.review,
}));
vi.mock('@/lib/production-completion', () => ({
  dispatchProductionCompletionNotification: mocks.dispatch,
}));
import { editAdminOrder } from '../admin-edit';
const tx = { $executeRaw: mocks.lock, order: { findUnique: mocks.find } };
const input = (): AdminOrderEditCommand => ({
  orderId: 'order-1',
  requestId: '00000000-0000-4000-8000-000000000001',
  expectedRevision: 2,
  expectedWorkOrderVersion: 1,
  fields: { expectedEditVersion: 7, remark: '修改备注' },
  items: [{ operation: 'UPDATE', itemId: 'item-1', quantity: 2000 }],
  pendingChargeResolutions: [],
  expectedQuoteToken: 'quote-v1',
  expectedPriceRevision: 3,
});
const admin = { id: 'admin', role: Role.ADMIN };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.transaction.mockImplementation(async (work) => work(tx));
  mocks.find.mockResolvedValue({
    status: OrderStatus.DRAFT,
    editVersion: 7,
    revision: 2,
    workOrderVersion: 1,
    priceRevision: 3,
    totalAmount: new Decimal('200.00'),
    promisedDate: null,
  });
  mocks.create.mockResolvedValue({ id: input().requestId });
  mocks.preview.mockResolvedValue({
    oldTotal: '200.00',
    newTotal: '300.00',
    quoteToken: 'quote-v1',
    priceRevision: 3,
    complete: true,
    pendingCharges: [],
  });
  mocks.review.mockResolvedValue({ status: 'APPROVED' });
});
describe('atomic administrator edit', () => {
  it('parses the browser command through the original form token contract', () => {
    const raw: AdminOrderEditInput = {
      ...input(),
      fields: { expectedEditVersion: '0', remark: '修改备注' },
    };
    expect(adminOrderEditSchema.parse(raw).fields).toEqual({
      expectedEditVersion: 0,
      remark: '修改备注',
    });
    expect(
      adminOrderEditSchema.safeParse({
        ...raw,
        fields: { expectedEditVersion: '1e3' },
      }).success,
    ).toBe(false);
  });

  it.each(['2026-02-29', '2026-02-31', '2026-13-01', '09/20/2026'])(
    'rejects invalid business dates before entering an edit transaction: %s',
    (promisedDate) => {
      const result = adminOrderEditSchema.safeParse({
        ...input(), fields: { expectedEditVersion: '7' }, promisedDate,
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues).toContainEqual(expect.objectContaining({
          path: ['promisedDate'],
          message: '请填写有效的承诺交期',
        }));
      }
    },
  );

  it.each(['2028-02-29', null, undefined])(
    'preserves valid date, clear and omitted date semantics: %s',
    (promisedDate) => {
      expect(adminOrderEditSchema.parse({
        ...input(), fields: { expectedEditVersion: '7' }, promisedDate,
      }).promisedDate)
        .toBe(promisedDate);
    },
  );

  it('rejects non-admin before reading or writing', async () => {
    await expect(
      editAdminOrder(input(), { ...admin, role: Role.SALES }, 'save'),
    ).rejects.toThrow('只有管理员');
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it('allows a new style in a draft where design uploads remain available', async () => {
    const data = input();
    data.items = [{ operation: 'ADD', templateItemId: 'item-1', name: '新款', quantity: 1000 }];
    await editAdminOrder(data, admin, 'preview');
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ items: data.items }), admin, expect.anything());
  });
  it.each([OrderStatus.PENDING_FACTORY, OrderStatus.CONFIRMED])('rejects a new style after submission before any write: %s', async (status) => {
    const before = await mocks.find();
    mocks.find.mockResolvedValue({ ...before, status });
    const data = input();
    data.items = [{ operation: 'ADD', templateItemId: 'item-1', name: '新款', quantity: 1000 }];
    await expect(editAdminOrder(data, admin, 'save')).rejects.toThrow('仅草稿工单支持');
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('preview rolls its callback back and never approves or dispatches', async () => {
    let rollback = false;
    mocks.transaction.mockImplementation(async (work) => {
      try {
        return await work(tx);
      } catch (error) {
        rollback = true;
        throw error;
      }
    });
    expect(await editAdminOrder(input(), admin, 'preview')).toMatchObject({
      newTotal: '300.00',
      changesRevision: true,
    });
    expect(rollback).toBe(true);
    expect(mocks.review).not.toHaveBeenCalled();
    expect(mocks.dispatch).not.toHaveBeenCalled();
    expect(mocks.update).toHaveBeenCalledWith(
      'order-1',
      input().fields,
      admin,
      tx,
    );
  });
  it('shares one transaction across metadata, amendment, quote and approval', async () => {
    await editAdminOrder(input(), admin, 'save');
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.create.mock.calls[0][2].tx).toBe(tx);
    expect(mocks.preview.mock.calls[0][3].tx).toBe(tx);
    expect(mocks.review.mock.calls[0][2].tx).toBe(tx);
    expect(mocks.review.mock.calls[0][0]).toMatchObject({
      expectedQuoteToken: 'quote-v1',
      expectedPriceRevision: 3,
    });
  });
  it('passes the same manual freight evidence to preview and approval', async () => {
    const data = input();
    data.pendingChargeResolutions = [
      {
        businessKey: 'SHIPMENT:1:SHIPPING_FEE',
        shipmentId: 'shipment-1',
        expectedSequence: 1,
        expectedProjectedQuantity: 2000,
        expectedDestinationProvince: '广东',
        amount: '30.00',
        reason: '物流商报价单',
      },
    ];
    await editAdminOrder(data, admin, 'save');
    expect(mocks.preview.mock.calls[0][2]).toEqual({
      pendingChargeResolutions: data.pendingChargeResolutions,
    });
    expect(mocks.review.mock.calls[0][0].pendingChargeResolutions).toEqual(
      data.pendingChargeResolutions,
    );
  });
  it('rejects changed edit version before any write', async () => {
    mocks.find.mockResolvedValueOnce({ editVersion: 8 });
    await expect(editAdminOrder(input(), admin, 'save')).rejects.toThrow(
      '其他人修改',
    );
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it('rejects manual freight for metadata-only edits before writing', async () => {
    const data = input();
    data.items = [];
    data.pendingChargeResolutions = [
      {
        businessKey: 'SHIPMENT:1:SHIPPING_FEE',
        shipmentId: 'shipment-1',
        expectedSequence: 1,
        expectedProjectedQuantity: 2000,
        expectedDestinationProvince: '广东',
        amount: '30.00',
        reason: '物流商报价单',
      },
    ];
    await expect(editAdminOrder(data, admin, 'save')).rejects.toThrow(
      '未修改款式',
    );
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it('does not approve stale or incomplete quotes and propagates rollback', async () => {
    mocks.preview.mockResolvedValueOnce({
      oldTotal: '200.00',
      newTotal: null,
      quoteToken: 'new-token',
      priceRevision: 4,
      complete: false,
      pendingCharges: [{ amount: null }],
    });
    await expect(editAdminOrder(input(), admin, 'save')).rejects.toThrow(
      '计价条件已变化',
    );
    expect(mocks.review).not.toHaveBeenCalled();
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });
  it('metadata-only edits preserve fees without creating a versioned amendment', async () => {
    const data = input();
    data.items = [];
    expect(await editAdminOrder(data, admin, 'preview')).toMatchObject({
      oldTotal: '200.00',
      newTotal: '200.00',
      changesRevision: false,
    });
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('date-only changes use the existing date approval path', async () => {
    const data = input();
    data.items = [];
    data.promisedDate = '2026-10-20';
    await editAdminOrder(data, admin, 'preview');
    expect(mocks.create.mock.calls[0][0]).toMatchObject({
      items: [],
      modifyKind: 'DUE_DATE',
      promisedDate: new Date('2026-10-20'),
    });
  });
  it('approval failure aborts the entire edit and dispatches no notifications', async () => {
    mocks.review.mockRejectedValueOnce(new Error('生产记录已变化'));
    await expect(editAdminOrder(input(), admin, 'save')).rejects.toThrow(
      '生产记录已变化',
    );
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });
});
