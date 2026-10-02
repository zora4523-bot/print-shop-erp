import { describe, expect, it } from 'vitest';
import { BATCH_COMMAND_CONFIG, batchConfirmationImpact, batchFailureReason, batchReceiptRows, snapshotBatchSelection } from '../admin-order-batch-ui';
import { batchOrder, batchSelection } from './admin-order-batch-fixture';

describe('admin batch review and receipts', () => {
  it('uses server capabilities and retains reviewed versions', () => {
    const released = batchOrder();
    const pending = batchOrder({ id: 'order-2', orderNo: 'GD-260907-002', capabilities: { ...released.capabilities, release: false } });
    const snapshot = snapshotBatchSelection('RELEASE_AND_CREATE_PRINT', batchSelection([released, pending]), [released, pending]);
    released.revision = 9;
    expect(snapshot.map((order) => order.eligible)).toEqual([true, false]);
    expect(snapshot[0].revision).toBe(4);
    // 业主 2026-10-02：点「打印」即记已打印，批量操作里不再有「确认已打印」。
    expect(Object.keys(BATCH_COMMAND_CONFIG)).not.toContain('MARK_PRINTED');
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
  it('lists the production owners for batch completion and keeps curated completion refusals', () => {
    const baseline = batchOrder();
    const order = batchOrder({ capabilities: { ...baseline.capabilities, completeProduction: true }, productionOwners: ['王师傅', '李师傅'] });
    const reviewed = snapshotBatchSelection('COMPLETE_PRODUCTION', batchSelection([order]), [order]);
    expect(batchConfirmationImpact('COMPLETE_PRODUCTION', reviewed).join(' ')).toContain('师傅：王师傅、李师傅');
    const rows = batchReceiptRows('COMPLETE_PRODUCTION', reviewed, { status: 'success', result: { command: 'COMPLETE_PRODUCTION', successCount: 0, skippedCount: 1, failedCount: 0, notAttemptedCount: 0,
      items: [{ orderId: order.id, status: 'skipped', code: 'WORKER_UNAVAILABLE', message: '王师傅 今天不在雇佣期，请先改派生产任务' }] } });
    expect(rows[0]).toMatchObject({ outcome: 'skipped', reason: '王师傅 今天不在雇佣期，请先改派生产任务' });
  });
});
