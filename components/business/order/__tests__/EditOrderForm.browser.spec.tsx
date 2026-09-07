import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commands, page } from 'vitest/browser';
import '@/app/globals.css';

const { save } = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock('@/actions/order', () => ({ updateOrderAction: save }));
vi.mock('next/link', () => ({
  __esModule: true,
  default: (props: ComponentProps<'a'>) => <a {...props} />,
}));
import { EditOrderForm } from '../EditOrderForm';
import { OrderReceiverContactFields } from '../OrderReceiverContactFields';

let host: HTMLDivElement;
let root: Root;
const initial = {
  customName: '春节礼盒',
  customerRef: '客户简称',
  customerPartyId: 'customer-1',
  receiverName: '张三',
  receiverPhone: '13800138000',
  receiverAddress: '广东省佛山市原地址',
  expressCode: 'ZTO',
  packageRequirement: '混装，每袋十个',
  remark: '保留原稿',
  promisedDate: '2026-09-10',
  isUrgent: true,
};
const shipments = [
  {
    id: 'shipment-1',
    sequence: 1,
    status: 'PLANNED',
    receiverName: '张三',
    receiverPhone: '13800138000',
    receiverAddress: '广东省佛山市原地址',
    expressCode: 'ZTO',
    destinationProvince: '广东',
  },
  {
    id: 'shipment-2',
    sequence: 2,
    status: 'PLANNED',
    receiverName: '李四',
    receiverPhone: '13900139000',
    receiverAddress: '浙江省杭州市第二地址',
    expressCode: 'YTO',
    destinationProvince: '浙江',
  },
];
function mount(props: Partial<ComponentProps<typeof EditOrderForm>> = {}) {
  flushSync(() =>
    root.render(
      <EditOrderForm
        orderId="order-1"
        expectedEditVersion={4}
        fieldset="FULL"
        initial={initial}
        shipments={shipments}
        customers={[
          {
            id: 'customer-1',
            name: '客户公司',
            shortName: '客户简称',
            code: 'C001',
            receiverName: null,
            receiverPhone: null,
            receiverAddress: null,
          },
        ]}
        isExternalSales
        {...props}
      />,
    ),
  );
}
beforeEach(() => {
  save.mockReset().mockResolvedValue({
    status: 'error',
    message: '工单已更新，请刷新后重试',
  });
  document.documentElement.lang = 'zh-CN';
  host = document.createElement('div');
  host.className = 'admin-viewport bg-background p-4 text-foreground';
  host.dataset.testid = 'edit-order-fixture';
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
  document.documentElement.classList.remove('dark');
});

describe('complete order editing', () => {
  it('allows replacing or clearing parsed contacts without restoring their initial values', async () => {
    const changed = vi.fn();
    flushSync(() =>
      root.render(
        <OrderReceiverContactFields
          receiverName="解析的姓名"
          receiverPhone="13800138000"
          onNameChange={changed}
          onPhoneChange={changed}
          required
        />,
      ),
    );
    await page
      .getByRole('textbox', { name: '收件人', exact: true })
      .fill('修正姓名');
    await page.getByRole('textbox', { name: '收货电话', exact: true }).fill('');
    await expect
      .element(page.getByRole('textbox', { name: '收件人', exact: true }))
      .toHaveValue('修正姓名');
    await expect
      .element(page.getByRole('textbox', { name: '收货电话', exact: true }))
      .toHaveValue('');
    expect(changed).toHaveBeenCalledWith('');
  });
  for (const [width, height] of [
    [375, 667],
    [393, 852],
    [768, 1024],
    [1024, 768],
    [1280, 800],
    [1920, 1080],
  ]) {
    for (const theme of ['light', 'dark']) {
      it(`${width}×${height} ${theme}: all delivery fields remain accessible`, async () => {
        await page.viewport(width, height);
        document.documentElement.classList.toggle('dark', theme === 'dark');
        mount();
        await expect
          .element(page.getByRole('button', { name: '保存', exact: true }))
          .toBeVisible();
        expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
        for (const element of host.querySelectorAll<HTMLElement>(
          'a, button, input:not([type="hidden"]):not([aria-hidden="true"]), select, textarea',
        )) {
          const rect = element.getBoundingClientRect();
          if (!rect.width || !rect.height) continue;
          expect(rect.right).toBeLessThanOrEqual(width);
          expect(rect.left).toBeGreaterThanOrEqual(0);
          expect(rect.height).toBeGreaterThanOrEqual(44);
        }
        expect(
          await commands.checkShellAccessibility(
            '[data-testid="edit-order-fixture"]',
          ),
        ).toEqual([]);
      });
    }
  }
  it('keeps all saved addresses distinct and preserves edited values after a stale-save error', async () => {
    mount();
    await page
      .getByRole('textbox', { name: '工单名称', exact: true })
      .fill('新的礼盒名称');
    await page
      .getByRole('textbox', { name: '收货电话', exact: true })
      .nth(1)
      .fill('13700137000');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await expect
      .element(page.getByRole('alert'))
      .toHaveTextContent('工单已更新，请刷新后重试');
    const data = save.mock.calls[0][2] as FormData;
    expect(data.get('expectedEditVersion')).toBe('4');
    expect(data.get('customerPartyId')).toBe('customer-1');
    expect(data.get('customName')).toBe('新的礼盒名称');
    const saved = JSON.parse(String(data.get('shipments')));
    expect(saved[0]).toMatchObject({
      id: 'shipment-1',
      receiverName: '张三',
      receiverPhone: '13800138000',
    });
    expect(saved[1]).toMatchObject({
      id: 'shipment-2',
      receiverName: '李四',
      receiverPhone: '13700137000',
    });
    expect(saved[1]).not.toHaveProperty('shippingFee');
    await expect
      .element(page.getByRole('textbox', { name: '工单名称', exact: true }))
      .toHaveValue('新的礼盒名称');
    await expect
      .element(
        page.getByRole('textbox', { name: '收货电话', exact: true }).nth(1),
      )
      .toHaveValue('13700137000');
  });
  it('requires an external name and keeps packaging supplements out of basic information', async () => {
    mount();
    const name = page.getByRole('textbox', { name: '工单名称', exact: true });
    await name.fill('');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    expect(save).not.toHaveBeenCalled();
    expect(
      (host.querySelector('#customName') as HTMLInputElement).validity
        .valueMissing,
    ).toBe(true);
    expect(
      host
        .querySelector('#packageRequirement')
        ?.closest('[aria-label="分货与包装"]'),
    ).not.toBeNull();
    await name.fill('外部礼盒');
    await page
      .getByRole('textbox', { name: '包装补充说明（选填）' })
      .fill('封口后贴标签');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save.mock.calls[0]?.[2].get('packageRequirement')).toBe(
      '封口后贴标签',
    );
  });

  it('adopts customer defaults only on request, preserving other shipments and resetting the province check', async () => {
    mount({
      customers: [
        {
          id: 'customer-2',
          code: 'C002',
          name: '新客户公司',
          shortName: '新客户',
          receiverName: '王五',
          receiverPhone: '13600136000',
          receiverAddress: '广东省深圳市新地址',
        },
      ],
    });
    await page
      .getByRole('combobox', { name: '关联客户' })
      .selectOptions('customer-2');
    await expect
      .element(page.getByRole('textbox', { name: '客户名称/简称（选填）' }))
      .toHaveValue('客户简称');
    await expect
      .element(
        page.getByRole('textbox', { name: '收货地址', exact: true }).nth(0),
      )
      .toHaveValue('广东省佛山市原地址');
    await page.getByRole('button', { name: '采用客户简称' }).click();
    await page.getByRole('button', { name: '采用客户默认收货信息' }).click();
    await expect
      .element(page.getByRole('textbox', { name: '客户名称/简称（选填）' }))
      .toHaveValue('新客户');
    await expect
      .element(
        page.getByRole('textbox', { name: '收货地址', exact: true }).nth(0),
      )
      .toHaveValue('广东省深圳市新地址');
    await expect
      .element(
        page.getByRole('textbox', { name: '收件人', exact: true }).nth(0),
      )
      .toHaveValue('王五');
    await expect
      .element(
        page.getByRole('textbox', { name: '收货电话', exact: true }).nth(0),
      )
      .toHaveValue('13600136000');
    await expect
      .element(
        page.getByRole('textbox', { name: '收货地址', exact: true }).nth(1),
      )
      .toHaveValue('浙江省杭州市第二地址');
    await expect
      .element(
        page.getByRole('checkbox', {
          name: '配送省份仍为广东，运费计费条件未变',
        }),
      )
      .not.toBeChecked();
  });

  it('requires rechecking the province after every further address edit', async () => {
    mount();
    const address = page
      .getByRole('textbox', { name: '收货地址', exact: true })
      .nth(1);
    await address.fill('浙江省杭州市新地址');
    const sameProvince = page.getByRole('checkbox', {
      name: '配送省份仍为浙江，运费计费条件未变',
    });
    await sameProvince.click();
    await expect.element(sameProvince).toBeChecked();
    await address.fill('浙江省杭州市另一地址');
    await expect.element(sameProvince).not.toBeChecked();
  });
  it('locks production facts after confirmation and locks shipped contacts', async () => {
    mount({
      fieldset: 'SHIPPING_ONLY',
      shipments: [{ ...shipments[0], status: 'SHIPPED' }, shipments[1]],
    });
    await expect
      .element(page.getByRole('textbox', { name: '工单名称', exact: true }))
      .toBeDisabled();
    await expect
      .element(page.getByRole('combobox', { name: '关联客户' }))
      .toBeDisabled();
    await expect
      .element(
        page.getByRole('textbox', { name: '收货电话', exact: true }).nth(0),
      )
      .toBeDisabled();
    await expect
      .element(
        page.getByRole('textbox', { name: '收货电话', exact: true }).nth(1),
      )
      .toBeEnabled();
    expect(host.querySelector('[name="promisedDate"]')).toBeNull();
  });
  it('blocks saves while a change request is pending', async () => {
    mount({ blocked: true });
    await expect
      .element(page.getByRole('button', { name: '保存', exact: true }))
      .toBeDisabled();
    await expect
      .element(
        page.getByRole('textbox', { name: '收货电话', exact: true }).nth(1),
      )
      .toBeDisabled();
    expect(save).not.toHaveBeenCalled();
  });
});
