import { commands, page } from 'vitest/browser';
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

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  save.mockReset().mockResolvedValue({ status: 'error', message: '保存失败，请重试' });
  host = document.createElement('div');
  host.className = 'admin-viewport bg-background p-4 text-foreground';
  host.dataset.testid = 'plate-fields-fixture';
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { flushSync(() => root.unmount()); host.remove(); document.documentElement.classList.remove('dark'); });

function render(existing = false) {
  flushSync(() => root.render(<OrderCommercialDetailsManager orderId="order-1" priceRevision={7}
    manualCharges={[]} allowPlateDetailMaintenance items={[{
      id: 'item-1', sequence: 1, name: '测试款式', independentPlateEligible: true,
      plateDetails: existing ? [{ id: 'plate-1', sequence: 1, name: '原制版', plateGroupId: 'group-1',
        specification: '历史规格', quantity: 3, unitPrice: '12.00', amount: '36.00', remark: '原备注', isActive: true }] : [],
    }]} />));
  return [...host.querySelectorAll('fieldset')].find((field) => field.textContent?.includes(existing ? '制版明细 #1' : '添加制版明细'))!;
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
});

for (const [width, height] of [[375, 667], [393, 852], [768, 1024], [1024, 768], [1280, 800], [1920, 1080]]) {
  for (const theme of ['light', 'dark']) {
    it(`${width}×${height} ${theme}: plate fields fit and remain accessible`, async () => {
      await page.viewport(width, height);
      document.documentElement.classList.toggle('dark', theme === 'dark');
      const field = render(true);
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
      for (const input of field.querySelectorAll('input, textarea, button')) {
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
