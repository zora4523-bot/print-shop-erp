import { Component, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { commands, page } from 'vitest/browser';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Button } from '@/components/ui/button';
import '@/app/globals.css';

const actions = vi.hoisted(() => ({ save: vi.fn(), remove: vi.fn(), plate: vi.fn(), removePlate: vi.fn() }));
vi.mock('@/actions/order', () => ({
  saveOrderManualChargeAction: actions.save,
  deleteOrderManualChargeAction: actions.remove,
  saveOrderPlateDetailAction: actions.plate,
  deleteOrderPlateDetailAction: actions.removePlate,
}));
vi.mock('@/components/ui-business', async () => ({
  ...await import('@/components/ui-business/ConfirmActionDialog'),
  ...await import('@/components/ui-business/ActionNotice'),
}));
import { OrderCommercialDetailsManager } from '../OrderCommercialDetailsManager';
import { OrderEditorAuxiliaryContext, useOrderEditorAuxiliaryController } from '../use-order-editor-auxiliary';

class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <p role="alert">整页错误边界</p> : this.props.children; }
}
function Harness({ children }: { children: ReactNode }) {
  const auxiliary = useOrderEditorAuxiliaryController(false);
  return <OrderEditorAuxiliaryContext.Provider value={auxiliary.context}>
    <Button type="button" disabled={auxiliary.dirty || auxiliary.pending}>保存工单资料</Button>{children}
  </OrderEditorAuxiliaryContext.Provider>;
}
let host: HTMLDivElement;
let root: Root;
const caught = vi.fn();
beforeEach(() => {
  vi.resetAllMocks();
  for (const action of Object.values(actions)) action.mockRejectedValue(new TypeError('Failed to fetch'));
  host = document.createElement('div');
  host.className = 'admin-viewport mx-auto max-w-[880px] bg-background p-4 text-foreground';
  host.dataset.testid = 'fee-recovery';
  document.body.append(host);
  root = createRoot(host, { onCaughtError: caught });
});
afterEach(() => { flushSync(() => root.unmount()); host.remove(); document.documentElement.classList.remove('dark'); });
function render(existing = false, managed = false) {
  const manager = <OrderCommercialDetailsManager orderId="order-1" priceRevision={7} allowPlateDetailMaintenance
    manualCharges={existing ? [{ id: 'charge-1', status: 'FINAL', description: '原打样费', amount: '25.00', overrideReason: '原依据', approvalReference: null,
      category: { code: 'SAMPLE_FEE', name: '打样费' }, finalizedBy: null, finalizedAt: null }] : []}
    items={[{ id: 'item-1', sequence: 1, name: '测试款', independentPlateEligible: true,
      plateDetails: existing ? [{ id: 'plate-1', sequence: 1, name: '原制版', plateGroupId: null, specification: null, quantity: 1, unitPrice: '10.00', amount: '10.00', remark: '', isActive: true }] : [] }]} />;
  flushSync(() => root.render(<Boundary>{managed ? <Harness>{manager}</Harness> : manager}</Boundary>));
}
async function submitManual() {
  await page.getByRole('textbox', { name: '订单级费用金额', exact: true }).fill('25');
  await page.getByRole('textbox', { name: '收费说明', exact: true }).fill('保留打样输入');
  await page.getByRole('textbox', { name: '原因', exact: true }).fill('客户已确认');
  await page.getByRole('button', { name: '添加费用', exact: true }).click();
}
async function expectRecovery() {
  await expect.element(page.getByRole('status')).toHaveTextContent('暂时无法确认费用处理结果');
  expect(caught).not.toHaveBeenCalled();
  expect(host.textContent).not.toContain('Failed to fetch');
  expect(host.textContent).not.toContain('整页错误边界');
  const link = host.querySelector<HTMLAnchorElement>('a[target="_blank"]');
  expect(link?.getAttribute('href')).toBe('/orders/order-1#commercial-fees');
  expect(link?.rel).toContain('noopener');
}

it('keeps manual input and blocks all fee writes and reset until the result is checked', async () => {
  render(false, true);
  await submitManual();
  await expectRecovery();
  await expect.element(page.getByRole('textbox', { name: '收费说明', exact: true })).toHaveValue('保留打样输入');
  for (const name of ['添加费用', '添加制版明细', '还原费用输入', '保存工单资料']) {
    await expect.element(page.getByRole('button', { name, exact: true })).toBeDisabled();
  }
  expect(actions.save).toHaveBeenCalledTimes(1);
});

it('keeps plate input on a lost response and locks standalone fee forms', async () => {
  actions.plate.mockRejectedValue(new TypeError('NetworkError when attempting to fetch resource.'));
  render();
  await page.getByRole('textbox', { name: '制版名称', exact: true }).fill('保留制版输入');
  await page.getByRole('textbox', { name: '单价（元）', exact: true }).fill('12.50');
  await page.getByRole('button', { name: '添加制版明细', exact: true }).click();
  await expectRecovery();
  await expect.element(page.getByRole('textbox', { name: '制版名称', exact: true })).toHaveValue('保留制版输入');
  await expect.element(page.getByRole('button', { name: '添加费用', exact: true })).toBeDisabled();
  expect(actions.plate).toHaveBeenCalledTimes(1);
});

for (const [label, action] of [['打样费', 'remove'], ['制版明细 #1', 'removePlate']] as const) {
  it(`keeps ${label} and its removal reason when removal has an unknown result`, async () => {
    actions[action].mockRejectedValue(new DOMException('request interrupted', action === 'remove' ? 'AbortError' : 'TimeoutError'));
    render(true);
    const field = page.getByRole('group').filter({ hasText: label }).first();
    await field.getByRole('textbox', { name: '移除原因', exact: true }).fill('客户取消此项');
    await field.getByRole('button', { name: '移除并保留历史', exact: true }).click();
    expect(actions[action]).not.toHaveBeenCalled();
    await page.getByRole('alertdialog').getByRole('button', { name: '确认移除', exact: true }).click();
    await expectRecovery();
    await expect.element(field.getByRole('textbox', { name: '移除原因', exact: true })).toHaveValue('客户取消此项');
    expect(actions[action]).toHaveBeenCalledTimes(1);
  });
}

it('retains normal validation feedback and permits a deliberate corrected submission', async () => {
  actions.save.mockResolvedValueOnce({ status: 'error', message: '请核对费用金额' })
    .mockResolvedValueOnce({ status: 'success', entityId: 'charge-1', priceRevision: 8, totalAmount: '26.00' });
  render(); await submitManual();
  await expect.element(page.getByRole('alert')).toHaveTextContent('请核对费用金额');
  await expect.element(page.getByRole('button', { name: '添加费用', exact: true })).toBeEnabled();
  expect(host.textContent).not.toContain('暂时无法确认费用处理结果');
  await page.getByRole('textbox', { name: '订单级费用金额', exact: true }).fill('26');
  await page.getByRole('button', { name: '添加费用', exact: true }).click();
  await expect.element(page.getByRole('status')).toHaveTextContent('已保存，工单总额更新为 26.00 元');
  expect(actions.save).toHaveBeenCalledTimes(2);
  expect(actions.save.mock.calls[1][1]).toMatchObject({ amount: '26', expectedPriceRevision: 7 });
});

it('supersedes an earlier save success when the following removal result is unknown', async () => {
  actions.save.mockResolvedValue({ status: 'success', entityId: 'charge-1', priceRevision: 8, totalAmount: '25.00' });
  render(true);
  const charge = page.getByRole('group').filter({ hasText: '打样费' }).first();
  await charge.getByRole('button', { name: '保存修改', exact: true }).click();
  await expect.element(charge.getByRole('status')).toHaveTextContent('已保存');
  await charge.getByRole('textbox', { name: '移除原因', exact: true }).fill('客户取消此项');
  await charge.getByRole('button', { name: '移除并保留历史', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '确认移除', exact: true }).click();
  await expectRecovery();
  expect(host.textContent).not.toContain('已保存，工单总额更新为');
  expect(actions.remove).toHaveBeenCalledTimes(1);
});

it('also keeps Safari connection failures local', async () => {
  actions.save.mockRejectedValue(new TypeError('Load failed'));
  render(); await submitManual(); await expectRecovery();
  expect(document.activeElement?.getAttribute('aria-label')).toBe('费用处理结果待核对');
});

it('does not mask unexpected programming errors as a connection problem', async () => {
  actions.save.mockRejectedValue(new Error('unexpected invariant failure'));
  render(); await submitManual();
  await expect.element(page.getByRole('alert')).toHaveTextContent('整页错误边界');
  expect(caught).toHaveBeenCalledTimes(1);
});

for (const [width, height] of [[375, 667], [393, 852], [768, 1024], [1024, 768], [1280, 800], [1920, 1080]]) {
  for (const theme of ['light', 'dark']) {
    it(`${width}×${height} ${theme}: recovery controls remain accessible`, async () => {
      await page.viewport(width, height);
      document.documentElement.classList.toggle('dark', theme === 'dark');
      render(); await submitManual(); await expectRecovery();
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
      for (const control of host.querySelectorAll('button, a')) {
        const rect = control.getBoundingClientRect();
        expect(rect.right).toBeLessThanOrEqual(width);
        expect(rect.height).toBeGreaterThanOrEqual(44);
      }
      expect(await commands.checkShellAccessibility('[data-testid="fee-recovery"]')).toEqual([]);
    });
  }
}
