import type { ComponentProps } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { useForm } from 'react-hook-form';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import type { CreateOrderInput } from '@/lib/auth/schemas';
import { createBlankItem } from '@/lib/order/order-item-configuration';
import { WORKBENCH_CATALOG, WORKBENCH_CRAFTS } from '@/lib/workbench/__tests__/item-fixtures';
import type { SampleOrderQuote } from '@/lib/order/sample-order';
import '@/app/globals.css';

// 业主 2026-09-24：管理员建单必须归属一个外部销售——寄样品 / 打样也一样。
const mocks = vi.hoisted(() => ({ quote: vi.fn(), create: vi.fn(), push: vi.fn() }));
vi.mock('@/actions/workbench', () => ({ quoteWorkbenchItemAction: vi.fn() }));
vi.mock('@/actions/create-order-quote', () => ({ quoteSampleOrderAction: mocks.quote }));
vi.mock('@/actions/order', () => ({ createOrderAction: mocks.create, submitOrderAction: vi.fn() }));
vi.mock('@/actions/design-upload', () => ({ signDesignUploadAction: vi.fn(), recordDesignUploadAction: vi.fn(), deleteOrderItemDesignAction: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push, replace: mocks.push, refresh: vi.fn() }) }));
vi.mock('next/image', () => ({ default: ({ alt }: { alt: string }) => <span>{alt}</span> }));
vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ prefetch: _prefetch, ...props }: ComponentProps<'a'> & { prefetch?: boolean }) => {
    void _prefetch;
    return <a {...props} />;
  },
}));
import { SalesWorkbench } from '@/components/business/workbench/SalesWorkbench';
import { OrderSampleEntry } from '../OrderSampleEntry';

const accounts = [
  { id: 'sales-1', displayName: '外销甲', username: 'sales-a' },
  { id: 'sales-2', displayName: '外销乙', username: 'sales-b' },
];
const quote: SampleOrderQuote = {
  total: '12.00', knownTotal: '12.00', quoteToken: 'token', shippingAmount: '12.00',
  packagingAmount: '0.00', packagingOptions: [], errors: [],
};
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  sessionStorage.clear();
  vi.clearAllMocks();
  mocks.quote.mockResolvedValue({ status: 'success', quote });
  mocks.create.mockResolvedValue({ status: 'success', orderId: 'order-1', orderNo: 'GD-1', itemIds: ['item-1'], pricingStatus: 'AUTO' });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
  sessionStorage.clear();
});

function renderWorkbench(externalSalesAccounts?: typeof accounts) {
  flushSync(() => root.render(
    <SalesWorkbench options={WORKBENCH_CATALOG} crafts={WORKBENCH_CRAFTS} draftScope="admin" externalSalesAccounts={externalSalesAccounts} />,
  ));
}
async function fillContact() {
  await page.getByLabelText('收货人', { exact: true }).fill('测试收货人');
  await page.getByLabelText('手机号', { exact: true }).fill('13800000000');
  await page.getByLabelText('收货地址', { exact: true }).fill('浙江省杭州市测试地址');
}

for (const purpose of ['寄样品', '打样'] as const) {
  it(`workbench ${purpose}: administrator must choose an external salesperson before saving`, async () => {
    renderWorkbench(accounts);
    await page.getByRole('button', { name: purpose, exact: true }).click();
    const select = page.getByRole('combobox', { name: '关联外部销售', exact: true });
    await expect.element(select).toBeVisible();
    await expect.element(select).toHaveValue('');
    if (purpose === '寄样品') await page.getByLabelText('样品名称').fill('工作台寄样');
    await fillContact();
    await page.getByRole('button', { name: '核对费用', exact: true }).click();
    await page.getByRole('button', { name: '保存工单', exact: true }).click();
    await expect.element(page.getByText('请选择关联外部销售', { exact: true })).toBeVisible();
    await expect.element(select).toHaveAttribute('aria-invalid', 'true');
    expect(mocks.create).not.toHaveBeenCalled();
    await select.selectOptions('sales-2');
    await expect.element(page.getByText('请选择关联外部销售', { exact: true })).not.toBeInTheDocument();
    await page.getByRole('button', { name: '核对费用', exact: true }).click();
    await page.getByRole('button', { name: '保存工单', exact: true }).click();
    await expect.poll(() => mocks.create.mock.calls.length).toBe(1);
    expect(mocks.create.mock.calls[0]![1]).toMatchObject({ externalSalesUserId: 'sales-2' });
  });
}

it('workbench sample entry shows the no-active-salesperson empty state instead of a form', async () => {
  renderWorkbench([]);
  await page.getByRole('button', { name: '寄样品', exact: true }).click();
  await expect.element(page.getByText('暂无可关联的外部销售账号', { exact: true })).toBeVisible();
  await expect.element(page.getByRole('link', { name: '前往账号管理' })).toHaveAttribute('href', '/owner/accounts');
  await expect.element(page.getByRole('button', { name: '保存工单', exact: true })).not.toBeInTheDocument();
});

it('external salespeople never see the salesperson selector', async () => {
  renderWorkbench();
  await page.getByRole('button', { name: '寄样品', exact: true }).click();
  await expect.element(page.getByLabelText('收货人', { exact: true })).toBeVisible();
  await expect.element(page.getByRole('combobox', { name: '关联外部销售', exact: true })).not.toBeInTheDocument();
});

it('new-order sample entry renders the selector when no salesperson was chosen and writes it back to the order form', async () => {
  let values: CreateOrderInput | null = null;
  function Fixture() {
    // Unsaved create forms legitimately hold incomplete facts; only the command is parsed.
    const form = useForm<CreateOrderInput>({ defaultValues: {
      customName: '样品单', receiverName: '', receiverPhone: '', receiverAddress: '',
      externalSalesUserId: null, items: [createBlankItem([])],
    } as unknown as CreateOrderInput });
    values = form.getValues();
    return <OrderSampleEntry orderKey="sample-fixture" active form={form} purpose="SAMPLE_SHIPMENT" options={WORKBENCH_CATALOG} crafts={WORKBENCH_CRAFTS}
      draftScope="admin" itemIndex={0} initialItem={form.getValues('items.0')} canEditFees
      externalSalesAccounts={accounts}
      onExternalSalesChange={(id) => { form.setValue('externalSalesUserId', id); values = form.getValues(); }}
      choosePurpose={() => {}} onRouteChange={() => {}} />;
  }
  flushSync(() => root.render(<Fixture />));
  const select = page.getByRole('combobox', { name: '关联外部销售', exact: true });
  await expect.element(select).toBeVisible();
  await select.selectOptions('sales-1');
  await expect.poll(() => values?.externalSalesUserId).toBe('sales-1');
});
