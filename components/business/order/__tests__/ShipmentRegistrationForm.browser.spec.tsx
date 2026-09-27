import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { page, commands } from 'vitest/browser';
import '@/app/globals.css';
const mocks = vi.hoisted(() => ({ save: vi.fn(), refresh: vi.fn() }));
vi.mock('@/actions/shipment-registration', () => ({ registerShipmentAction: mocks.save }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock('@/components/ui-business', () => import('@/components/ui-business/ConfirmActionDialog'));
import { ShipmentRegistrationForm, type ShipmentRegistrationProps } from '../ShipmentRegistrationForm';
const props: ShipmentRegistrationProps = { orderId: 'order', shipmentId: 'shipment', version: 0, revision: 1, editVersion: 1, workOrderVersion: 1, priceRevision: 1, trackingNo: 'ZTO1', carrierCode: 'ZTO', carrierName: null, shipped: false, canConfirm: true, disabledReason: null, lastPending: true, amount: '25.00', labels: [] };
let host: HTMLDivElement; let root: Root;
beforeEach(() => { vi.resetAllMocks(); host = document.createElement('div'); host.dataset.testid = 'shipment-fixture'; host.className = 'admin-viewport bg-background p-4 text-foreground'; document.body.append(host); root = createRoot(host); });
afterEach(() => { flushSync(() => root.unmount()); host.remove(); document.documentElement.classList.remove('dark'); });
function render(value = props) { flushSync(() => root.render(<ShipmentRegistrationForm {...value} />)); }
it('saves without confirming shipment and preserves failed input for retry', async () => {
  mocks.save.mockResolvedValue({ ok: false, message: '保存失败，请重试' }); render();
  await page.getByRole('textbox', { name: '运单号', exact: true }).fill('ZTO-new');
  await page.getByRole('button', { name: '保存物流资料', exact: true }).click();
  await expect.element(page.getByRole('alert')).toHaveTextContent('保存失败');
  expect(mocks.save.mock.calls[0][0].get('confirm')).toBe('false');
  await expect.element(page.getByRole('textbox', { name: '运单号', exact: true })).toHaveValue('ZTO-new');
  const key = mocks.save.mock.calls[0][0].get('idempotencyKey');
  await page.getByRole('button', { name: '保存物流资料', exact: true }).click();
  expect(mocks.save.mock.calls[1][0].get('idempotencyKey')).toBe(key);
});
it('requires explicit confirmation and displays the receivable consequence', async () => {
  mocks.save.mockResolvedValue({ ok: true, message: '已发货' }); render();
  await page.getByRole('button', { name: '确认该地址已发货', exact: true }).click();
  expect(mocks.save).not.toHaveBeenCalled();
  await expect.element(page.getByRole('alertdialog')).toHaveTextContent('25.00 元');
  await expect.element(page.getByRole('alertdialog')).toHaveTextContent('工单自动结算');
  await expect.element(page.getByRole('alertdialog')).toHaveTextContent('尚未收款');
  await page.getByRole('alertdialog').getByRole('button', { name: '确认发货', exact: true }).click();
  await vi.waitFor(() => expect(mocks.save).toHaveBeenCalled());
  expect(mocks.save.mock.calls[0][0].get('confirm')).toBe('true');
});
it('permits draft entry but blocks early shipment', async () => {
  render({ ...props, canConfirm: false, disabledReason: '完工后才可发货' });
  await expect.element(page.getByRole('button', { name: '确认该地址已发货', exact: true })).toBeDisabled();
  await expect.element(page.getByRole('button', { name: '保存物流资料', exact: true })).toBeEnabled();
});
it('explains free-order settlement without claiming a receivable will be created', async () => {
  render({ ...props, chargeable: false });
  await page.getByRole('button', { name: '确认该地址已发货', exact: true }).click();
  await expect.element(page.getByRole('alertdialog')).toHaveTextContent('工单自动结算');
  await expect.element(page.getByRole('alertdialog')).not.toHaveTextContent('生成应收');
  expect(mocks.save).not.toHaveBeenCalled();
});
it('accepts a pasted image and sends the prepared photo with the draft', async () => {
  mocks.save.mockResolvedValue({ ok: false, message: '保存失败，请重试' }); render();
  const canvas = document.createElement('canvas'); canvas.width = 20; canvas.height = 20;
  const blob = await new Promise<Blob>((resolve) => canvas.toBlob((value) => resolve(value!), 'image/png'));
  const data = new DataTransfer(); data.items.add(new File([blob], 'pasted.png', { type: 'image/png' }));
  host.firstElementChild!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  await expect.element(page.getByRole('link', { name: '查看面单照片' })).toBeVisible();
  await page.getByRole('button', { name: '保存物流资料', exact: true }).click();
  await vi.waitFor(() => expect(mocks.save).toHaveBeenCalled());
  const photo = mocks.save.mock.calls[0][0].get('photo') as File;
  expect(photo.type).toBe('image/jpeg'); expect(photo.size).toBeLessThanOrEqual(524288);
});
it('keeps previous proof links available after replacement', async () => {
  render({ ...props, shipped: true, labels: [{ id: 'new', createdAt: '2026-09-11' }, { id: 'old', createdAt: '2026-09-10' }] });
  await page.getByText('历史面单照片（1）').click();
  await expect.element(page.getByRole('link', { name: '2026-09-10' })).toHaveAttribute('href', '/api/orders/order/shipments/shipment/labels/old');
});
for (const [width,height] of [[375,667],[393,852],[768,1024],[1024,768],[1280,800],[1920,1080]]) for (const theme of ['light','dark']) {
  it(`${width} ${theme}: layout and accessibility`, async () => {
    await page.viewport(width,height); document.documentElement.classList.toggle('dark',theme==='dark'); render({ ...props, carrierCode: 'OTHER' });
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
    for (const el of host.querySelectorAll('input,select,button')) { const box=el.getBoundingClientRect(); if(!box.width) continue; expect(box.height).toBeGreaterThanOrEqual(44); expect(box.right).toBeLessThanOrEqual(width); }
    expect(await commands.checkShellAccessibility('[data-testid="shipment-fixture"]')).toEqual([]);
  });
}
