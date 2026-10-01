import { useState, type ComponentProps, type ReactNode } from 'react';
import { Input } from '@/components/ui/input';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrderPricingReviewPreview } from '@/lib/order/pricing-review';

const mocks = vi.hoisted(() => ({ save: vi.fn(), remove: vi.fn(), plate: vi.fn(), removePlate: vi.fn(), preview: vi.fn(), finalize: vi.fn(), freightPreview: vi.fn(), freightFinalize: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock('next/link', () => ({
  default: ({ prefetch, ...props }: ComponentProps<'a'> & { prefetch?: boolean }) => {
    void prefetch;
    return <a {...props} />;
  },
  useLinkStatus: () => ({ pending: false }),
}));
vi.mock('@/actions/order', () => ({ saveOrderManualChargeAction: mocks.save, deleteOrderManualChargeAction: mocks.remove, saveOrderPlateDetailAction: mocks.plate, deleteOrderPlateDetailAction: mocks.removePlate, previewOrderPricingReviewAction: mocks.preview, finalizeOrderPricingAction: mocks.finalize }));
vi.mock('@/actions/order-fulfillment-pricing', () => ({ previewFulfillmentPricingAction: mocks.freightPreview, finalizeFulfillmentPricingAction: mocks.freightFinalize }));

import { OrderCommercialDetailsManager } from '../OrderCommercialDetailsManager';
import { OrderPricingReviewForm } from '../OrderPricingReviewForm';
import { FulfillmentPricingReviewForm } from '../FulfillmentPricingReviewForm';
import { OrderEditorAuxiliaryContext, useOrderEditorAuxiliaryController } from '../use-order-editor-auxiliary';

function Harness({ children }: { children: ReactNode }) {
  const [mainDirty, setMainDirty] = useState(false);
  const auxiliary = useOrderEditorAuxiliaryController(mainDirty);
  return <OrderEditorAuxiliaryContext.Provider value={auxiliary.context}>
    <Input aria-label="主工单名称" disabled={auxiliary.dirty || auxiliary.pending} onChange={() => setMainDirty(true)} />
    <output data-testid="dirty">{String(auxiliary.dirty)}</output>
    <output data-testid="pending">{String(auxiliary.pending)}</output>
    {children}
  </OrderEditorAuxiliaryContext.Provider>;
}

const commercial = <OrderCommercialDetailsManager orderId="order-1" priceRevision={1} manualCharges={[]} allowPlateDetailMaintenance items={[{ id: 'item-1', sequence: 1, name: '测试款式', independentPlateEligible: true, plateDetails: [] }]} />;
const freight = <FulfillmentPricingReviewForm orderId="order-1" currentValue={false} isPricingPending={false} shipments={[{ id: 'shipment-1', sequence: 1, destinationProvince: '浙江', weightKg: '2' }]} />;
const initialPreview: OrderPricingReviewPreview = {
  orderId: 'order-1', orderNo: 'GD-260908-001', orderRevision: 1, priceRevision: 1,
  currentProcessingAmount: '170.00', currentPackagingAmount: '10.00', currentTotalAmount: '180.00',
  processingPriceBook: null, logisticsPriceBook: null, items: [], packagingGroups: [], orderCharges: [], shipments: [],
};
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.resetAllMocks();
  mocks.preview.mockResolvedValue({ status: 'success', preview: initialPreview });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { flushSync(() => root.unmount()); host.remove(); });
const main = () => host.querySelector<HTMLInputElement>('[aria-label="主工单名称"]')!;
const input = (label: string) => [...host.querySelectorAll('label')].find((entry) => entry.textContent?.trim() === label)?.querySelector('input, textarea') as HTMLInputElement | HTMLTextAreaElement;
const button = (label: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find((entry) => entry.textContent?.trim() === label)!;
function fill(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(element, value);
  flushSync(() => element.dispatchEvent(new Event('input', { bubbles: true })));
}

describe('administrator independently saved fee drafts', () => {
  it('locks the main form and other fee rows until the edited fee is explicitly restored', async () => {
    flushSync(() => root.render(<Harness>{commercial}</Harness>));
    fill(host.querySelector<HTMLInputElement>('[aria-label="整单费用金额"]')!, '25');
    await vi.waitFor(() => expect(main().disabled).toBe(true));
    expect(input('制版名称').matches(':disabled')).toBe(true);
    expect(button('添加制版明细').disabled).toBe(true);
    expect(host.querySelector('[data-testid="dirty"]')?.textContent).toBe('true');
    button('还原费用输入').click();
    await vi.waitFor(() => expect(main().disabled).toBe(false));
    expect(host.querySelector<HTMLInputElement>('[aria-label="整单费用金额"]')?.value).toBe('');
    expect(input('制版名称').matches(':disabled')).toBe(false);
  });

  it('holds the fee lock throughout an async save and preserves input after failure', async () => {
    let resolve!: (result: { status: string; message: string }) => void;
    mocks.save.mockImplementation(() => new Promise((done) => { resolve = done; }));
    flushSync(() => root.render(<Harness>{commercial}</Harness>));
    fill(host.querySelector<HTMLInputElement>('[aria-label="整单费用金额"]')!, '25');
    fill(input('收费说明'), '客户打样');
    fill(input('原因'), '按客户确认报价');
    button('添加费用').click();
    await vi.waitFor(() => expect(host.querySelector('[data-testid="pending"]')?.textContent).toBe('true'));
    expect(main().disabled).toBe(true);
    expect(button('还原费用输入').disabled).toBe(true);
    expect(input('制版名称').matches(':disabled')).toBe(true);
    resolve({ status: 'error', message: '本次未保存，请重试' });
    await vi.waitFor(() => expect(host.querySelector('[data-testid="pending"]')?.textContent).toBe('false'));
    expect(main().disabled).toBe(true);
    expect(input('收费说明').value).toBe('客户打样');
    button('还原费用输入').click();
    await vi.waitFor(() => expect(main().disabled).toBe(false));
  });

  it('blocks fee inputs when a main draft exists and leaves standalone pages independent', async () => {
    flushSync(() => root.render(<Harness>{commercial}</Harness>));
    fill(main(), '未保存的主草稿');
    expect(input('制版名称').matches(':disabled')).toBe(true);
    flushSync(() => root.render(commercial));
    expect(input('制版名称').matches(':disabled')).toBe(false);
    fill(host.querySelector<HTMLInputElement>('[aria-label="整单费用金额"]')!, '25');
    expect(input('制版名称').matches(':disabled')).toBe(false);
  });

  it('tracks manual pricing input and restores it without submitting financial changes', async () => {
    flushSync(() => root.render(<Harness><OrderPricingReviewForm orderId="order-1" />{commercial}</Harness>));
    await vi.waitFor(() => expect(input('整单费用备注（可选）')).toBeTruthy());
    fill(input('整单费用备注（可选）'), '待确认费用');
    expect(main().disabled).toBe(true);
    expect(input('制版名称').matches(':disabled')).toBe(true);
    button('还原核价输入').click();
    await vi.waitFor(() => expect(main().disabled).toBe(false));
    expect(input('整单费用备注（可选）').value).toBe('');
    expect(mocks.finalize).not.toHaveBeenCalled();
  });

  it('restores uncontrolled freight fields and clears the accepted preview', async () => {
    mocks.freightPreview.mockResolvedValue({ status: 'success', preview: {
      orderId: 'order-1', isSfCollect: false, expectedOrderRevision: 1, expectedEditVersion: 1,
      expectedWorkOrderVersion: 1, expectedPriceRevision: 1, previewToken: 'test-preview',
      oldTotal: '180.00', newTotal: '190.00', delta: '10.00', canConfirm: true, issues: [], shipments: [],
    } });
    flushSync(() => root.render(<Harness>{freight}{commercial}</Harness>));
    const weight = host.querySelector<HTMLInputElement>('[name="sfShipmentWeightKg"]')!;
    fill(weight, '5');
    expect(main().disabled).toBe(true);
    expect(input('制版名称').matches(':disabled')).toBe(true);
    button('预览费用差额').click();
    await vi.waitFor(() => expect(button('确认物流费用')).toBeTruthy());
    button('还原物流输入').click();
    await vi.waitFor(() => expect(main().disabled).toBe(false));
    expect(host.querySelector<HTMLInputElement>('[name="sfShipmentWeightKg"]')?.value).toBe('2');
    expect(button('确认物流费用')).toBeUndefined();
    expect(mocks.freightFinalize).not.toHaveBeenCalled();
  });
});
