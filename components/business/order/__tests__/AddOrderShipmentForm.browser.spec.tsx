import type { ComponentProps } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { commands, page } from 'vitest/browser';
import '@/app/globals.css';
vi.mock('next/link', () => ({
  default: (props: ComponentProps<'a'>) => <a {...props} />,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/actions/order-shipment', () => ({
  addOrderShipmentAction: vi.fn(),
}));
import { addOrderShipmentAction } from '@/actions/order-shipment';
import { AddOrderShipmentForm } from '../AddOrderShipmentForm';
let host: HTMLDivElement;
let root: Root;
const props = {
  orderId: 'order',
  expectedRevision: 1,
  expectedEditVersion: 1,
  expectedWorkOrderVersion: 1,
  expectedPriceRevision: 1,
  nextSequence: 2,
  sources: [
    {
      id: 'source',
      sequence: 1,
      receiverAddress: '广东省佛山市南海区测试路 1 号',
      // 同一设计款的两个规格行共用款名：标签必须靠序号与规格区分。
      lines: [
        { orderItemId: 'item', sequence: 1, name: '花好月圆红包', specification: '大号封', quantity: 1000 },
        { orderItemId: 'item-2', sequence: 2, name: '花好月圆红包', specification: '中号封', quantity: 500 },
      ],
    },
  ],
};
beforeEach(() => {
  document.documentElement.lang = 'zh-CN';
  host = document.createElement('div');
  host.dataset.testid = 'shipment-fixture';
  host.className = 'p-4';
  document.body.append(host);
  root = createRoot(host);
  vi.mocked(addOrderShipmentAction).mockReset();
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
  document.documentElement.classList.remove('dark');
});
async function open() {
  flushSync(() => root.render(<AddOrderShipmentForm {...props} />));
  await page.getByRole('button', { name: '添加地址 2', exact: true }).click();
}
async function fill() {
  await page
    .getByRole('textbox', { name: '收件人', exact: true })
    .fill('李女士');
  await page
    .getByRole('textbox', { name: '收货电话', exact: true })
    .fill('13800138000');
  await page
    .getByRole('textbox', { name: '收货地址', exact: true })
    .fill('江西省南昌市测试路 2 号');
  await page
    .getByRole('textbox', { name: '计费省份', exact: true })
    .fill('江西');
  await page
    .getByRole('spinbutton', { name: '#1 花好月圆红包 · 大号封 · 分配数量（最多 1000）', exact: true })
    .fill('400');
}
describe('add delivery', () => {
  it('reviews money and allocations, invalidates preview before editing, then saves', async () => {
    await open();
    await fill();
    vi.mocked(addOrderShipmentAction).mockResolvedValue({
      status: 'preview',
      preview: {
        packaging: [],
        token: 'token',
        pricingMode: 'REQUOTE',
        requiresPriceReview: true,
        sequence: 2,
        oldTotal: '100',
        newTotal: '108.25',
        delta: '8.25',
        charges: [
          { sequence: 1, shippingFee: '3', packingMaterialFee: '2' },
          { sequence: 2, shippingFee: '6.25', packingMaterialFee: '2' },
        ],
      },
    });
    await page.getByRole('button', { name: '预览费用' }).click();
    await expect
      .element(page.getByRole('button', { name: '保存地址' }))
      .toBeVisible();
    expect(host.textContent).toContain('#1 花好月圆红包 · 大号封：地址 1 1000 → 600');
    expect(host.textContent).not.toContain('#2 花好月圆红包 · 中号封：');
    expect(host.textContent).toContain('108.25');
    await expect
      .element(page.getByRole('spinbutton', { name: '#2 花好月圆红包 · 中号封 · 分配数量（最多 500）', exact: true }))
      .toBeDisabled();
    await page.getByRole('button', { name: '继续修改' }).click();
    await expect
      .element(page.getByRole('button', { name: '预览费用' }))
      .toBeVisible();
    await page.getByRole('button', { name: '预览费用' }).click();
    await expect
      .element(page.getByRole('button', { name: '保存地址' }))
      .toBeVisible();
    vi.mocked(addOrderShipmentAction).mockResolvedValue({ status: 'saved' });
    await page.getByRole('button', { name: '保存地址' }).click();
    await expect
      .element(page.getByRole('button', { name: '添加地址 2' }))
      .toBeVisible();
    expect(addOrderShipmentAction).toHaveBeenLastCalledWith(
      expect.objectContaining({
        previewToken: 'token',
        lines: [
          { orderItemId: 'item', quantity: 400 },
          { orderItemId: 'item-2', quantity: 0 },
        ],
      }),
      'save',
    );
  });
  it('retains input on failure', async () => {
    await open();
    await fill();
    vi.mocked(addOrderShipmentAction).mockResolvedValue({
      status: 'error',
      message: '工单已变化，请刷新后重试',
    });
    await page.getByRole('button', { name: '预览费用' }).click();
    await expect
      .element(page.getByRole('alert'))
      .toHaveTextContent('工单已变化');
    await expect
      .element(page.getByRole('textbox', { name: '收件人', exact: true }))
      .toHaveValue('李女士');
  });
  for (const theme of ['light', 'dark'])
    for (const [width, height] of [
      [375, 667],
      [393, 852],
      [768, 1024],
      [1024, 768],
      [1280, 800],
      [1920, 1080],
    ]) {
      it(`${width}x${height} ${theme}: address form touch, overflow and axe`, async () => {
        await page.viewport(width, height);
        document.documentElement.classList.toggle('dark', theme === 'dark');
        await open();
        await fill();
        expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
        if (width <= 768)
          for (const element of host.querySelectorAll(
            'button,input,select,textarea',
          )) {
            const rect = element.getBoundingClientRect();
            if (!rect.width || !rect.height) continue;
            expect(rect.height).toBeGreaterThanOrEqual(44);
            expect(rect.width).toBeGreaterThanOrEqual(44);
          }
        expect(
          await commands.checkShellAccessibility(
            '[data-testid="shipment-fixture"]',
          ),
        ).toEqual([]);
      });
    }
});
