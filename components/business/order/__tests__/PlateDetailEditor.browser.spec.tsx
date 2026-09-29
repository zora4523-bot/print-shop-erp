import { commands, page, userEvent } from 'vitest/browser';
import '@/app/globals.css';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const save = vi.hoisted(() => vi.fn());
vi.mock('@/actions/order', () => ({
  saveOrderPlateDetailAction: save,
  deleteOrderPlateDetailAction: vi.fn(),
  saveOrderManualChargeAction: vi.fn(),
  deleteOrderManualChargeAction: vi.fn(),
}));
vi.mock('@/components/ui-business', () => import('@/components/ui-business/ConfirmActionDialog'));
import { OrderCommercialDetailsManager } from '../OrderCommercialDetailsManager';
import { Disclosure, DisclosureSummary } from '@/components/ui/disclosure';

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  save.mockReset().mockResolvedValue({ status: 'error', message: '保存失败，请重试' });
  host = document.createElement('div');
  host.className = 'admin-viewport mx-auto w-full max-w-[880px] bg-background p-4 text-foreground';
  host.dataset.testid = 'plate-fields-fixture';
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { flushSync(() => root.unmount()); host.remove(); document.documentElement.classList.remove('dark'); });

function render(existing = false, embedded = false, multiple = false) {
  const plate = { id: 'plate-1', sequence: 1, name: '原制版', plateGroupId: 'group-1',
    specification: '历史规格', quantity: 3, unitPrice: '12.00', amount: '36.00', remark: '原备注', isActive: true };
  const charge = { id: 'charge-1', status: 'FINALIZED', description: '客户确认打样费用', amount: '25.00',
    overrideReason: '按客户确认报价', approvalReference: null, category: { code: 'SAMPLE_FEE', name: '打样费' },
    finalizedBy: { displayName: '管理员' }, finalizedAt: null };
  const manager = <OrderCommercialDetailsManager orderId="order-1" priceRevision={7} embedded={embedded}
    manualCharges={multiple ? [charge, { ...charge, id: 'charge-removed', status: 'WAIVED', description: '历史费用'.repeat(12) }] : []}
    allowPlateDetailMaintenance items={[{
      id: 'item-1', sequence: 1, name: '测试款式', independentPlateEligible: true,
      plateDetails: existing ? [plate, ...(multiple ? [{ ...plate, id: 'plate-removed', sequence: 2, isActive: false }] : [])] : [],
    }, ...(multiple ? [{ id: 'item-2', sequence: 2, name: '长款式名称ABCDEFGHIJKLMNOPQRSTUVWXYZ'.repeat(3),
      independentPlateEligible: false, plateDetails: [] }] : [])]} />;
  flushSync(() => root.render(embedded ? <Disclosure open className="rounded-xl border bg-card">
    <DisclosureSummary className="px-4 py-4"><h2>版费与其他费用</h2></DisclosureSummary>
    <div className="px-4 pb-5 pt-2 sm:px-6 sm:pb-6">{manager}</div>
  </Disclosure> : manager));
  return [...host.querySelectorAll('fieldset')].find((field) => field.textContent?.includes(existing ? '制版明细 #1' : '新增制版明细'))!;
}
function fill(field: Element, label: string, value: string) {
  const input = [...field.querySelectorAll('label')].find((entry) => entry.textContent?.trim() === label)!.querySelector('input, textarea')!;
  const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(input, value);
  flushSync(() => input.dispatchEvent(new Event('input', { bubbles: true })));
}
function submit(field: Element, text: string) {
  [...field.querySelectorAll('button')].find((button) => button.textContent === text)!.click();
}

describe('simplified plate detail fields', () => {
  it('creates a single-unit detail from name, price and remark and preserves input on failure', async () => {
    const field = render();
    expect([...field.querySelectorAll('label')].map((label) => label.textContent)).toEqual(['制版名称', '单价（元）', '备注']);
    fill(field, '制版名称', '新制版');
    fill(field, '单价（元）', '12.50');
    fill(field, '备注', '客户确认');
    expect(field.textContent).toContain('金额 12.50 元');
    submit(field, '添加制版明细');
    await vi.waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls[0][1]).toEqual({ orderId: 'order-1', orderItemId: 'item-1', plateDetailId: null,
      expectedPriceRevision: 7, name: '新制版', unitPrice: '12.50', remark: '客户确认', quantity: '1', plateGroupId: '', specification: '' });
    await vi.waitFor(() => expect(field.textContent).toContain('保存失败，请重试'));
    expect(field.querySelector('input')!.value).toBe('新制版');
  });

  it('retains historical quantity and metadata when editing the remaining fields', async () => {
    const field = render(true);
    const labels = [...field.querySelectorAll('label')].map((label) => label.textContent);
    expect(labels).not.toContain('数量');
    expect(labels).not.toContain('规格');
    expect(labels).not.toContain('版组 ID');
    fill(field, '单价（元）', '15.00');
    expect(field.textContent).toContain('数量 3 · 金额 45.00 元');
    submit(field, '保存制版修改');
    await vi.waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls[0][1]).toMatchObject({ plateDetailId: 'plate-1', quantity: '3',
      plateGroupId: 'group-1', specification: '历史规格', unitPrice: '15.00', expectedPriceRevision: 7 });
  });

  it('keeps an embedded draft through pointer collapse and keyboard expansion', async () => {
    const field = render(false, true);
    await page.getByRole('textbox', { name: '制版名称', exact: true }).fill('折叠前的制版');
    await page.getByRole('heading', { name: '版费与其他费用', exact: true }).click();
    expect(host.querySelector('details')!.open).toBe(false);
    const summary = host.querySelector('summary')!;
    summary.focus();
    await userEvent.keyboard('{Enter}');
    expect(host.querySelector('details')!.open).toBe(true);
    expect(field.querySelector('input')!.value).toBe('折叠前的制版');
    expect(save).not.toHaveBeenCalled();
  });

  it('stacks fields when its container is narrow even on a desktop viewport', async () => {
    await page.viewport(1280, 800);
    host.style.width = '420px';
    const field = render(false, true);
    const [name, price] = [...field.querySelectorAll('input')].map((input) => input.getBoundingClientRect());
    expect(price.top).toBeGreaterThan(name.bottom);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(1280);
  });
});

for (const [width, height] of [[375, 667], [393, 852], [768, 1024], [1024, 768], [1280, 800], [1920, 1080]]) {
  for (const theme of ['light', 'dark']) {
    for (const embedded of [false, true]) {
      it(`${width}×${height} ${theme} ${embedded ? 'embedded' : 'standalone'}: all fee records fit and remain accessible`, async () => {
        await page.viewport(width, height);
        document.documentElement.classList.toggle('dark', theme === 'dark');
        render(true, embedded, true);
        expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
        for (const input of host.querySelectorAll('input, textarea, select, button, summary')) {
          const rect = input.getBoundingClientRect();
          if (!rect.width || !rect.height) continue;
          expect(rect.left).toBeGreaterThanOrEqual(0);
          expect(rect.right).toBeLessThanOrEqual(width);
          expect(rect.height).toBeGreaterThanOrEqual(44);
        }
        expect(await commands.checkShellAccessibility('[data-testid="plate-fields-fixture"]')).toEqual([]);
      });
    }
  }
}
