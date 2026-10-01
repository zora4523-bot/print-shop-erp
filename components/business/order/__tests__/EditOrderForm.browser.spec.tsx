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
  receiverName: '张三',
  receiverPhone: '13800138000',
  receiverAddress: '广东省佛山市原地址',
  expressCode: 'ZTO',
  packageRequirement: '混装，每袋十个',
  remark: '保留原稿',
  promisedDate: '2026-09-10',
  isUrgent: true,
};
const externalSalesAssociation = {
  current: { id: 'sales-1', displayName: '原外部销售', username: 'sales-one' },
  options: [
    { id: 'sales-1', displayName: '原外部销售', username: 'sales-one' },
    { id: 'sales-2', displayName: '新外部销售', username: 'sales-two' },
  ],
  blockedReason: null,
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
        key={`order-1:${props.expectedEditVersion ?? 4}`}
        orderId="order-1"
        expectedEditVersion={4}
        fieldset="FULL"
        initial={initial}
        shipments={shipments}
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
        mount({ externalSalesAssociation });
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
    // 客户名称/简称与关联客户已退役（业主 2026-09-27）：编辑表单不再提交客户字段。
    expect(data.has('customerPartyId')).toBe(false);
    expect(data.has('customerRef')).toBe(false);
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
  it('admin changes an external sales account without touching customer or delivery data', async () => {
    mount({ externalSalesAssociation });
    expect(host.querySelector('[name="customerPartyId"]')).toBeNull();
    expect(host.querySelector('[name="customerRef"]')).toBeNull();
    await page.getByRole('combobox', { name: '关联外部销售' }).selectOptions('sales-2');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
    const data = save.mock.calls[0][2] as FormData;
    expect(data.get('externalSalesUserId')).toBe('sales-2');
    expect(data.has('customerPartyId')).toBe(false);
    expect(data.has('customerRef')).toBe(false);
    expect(JSON.parse(String(data.get('shipments'))).map((row: { receiverAddress: string }) => row.receiverAddress)).toEqual(shipments.map((row) => row.receiverAddress));
    await expect.element(page.getByRole('combobox', { name: '关联外部销售' })).toHaveValue('sales-2');
  });
  it('preserves the chosen account through pending, field errors and a retry', async () => {
    let finish!: (result: { status: 'invalid'; fieldErrors: Record<string, string[]> }) => void;
    save.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    mount({ externalSalesAssociation });
    const account = page.getByRole('combobox', { name: '关联外部销售' });
    const submit = page.getByRole('button', { name: '保存', exact: true });
    await account.selectOptions('sales-2');
    await submit.click();
    await expect.element(account).toBeDisabled();
    expect((account.element() as HTMLSelectElement).value, 'pending value').toBe('sales-2');
    await expect.element(page.getByRole('button', { name: '正在保存…', exact: true })).toBeDisabled();
    expect(save).toHaveBeenCalledOnce();
    finish({ status: 'invalid', fieldErrors: { externalSalesUserId: ['账号不可用，请重新选择。'] } });
    await expect.element(account).toBeEnabled();
    expect((account.element() as HTMLSelectElement).value, 'resolved value').toBe('sales-2');
    await expect.element(page.getByText('账号不可用，请重新选择。', { exact: true })).toBeVisible();
    await submit.click();
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[1][2].get('externalSalesUserId')).toBe('sales-2');
    expect((account.element() as HTMLSelectElement).value, 'resolved value').toBe('sales-2');
  });

  it('adopts the persisted account when the server supplies a new edit version', async () => {
    mount({ externalSalesAssociation });
    await page.getByRole('combobox', { name: '关联外部销售' }).selectOptions('sales-2');
    // The real edit page keys this form by order.id and editVersion after refresh.
    mount({ expectedEditVersion: 5, externalSalesAssociation: {
      ...externalSalesAssociation, current: externalSalesAssociation.options[1],
    } });
    await expect.element(page.getByRole('combobox', { name: '关联外部销售' })).toHaveValue('sales-2');
    expect(host.querySelector<HTMLInputElement>('[name="expectedEditVersion"]')?.value).toBe('5');
    expect(save).not.toHaveBeenCalled();
  });

  it('retains a historical unavailable account and explains a frozen association', async () => {
    mount({ externalSalesAssociation: { ...externalSalesAssociation, options: [], blockedReason: '工单已确认，不能更换关联外部销售。' } });
    const field = page.getByRole('combobox', { name: '关联外部销售' });
    await expect.element(field).toBeDisabled();
    await expect.element(field).toHaveValue('sales-1');
    await expect.element(page.getByText('工单已确认，不能更换关联外部销售。')).toBeVisible();
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
      .getByRole('textbox', { name: '包装补充说明', exact: true })
      .fill('封口后贴标签');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save.mock.calls[0]?.[2].get('packageRequirement')).toBe(
      '封口后贴标签',
    );
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
      externalSalesAssociation,
      shipments: [{ ...shipments[0], status: 'SHIPPED' }, shipments[1]],
    });
    await expect
      .element(page.getByRole('textbox', { name: '工单名称', exact: true }))
      .toBeDisabled();
    await expect
      .element(page.getByRole('combobox', { name: '关联外部销售' }))
      .toBeDisabled();
    expect(host.querySelector('[name="customerRef"], [name="customerPartyId"]')).toBeNull();
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
