import { useEffect, useState, type ComponentProps } from 'react';
import { Input } from '@/components/ui/input';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Button } from '@/components/ui/button';
import { page } from 'vitest/browser';
import { createOrderSchema } from '@/lib/auth/schemas';
import type { OrderFormProps } from '../OrderForm';
import '@/app/globals.css';

vi.mock('next/image', () => ({ default: ({ alt }: { alt: string }) => <span>{alt}</span> }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('@/actions/order', () => ({ createOrderAction: vi.fn(), submitOrderAction: vi.fn() }));
vi.mock('@/actions/create-order-quote', () => ({ quoteExternalCreateOrderAction: vi.fn(), quoteSampleOrderAction: vi.fn() }));
vi.mock('@/actions/workbench', () => ({ quoteWorkbenchItemAction: vi.fn() }));
vi.mock('@/actions/design-upload', () => ({ deleteOrderItemDesignAction: vi.fn(), recordDesignUploadAction: vi.fn(), signDesignUploadAction: vi.fn() }));
vi.mock('next/link', () => ({ __esModule: true, default: (props: ComponentProps<'a'>) => <a {...props} /> }));
const fixtureMounts = new Map<string, number>();
vi.mock('@/components/business/order/OrderForm', () => ({
  OrderForm: function Fixture(props: OrderFormProps) {
    useEffect(() => {
      fixtureMounts.set(props.submissionId!, (fixtureMounts.get(props.submissionId!) ?? 0) + 1);
    }, [props.submissionId]);
    const [name, setName] = useState(props.initialEditor?.values.customName ?? '');
    const [busy, setBusy] = useState(false);
    const { registerEditor, active = true } = props;
    useEffect(() => {
      if (!active) return;
      registerEditor?.({ canLeave: !busy, capture: () => ({ values: createOrderSchema.parse({
        customName: name, customerRef: null, receiverName: null, receiverPhone: null, receiverAddress: '测试收货地址', expressCode: null, packageRequirement: null, remark: null, items: [{ name: '设计', quantity: 100, crafts: ['foil'], productId: 'product', pricingRoute: 'STOCK_BLANK', paperType: '红卡', paperWeightGsm: 160, specification: '大号封', remark: null, foilTechnique: 'FLAT', hasLocalFoil: true, frontFoilColors: ['亚金'] }],
      }), files: [] }) });
      return () => registerEditor?.(null);
    }, [registerEditor, active, name, busy]);
    const result = { orderId: `order-${props.submissionId}`, orderNo: `GD-${name}`, intent: 'submit' as const };
    return <div>
      <Input aria-label="模拟工单名称" value={name ?? ''} onChange={(event) => setName(event.target.value)} />
      <Button onClick={() => setBusy(true)}>开始上传</Button>
      <Button onClick={() => { props.lifecycle?.onCreated(result); setBusy(true); }}>模拟已创建但上传失败</Button>
      <Button onClick={() => { props.lifecycle?.onCreated(result); props.lifecycle?.onCompleted(result); }}>模拟创建完成</Button>
      <span>{props.submissionId}</span>
    </div>;
  },
}));
import { OrderCreationWorkspace } from '../OrderCreationWorkspace';
let host: HTMLDivElement;
let root: Root;
const props: OrderFormProps = { crafts: [], products: [], externalSalesAccounts: [], draftScope: 'workspace-test' };
function mount() { flushSync(() => root.render(<OrderCreationWorkspace {...props} />)); }
beforeEach(() => {
  sessionStorage.clear(); fixtureMounts.clear();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host); mount();
});
afterEach(() => { flushSync(() => root.unmount()); host.remove(); sessionStorage.clear(); });

it('preserves pending edits across switching, removal and undo', async () => {
  await page.getByLabelText('模拟工单名称').fill('第一单');
  await page.getByRole('button', { name: '＋ 添加工单' }).click();
  await page.getByLabelText('模拟工单名称').fill('第二单');
  await page.getByRole('button', { name: '工单 1', exact: true }).click();
  await expect.element(page.getByLabelText('模拟工单名称')).toHaveValue('第一单');
  await page.getByRole('button', { name: '移除当前工单' }).click();
  await expect.element(page.getByLabelText('模拟工单名称')).toHaveValue('第二单');
  await page.getByRole('button', { name: '撤销移除' }).click();
  await expect.element(page.getByLabelText('模拟工单名称')).toHaveValue('第一单');
});

it('locks switching after creation failure and recovers a link to the existing order on reload', async () => {
  await page.getByLabelText('模拟工单名称').fill('已保存');
  await page.getByRole('button', { name: '＋ 添加工单' }).click();
  await page.getByRole('button', { name: '模拟已创建但上传失败' }).click();
  await expect.element(page.getByRole('button', { name: '工单 1', exact: true })).toBeDisabled();
  flushSync(() => root.unmount()); root = createRoot(host); mount();
  await page.getByRole('button', { name: '工单 2 · 已保存', exact: true }).click();
  await expect.element(page.getByRole('heading', { name: '工单已保存，请继续完善' })).toBeVisible();
  await expect.element(page.getByRole('link', { name: '查看工单', exact: true })).toHaveAttribute('href', expect.stringContaining('/orders/order-'));
  await expect.element(page.getByRole('button', { name: '模拟创建完成' })).not.toBeInTheDocument();
});

it('retains earlier success when a later order fails, and resumes the remaining order', async () => {
  await page.getByLabelText('模拟工单名称').fill('第一单');
  await page.getByRole('button', { name: '＋ 添加工单' }).click();
  await page.getByLabelText('模拟工单名称').fill('第二单');
  await page.getByRole('button', { name: '工单 1', exact: true }).click();
  await page.getByRole('button', { name: '模拟创建完成' }).click();
  await expect.element(page.getByRole('button', { name: '工单 1 · 已完成' })).toBeVisible();
  await expect.element(page.getByLabelText('模拟工单名称')).toHaveValue('第二单');
  await page.getByRole('button', { name: '模拟已创建但上传失败' }).click();
  await expect.element(page.getByRole('button', { name: '工单 1 · 已完成' })).toBeDisabled();
  await page.getByRole('button', { name: '模拟创建完成' }).click();
  await expect.element(page.getByText('已完成 2 / 2 张')).toBeVisible();
});


it('starts a new batch after recovering ten saved orders without deleting server orders', async () => {
  const saved = Array.from({ length: 10 }, (_, index) => ({ id: crypto.randomUUID(),
    created: { orderId: `saved-${index}`, orderNo: `GD-${index}`, intent: 'submit' }, done: index > 0 }));
  sessionStorage.setItem('order-creation-batch:v1:workspace-test:new', JSON.stringify(saved));
  flushSync(() => root.unmount()); root = createRoot(host); mount();
  await expect.element(page.getByRole('button', { name: '＋ 添加工单' })).toBeDisabled();
  await expect.element(page.getByText('本批已达 10 张，全部保存后可开始新一批。')).toBeVisible();
  await page.getByRole('button', { name: '开始新一批', exact: true }).click();
  await expect.element(page.getByLabelText('模拟工单名称')).toHaveValue('');
  await expect.element(page.getByRole('button', { name: '工单 1', exact: true })).toBeVisible();
  const next = JSON.parse(sessionStorage.getItem('order-creation-batch:v1:workspace-test:new')!);
  expect(next).toHaveLength(1);
  expect(saved.some((entry) => entry.id === next[0].id)).toBe(false);
});

it('keeps unsaved work when the batch is full', async () => {
  for (let index = 1; index < 10; index++) await page.getByRole('button', { name: '＋ 添加工单' }).click();
  await page.getByLabelText('模拟工单名称').fill('尚未保存');
  await expect.element(page.getByRole('button', { name: '＋ 添加工单' })).toBeDisabled();
  await expect.element(page.getByRole('button', { name: '开始新一批', exact: true })).not.toBeInTheDocument();
  await expect.element(page.getByLabelText('模拟工单名称')).toHaveValue('尚未保存');
});

it('keeps each order form mounted while switching, with only the active form in the document', async () => {
  await page.getByLabelText('模拟工单名称').fill('第一单');
  await page.getByRole('button', { name: '＋ 添加工单' }).click();
  await expect.element(page.getByLabelText('模拟工单名称')).toHaveValue('');
  await page.getByLabelText('模拟工单名称').fill('第二单');
  await page.getByRole('button', { name: '工单 1', exact: true }).click();
  await expect.element(page.getByLabelText('模拟工单名称')).toHaveValue('第一单');
  await page.getByRole('button', { name: '工单 2', exact: true }).click();
  await expect.element(page.getByLabelText('模拟工单名称')).toHaveValue('第二单');
  await page.getByRole('button', { name: '工单 1', exact: true }).click();
  await expect.element(page.getByLabelText('模拟工单名称')).toHaveValue('第一单');
  expect(document.querySelectorAll('input[aria-label="模拟工单名称"]')).toHaveLength(1);
  expect(document.querySelectorAll('[data-order-form-host]')).toHaveLength(1);
  expect([...fixtureMounts.values()]).toEqual([1, 1]);
});
