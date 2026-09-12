import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { OrderStatus } from '@/generated/prisma/enums';
import type { AdminOrderWorkspaceRow } from '@/lib/order/admin-workspace';
import type { CancellationSettlementReference } from '@/lib/order/change-request';
import '@/app/globals.css';
import { Button } from '@/components/ui/button';

const actions = vi.hoisted(() => ({
  confirm: vi.fn(), release: vi.fn(), settle: vi.fn(), hold: vi.fn(), resume: vi.fn(), reject: vi.fn(),
  preview: vi.fn(), review: vi.fn(), refresh: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: actions.refresh }) }));
vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ prefetch, ...props }: ComponentProps<'a'> & { prefetch?: boolean }) => {
    void prefetch;
    return <a {...props} />;
  },
}));
vi.mock('@/actions/admin-order-workflow', () => ({
  confirmFactoryOrderAction: actions.confirm, releaseFactoryOrderAction: actions.release,
  settleFactoryOrderAction: actions.settle, holdFactoryOrderAction: actions.hold,
  resumeFactoryOrderAction: actions.resume, rejectFactoryOrderAction: actions.reject,
  runAdminOrderBatchAction: vi.fn(),
}));
vi.mock('@/actions/order', () => ({
  previewOrderCancellationSettlementAction: actions.preview,
  reviewOrderChangeRequestAction: actions.review,
  previewOrderChangeRequestPricingAction: vi.fn(),
}));
vi.mock('@/generated/prisma/client', async () => ({
  ...await import('@/generated/prisma/enums'), Prisma: { Decimal: (await import('decimal.js')).default },
}));
vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('@/components/business/order/AdminOrderInlineOperations', () => ({
  AdminOrderInlineOperations: ({ order, onCompleted }: {
    order: AdminOrderWorkspaceRow;
    onCompleted?: (message: string) => void;
  }) => order.inlineOperations ? <Button type="button" onClick={() => onCompleted?.(order.inlineOperations?.pricing ? '核价已确认' : '工单已发货')}>完成内联操作</Button> : null,
}));

import { AdminOrderDecisionPanel } from '../AdminOrderDecisionPanel';

let host: HTMLDivElement;
let root: Root;
const reference: CancellationSettlementReference = {
  referenceSettleFee: '100.00', calculation: 'CURRENT_PUBLISHED_ENGINE_V1',
  components: { itemProcessing: '100.00', bagging: '0.00', carton: '0.00', preservedManualCharges: '0.00', shipping: '0.00' },
  allocation: [{ orderItemId: 'item-1', producedQty: 100 }],
  priceVersions: { processing: null, logistics: null },
};

beforeEach(async () => {
  vi.clearAllMocks();
  await page.viewport(1280, 900);
  document.documentElement.lang = 'zh-CN';
  host = document.createElement('div');
  host.className = 'admin-viewport p-5';
  document.body.append(host);
  root = createRoot(host);
  for (const action of [actions.confirm, actions.release, actions.settle, actions.hold, actions.resume, actions.reject]) {
    action.mockResolvedValue({ status: 'success', orderId: 'order-1' });
  }
  actions.preview.mockResolvedValue({ status: 'success', preview: reference });
  actions.review.mockResolvedValue({ status: 'success', requestStatus: 'CANCELLED', orderId: 'order-1' });
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
});

function renderOrder(order = cancellationOrder()) {
  flushSync(() => root.render(<AdminOrderDecisionPanel order={order} compact />));
}
async function prepareCancellation() {
  renderOrder();
  await page.getByRole('button', { name: '批准取消', exact: true }).click();
  await page.getByRole('spinbutton', { name: '已产数量', exact: true }).fill('100');
  await page.getByRole('button', { name: '计算参考价', exact: true }).click();
  await expect.element(page.getByRole('textbox', { name: '最终结算金额', exact: true })).toHaveValue('100.00');
}

describe('admin order decisions require review before mutation', () => {
  it('cancellation cannot submit without a quantity preview, explicit amount and adjustment reason', async () => {
    renderOrder();
    await page.getByRole('button', { name: '批准取消', exact: true }).click();
    const submit = page.getByRole('button', { name: '确认取消并结算工单', exact: true });
    await expect.element(submit).toBeDisabled();
    await page.getByRole('spinbutton', { name: '已产数量' }).fill('100');
    await expect.element(submit).toBeDisabled();
    expect(actions.review).not.toHaveBeenCalled();
    await page.getByRole('button', { name: '计算参考价' }).click();
    const amount = page.getByRole('textbox', { name: '最终结算金额', exact: true });
    await expect.element(amount).toHaveValue('100.00');
    await amount.fill('');
    await expect.element(submit).toBeDisabled();
    await amount.fill('120.00');
    await expect.element(submit).toBeDisabled();
    await page.getByRole('textbox', { name: '结算调整原因' }).fill('客户确认的人工调整');
    await expect.element(submit).toBeEnabled();
    await submit.click();
    const dialog = page.getByRole('alertdialog');
    await expect.element(dialog).toBeVisible();
    await expect.element(dialog.getByText('核实已产数量 100 个，最终结算金额 ¥ 120.00。', { exact: true })).toBeVisible();
    expect(actions.review).not.toHaveBeenCalled();
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
    await expect.element(page.getByRole('alertdialog')).not.toBeInTheDocument();
    expect(actions.review).not.toHaveBeenCalled();
    await submit.click();
    await page.getByRole('alertdialog').getByRole('button', { name: '确认取消并结算工单', exact: true }).click();
    await expect.poll(() => actions.review.mock.calls.length).toBe(1);
    expect(actions.review).toHaveBeenCalledWith(null, expect.objectContaining({
      requestId: 'cancel-request-1', decision: 'APPROVE', producedQty: 100,
      settleFee: '120.00', settleFeeAdjustmentReason: '客户确认的人工调整',
    }));
  });

  it('changing quantity clears its old preview even when changed back, and a failed preview stays blocked', async () => {
    await prepareCancellation();
    const quantity = page.getByRole('spinbutton', { name: '已产数量' });
    const amount = page.getByRole('textbox', { name: '最终结算金额', exact: true });
    await quantity.fill('200');
    await expect.element(amount).toHaveValue('');
    await expect.element(amount).toBeDisabled();
    await quantity.fill('100');
    await expect.element(page.getByRole('button', { name: '确认取消并结算工单', exact: true })).toBeDisabled();
    actions.preview.mockResolvedValue({ status: 'error', message: '当前价格缺少规则' });
    await page.getByRole('button', { name: '计算参考价' }).click();
    await expect.element(page.getByRole('alert')).toHaveTextContent('当前价格缺少规则');
    await expect.element(page.getByRole('button', { name: '确认取消并结算工单', exact: true })).toBeDisabled();
    expect(actions.review).not.toHaveBeenCalled();
  });

  it('a refreshed order version discards the previous cancellation draft and preview', async () => {
    await prepareCancellation();
    const updated = cancellationOrder();
    updated.revision += 1;
    renderOrder(updated);
    await page.getByRole('button', { name: '批准取消', exact: true }).click();
    await expect.element(page.getByRole('spinbutton', { name: '已产数量' })).toHaveValue(null);
    await expect.element(page.getByRole('textbox', { name: '最终结算金额', exact: true })).toHaveValue('');
    await expect.element(page.getByRole('button', { name: '确认取消并结算工单', exact: true })).toBeDisabled();
  });

  it('locks preview inputs while pending and ignores a response from an earlier order version', async () => {
    let finish!: (result: { status: 'success'; preview: CancellationSettlementReference }) => void;
    actions.preview.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    renderOrder();
    await page.getByRole('button', { name: '批准取消', exact: true }).click();
    await page.getByRole('spinbutton', { name: '已产数量' }).fill('100');
    await page.getByRole('button', { name: '计算参考价', exact: true }).click();
    await expect.element(page.getByRole('spinbutton', { name: '已产数量' })).toBeDisabled();
    await expect.element(page.getByRole('button', { name: '计算参考价', exact: true })).toBeDisabled();
    await expect.element(page.getByRole('textbox', { name: '裁决说明' })).toBeDisabled();
    await expect.element(page.getByRole('button', { name: '提交中…', exact: true })).toBeDisabled();

    const updated = cancellationOrder();
    updated.workOrderVersion += 1;
    renderOrder(updated);
    await page.getByRole('button', { name: '批准取消', exact: true }).click();
    await page.getByRole('spinbutton', { name: '已产数量' }).fill('200');
    finish({ status: 'success', preview: reference });
    await expect.element(page.getByRole('spinbutton', { name: '已产数量' })).toHaveValue(200);
    await expect.element(page.getByRole('textbox', { name: '最终结算金额', exact: true })).toHaveValue('');
    await expect.element(page.getByRole('button', { name: '确认取消并结算工单', exact: true })).toBeDisabled();
    expect(host.textContent).not.toContain('引擎参考价');
    expect(actions.review).not.toHaveBeenCalled();

    const nextReference = { ...reference, referenceSettleFee: '200.00' };
    actions.preview.mockResolvedValueOnce({ status: 'success', preview: nextReference });
    await page.getByRole('button', { name: '计算参考价', exact: true }).click();
    await expect.element(page.getByRole('textbox', { name: '最终结算金额', exact: true })).toHaveValue('200.00');
    expect(actions.preview).toHaveBeenLastCalledWith(null, { requestId: 'cancel-request-1', producedQty: 200 });
  });

  it('a failed refresh invalidates an earlier successful preview for the same quantity', async () => {
    await prepareCancellation();
    actions.preview.mockResolvedValueOnce({ status: 'error', message: '参考价暂时无法计算' });
    await page.getByRole('button', { name: '计算参考价', exact: true }).click();
    await expect.element(page.getByRole('alert')).toHaveTextContent('参考价暂时无法计算');
    await expect.element(page.getByRole('textbox', { name: '最终结算金额', exact: true })).toHaveValue('');
    await expect.element(page.getByRole('button', { name: '确认取消并结算工单', exact: true })).toBeDisabled();
    expect(actions.review).not.toHaveBeenCalled();
  });

  it.each([
    { action: 'release', status: OrderStatus.PENDING_FACTORY, trigger: '下发生产', confirm: '确认下发生产' },
    { action: 'release', status: OrderStatus.CONFIRMED, trigger: '下发生产', confirm: '确认下发生产' },
    { action: 'settle', status: OrderStatus.SHIPPED, trigger: '结算', confirm: '结算' },
  ] as const)('$action waits for impact confirmation before writing', async ({ action, status, trigger, confirm }) => {
    const order = baseOrder();
    order.status = status;
    order.capabilities[action] = true;
    renderOrder(order);
    await page.getByRole('region', { name: '待你处理' }).getByRole('button', { name: trigger, exact: true }).click();
    await expect.element(page.getByRole('alertdialog')).toBeVisible();
    expect(actions[action]).not.toHaveBeenCalled();
    await page.getByRole('alertdialog').getByRole('button', { name: '取消', exact: true }).click();
    expect(actions[action]).not.toHaveBeenCalled();
    await page.getByRole('region', { name: '待你处理' }).getByRole('button', { name: trigger, exact: true }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: confirm, exact: true }).click();
    await expect.poll(() => actions[action].mock.calls.length).toBe(1);
    await expect.element(page.getByRole('status')).toHaveTextContent('操作已完成，工单已更新。');
    const refreshed = baseOrder();
    refreshed.revision = order.revision + 1;
    renderOrder(refreshed);
    await expect.element(page.getByRole('status')).toHaveTextContent('操作已完成，工单已更新。');
    expect(host.querySelector('[data-slot="admin-order-decision-panel"]')).toBeNull();
    renderOrder({ ...refreshed, id: 'another-order' });
    expect(host.textContent).not.toContain('操作已完成，工单已更新。');
  });

  it.each([
    { action: 'reject', trigger: '驳回', label: '确认驳回工单' },
    { action: 'hold', trigger: '暂停', label: '确认暂停工单' },
    { action: 'resume', trigger: '恢复生产', label: '确认恢复生产' },
  ] as const)('$action confirms the existing reason without asking for a new server field', async ({ action, trigger, label }) => {
    const order = baseOrder();
    order.capabilities[action] = true;
    renderOrder(order);
    await page.getByRole('region', { name: '待你处理' }).getByRole('button', { name: trigger, exact: true }).click();
    await expect.element(page.getByRole('button', { name: label, exact: true })).toBeDisabled();
    await page.getByRole('textbox', { name: '裁决说明' }).fill('已与客户核对本次处理依据');
    await page.getByRole('button', { name: label, exact: true }).click();
    const dialog = page.getByRole('alertdialog');
    await expect.element(dialog).toHaveTextContent('已与客户核对本次处理依据');
    expect(dialog.element().querySelector('textarea')).toBeNull();
    expect(actions[action]).not.toHaveBeenCalled();
    await dialog.getByRole('button', { name: label, exact: true }).click();
    await expect.poll(() => actions[action].mock.calls.length).toBe(1);
    expect(actions[action].mock.calls[0][0]).toMatchObject(action === 'resume'
      ? { recoveryEvidence: { resolution: '已与客户核对本次处理依据' } }
      : { reasonNote: '已与客户核对本次处理依据' });
  });

  it('shows pending and failed results visibly while a confirmed action is running', async () => {
    let finish!: (result: { status: 'error'; message: string }) => void;
    actions.release.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const order = baseOrder();
    order.capabilities.release = true;
    renderOrder(order);
    await page.getByRole('button', { name: '下发生产', exact: true }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: '确认下发生产', exact: true }).click();
    expect(actions.release).toHaveBeenCalledWith(expect.objectContaining({ createPrint: false }));
    await expect.element(page.getByText('正在处理，请稍候…', { exact: true })).toBeVisible();
    finish({ status: 'error', message: '工单版本已变化，请刷新后重试。' });
    await expect.element(page.getByRole('alert')).toHaveTextContent('工单版本已变化');
    await expect.element(page.getByRole('alert')).toBeVisible();
  });

  it('confirms and submits the edited existing reason after dismissing an earlier confirmation', async () => {
    const order = baseOrder();
    order.capabilities.hold = true;
    renderOrder(order);
    await page.getByRole('button', { name: '暂停', exact: true }).click();
    const note = page.getByRole('textbox', { name: '裁决说明' });
    await note.fill('待补客户文件');
    await page.getByRole('button', { name: '确认暂停工单', exact: true }).click();
    await expect.element(page.getByRole('alertdialog')).toHaveTextContent('待补客户文件');
    await page.getByRole('alertdialog').getByRole('button', { name: '取消', exact: true }).click();
    await expect.element(page.getByRole('alertdialog')).not.toBeInTheDocument();
    expect(actions.hold).not.toHaveBeenCalled();
    await note.fill('已收到文件，等待客户确认颜色');
    await page.getByRole('button', { name: '确认暂停工单', exact: true }).click();
    const dialog = page.getByRole('alertdialog');
    await expect.element(dialog).toHaveTextContent('已收到文件，等待客户确认颜色');
    expect(dialog.element().textContent).not.toContain('待补客户文件');
    await dialog.getByRole('button', { name: '确认暂停工单', exact: true }).click();
    await expect.poll(() => actions.hold.mock.calls.length).toBe(1);
    expect(actions.hold.mock.calls[0][0]).toMatchObject({ reasonNote: '已收到文件，等待客户确认颜色' });
  });

  it('keeps the shipping blocker and recovery path visible without an enabled shipping action', () => {
    const order = baseOrder();
    order.status = OrderStatus.PACKING;
    order.shipDisabledReason = '仍有生产工序未完成';
    renderOrder(order);
    expect(host.textContent).toContain('暂不能发货：仍有生产工序未完成');
    expect(host.querySelector('a[href="/orders/order-1#ship-order"]')).not.toBeNull();
  });

  it.each(['pricing', 'shipping'] as const)('keeps the %s receipt when the refreshed version removes inline operations', async (kind) => {
    const order = baseOrder();
    order.capabilities.hold = true;
    order.inlineOperations = { pricing: kind === 'pricing' ? 'factory' : null, shipping: null, fulfillment: null };
    renderOrder(order);
    await page.getByRole('button', { name: '完成内联操作', exact: true }).click();
    const text = kind === 'pricing' ? '核价已确认' : '工单已发货';
    await expect.element(page.getByRole('status')).toHaveTextContent(text);
    renderOrder({ ...baseOrder(), revision: order.revision + 1, inlineOperations: null });
    await expect.element(page.getByRole('status')).toHaveTextContent(text);
    expect(host.querySelector('[data-slot="admin-order-decision-panel"]')).toBeNull();
    renderOrder({ ...baseOrder(), id: 'another-order' });
    expect(host.textContent).not.toContain(text);
  });
});

function cancellationOrder(): AdminOrderWorkspaceRow {
  return { ...baseOrder(),
    capabilities: { ...baseOrder().capabilities, reviewChange: true },
    pendingChangeRequest: { id: 'cancel-request-1', type: 'CANCEL', reason: '客户取消', createdAt: '2026-09-07T01:00:00.000Z' },
  };
}
function baseOrder(): AdminOrderWorkspaceRow {
  return {
    id: 'order-1', orderNo: 'GD-260907-001', revision: 2, workOrderVersion: 1,
    customName: '春节红包', customer: { id: 'customer-1', name: '客户甲', filterValue: '客户甲' },
    submitter: { id: 'sales-1', name: '业务员甲' }, status: OrderStatus.CONFIRMED,
    statusSummary: null, isUrgent: false, isStarred: false,
    createdAt: '2026-09-07T01:00:00.000Z', submittedAt: '2026-09-07T01:00:00.000Z',
    promisedDate: '2026-09-10', dueAlert: null, itemCount: 1, totalQuantity: 1000,
    craftSummary: '烫金', thumbnail: null, items: [],
    fee: { amount: '1000.00', source: 'CONFIRMED', estimated: false },
    feeStages: { quoted: '1000.00', confirmed: '1000.00', settled: null, active: 'CONFIRMED' },
    priceComparison: {
      quoted: { amount: '1000.00', versions: { processing: null, logistics: null } },
      current: { amount: '1000.00', versions: { processing: null, logistics: null } },
      quoteToken: `create-order-quote-v2:${'a'.repeat(64)}`, hasVersionDiff: false,
    },
    priceComparisonError: null, confirmationPreflight: { ok: true, issues: [] },
    capabilities: { confirm: false, reject: false, hold: false, resume: false, release: false, ship: false, settle: false, createPrint: false, markPrinted: false, reviewChange: false },
    billing: null, pendingChangeRequest: null, printPending: false, pendingPrintJobId: null, trackingNo: null,
    progress: { orderTotal: '1000', foilingProgress: '0', packingProgress: '0', foilingOverLimit: false, packingOverLimit: false, packingAhead: false, stagnant: false, stagnationDays: 0, firstClaimedAt: null },
    logs: [],
  };
}
