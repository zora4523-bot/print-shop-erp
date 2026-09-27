import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import '@/app/globals.css';

const mocks = vi.hoisted(() => ({ warehouse: vi.fn(), location: vi.fn() }));
vi.mock('@/actions/owner-warehouses', () => ({ createWarehouseAction: mocks.warehouse, createWarehouseLocationAction: mocks.location }));
vi.mock('next/link', () => ({ __esModule: true, default: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a> }));
import { WarehouseForms } from '../WarehouseForms';
import { StockTransactionForm } from '../../material/StockTransactionForm';
import { PurchaseReceiptForm } from '../../purchase/PurchaseReceiptForm';

let host: HTMLElement; let root: Root;
beforeEach(() => { vi.resetAllMocks(); host = document.createElement('main'); document.body.append(host); root = createRoot(host); });
afterEach(() => { flushSync(() => root.unmount()); host.remove(); });
const locationOptions = [{ id: 'side', warehouseId: 'warehouse', warehouseCode: 'WH', warehouseName: '分仓', code: 'SIDE', name: '旁库位', isDefault: false }];

it.each(['movement', 'receipt'] as const)('%s confirms and submits the same default location after success resets the form', async (kind) => {
  const action = vi.fn().mockResolvedValue({ status: 'success', message: '已过账' });
  flushSync(() => root.render(kind === 'movement'
    ? <StockTransactionForm action={action} unit="件" initialIdempotencyKey="request" locationOptions={locationOptions} />
    : <PurchaseReceiptForm action={action} unit="件" initialIdempotencyKey="request" locationOptions={locationOptions} purchaseOrderItemId="item" remainingQuantity="100" defaultUnitCost="1" />));
  const location = page.getByRole('combobox', { name: kind === 'movement' ? '库位' : '收货库位', exact: true });
  const quantity = page.getByRole('textbox', { name: kind === 'movement' ? '数量（件）' : '本次收货数量（件）', exact: true });
  const prepare = page.getByRole('button', { name: kind === 'movement' ? '核对并提交出入库' : '核对并确认收货过账', exact: true });
  if (kind === 'movement') {
    await page.getByRole('combobox', { name: '方向', exact: true }).selectOptions('OUT');
    await page.getByRole('combobox', { name: '原因', exact: true }).selectOptions('OTHER');
  }
  await location.selectOptions('side'); await quantity.fill('2'); await prepare.click();
  await expect.element(page.getByRole('alertdialog')).toHaveTextContent('分仓 / 旁库位');
  await page.getByRole('alertdialog').getByRole('button', { name: kind === 'movement' ? '确认提交出入库' : '收货过账', exact: true }).click();
  await vi.waitFor(() => expect(action).toHaveBeenCalledTimes(1));
  await expect.element(quantity).toHaveValue('');
  await expect.element(location).toHaveValue('');
  await quantity.fill('3'); await prepare.click();
  await expect.element(page.getByRole('alertdialog')).toHaveTextContent('系统默认库位');
  if (kind === 'movement') await expect.element(page.getByRole('alertdialog')).toHaveTextContent('方向：入库');
  await page.getByRole('alertdialog').getByRole('button', { name: kind === 'movement' ? '确认提交出入库' : '收货过账', exact: true }).click();
  await vi.waitFor(() => expect(action).toHaveBeenCalledTimes(2));
  expect((action.mock.calls[1]![1] as FormData).get('locationId')).toBe('');
  if (kind === 'movement') {
    expect((action.mock.calls[1]![1] as FormData).get('direction')).toBe('IN');
    expect((action.mock.calls[1]![1] as FormData).get('reasonType')).toBe('RETURN');
  }
});

it.each(['warehouse', 'location'] as const)('%s creation retains failed input but clears successful input and parent selection', async (kind) => {
  const action = mocks[kind];
  action.mockResolvedValueOnce({ status: 'error', message: '请稍后重试' }).mockResolvedValueOnce({ status: 'success', message: '已创建' });
  flushSync(() => root.render(<WarehouseForms warehouses={[{ id: 'warehouse', code: 'WH', name: '分仓', isActive: true }]} />));
  const name = page.getByRole('textbox', { name: kind === 'warehouse' ? '仓库名称' : '库位名称', exact: true });
  if (kind === 'location') await page.getByRole('combobox', { name: '所属仓库', exact: true }).selectOptions('warehouse');
  await name.fill('测试位置');
  const submit = page.getByRole('button', { name: kind === 'warehouse' ? '创建仓库' : '创建库位', exact: true });
  await submit.click(); await expect.element(page.getByRole('alert')).toHaveTextContent('请稍后重试');
  await expect.element(name).toHaveValue('测试位置');
  await submit.click(); await vi.waitFor(() => expect(action).toHaveBeenCalledTimes(2));
  await expect.element(name).toHaveValue('');
  if (kind === 'location') await expect.element(page.getByRole('combobox', { name: '所属仓库', exact: true })).toHaveValue('');
});
