import { describe, expect, it } from 'vitest';
import { batchConfirmationImpact, batchFailureReason, batchReceiptRows, snapshotBatchSelection } from '../admin-order-batch-ui';
import { batchOrder, batchSelection } from './admin-order-batch-fixture';

describe('admin batch review and receipts', () => {
  it('uses server capabilities, rejects missing print identity and retains reviewed versions', () => {
    const released = batchOrder();
    const pending = batchOrder({ id: 'order-2', orderNo: 'GD-260907-002', capabilities: { ...released.capabilities, release: false } });
    const snapshot = snapshotBatchSelection('RELEASE_AND_CREATE_PRINT', batchSelection([released, pending]), [released, pending]);
    released.revision = 9;
    expect(snapshot.map((order) => order.eligible)).toEqual([true, false]);
    expect(snapshot[0].revision).toBe(4);
    const printable = batchOrder({ capabilities: { ...released.capabilities, markPrinted: true } });
    expect(snapshotBatchSelection('MARK_PRINTED', batchSelection([printable]), [printable])[0]).toMatchObject({ eligible: false, reason: '没有当前版待打印任务，请刷新后检查打印记录' });
  });

  it('shows an exact decimal settlement total and omits ineligible amounts', () => {
    const baseline = batchOrder();
    const orders = ['0.10', '0.20', '999.99'].map((amount, index) => batchOrder({
      id: `order-${index}`, orderNo: `GD-${index}`,
      capabilities: { ...baseline.capabilities, settle: index < 2 },
      feeStages: { ...baseline.feeStages, confirmed: amount },
    }));
    const impact = batchConfirmationImpact('SETTLE', snapshotBatchSelection('SETTLE', batchSelection(orders), orders));
    expect(impact).toContain('本次结算合计 ¥ 0.30');
    expect(impact.join(' ')).not.toContain('999.99');
    expect(impact.join(' ')).toContain('GD-2：本次不处理');
  });

  it('retains every result and replaces technical messages with actionable business text', () => {
    const orders = Array.from({ length: 5 }, (_, index) => batchOrder({ id: `order-${index}`, orderNo: `GD-${index}` }));
    const reviewed = snapshotBatchSelection('RELEASE_AND_CREATE_PRINT', batchSelection(orders), orders);
    const rows = batchReceiptRows('RELEASE_AND_CREATE_PRINT', reviewed, {
      status: 'partial_failure', message: 'INTERNAL_TOKEN',
      result: { command: 'RELEASE_AND_CREATE_PRINT', successCount: 1, skippedCount: 2, failedCount: 1, notAttemptedCount: 1,
        items: [
          { orderId: 'order-0', status: 'success', code: 'OK' },
          { orderId: 'order-1', status: 'skipped', code: 'INVALID_STATUS', message: 'PENDING_FACTORY' },
          { orderId: 'order-2', status: 'skipped', code: 'NEW_INTERNAL_CODE', message: 'secret_field' },
          { orderId: 'order-3', status: 'failed', code: 'UNEXPECTED_ERROR', message: 'DB_COLUMN' },
          { orderId: 'order-4', status: 'not_attempted', code: 'ABORTED_AFTER_FAILURE', message: 'ABORTED' },
        ] },
    });
    expect(rows.map((row) => row.outcome)).toEqual(['success', 'skipped', 'skipped', 'unknown', 'not-attempted']);
    expect(rows.every((row) => row.reason.length > 0)).toBe(true);
    expect(JSON.stringify(rows)).not.toMatch(/INTERNAL_TOKEN|PENDING_FACTORY|NEW_INTERNAL_CODE|secret_field|DB_COLUMN|ABORTED/);
    expect(rows[3].reason).toContain('不要直接重复提交');
  });

  it('does not report a transport failure as a confirmed failure or zero applied writes', () => {
    const orders = [batchOrder()];
    expect(batchReceiptRows('RELEASE_AND_CREATE_PRINT', snapshotBatchSelection('RELEASE_AND_CREATE_PRINT', batchSelection(orders), orders), null)[0].outcome).toBe('unknown');
    expect(batchFailureReason('UNKNOWN')).toContain('打开工单');
  });
});
