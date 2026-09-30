import '@/app/globals.css';

import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { page } from 'vitest/browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { finalizeActionMock, previewActionMock, refreshMock } = vi.hoisted(() => ({
  finalizeActionMock: vi.fn(),
  previewActionMock: vi.fn(),
  refreshMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));
vi.mock('next/link', () => ({ default: ({ prefetch, ...props }: React.ComponentProps<'a'> & { prefetch?: boolean }) => { void prefetch; return <a {...props} />; } }));

vi.mock('@/generated/prisma/client', async () => ({ ...await import('@/generated/prisma/enums'), Prisma: { Decimal: (await import('decimal.js')).default } }));
vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('@/actions/order-fulfillment-pricing', () => ({
  finalizeFulfillmentPricingAction: finalizeActionMock,
  previewFulfillmentPricingAction: previewActionMock,
}));

import { FulfillmentPricingReviewForm } from '../FulfillmentPricingReviewForm';

const previewToken = `fulfillment-pricing-v1:${'a'.repeat(64)}`;
const shipments = [
  {
    id: 'shipment-1',
    sequence: 1,
    destinationProvince: '浙江',
    weightKg: '2',
  },
];

type Props = React.ComponentProps<typeof FulfillmentPricingReviewForm>;

function pricingPreview(overrides: Record<string, unknown> = {}) {
  return {
    orderId: 'order-1',
    isSfCollect: false,
    expectedOrderRevision: 4,
    expectedEditVersion: 2,
    expectedWorkOrderVersion: 3,
    expectedPriceRevision: 5,
    previewToken,
    oldTotal: '155.00',
    newTotal: '166.50',
    delta: '11.50',
    canConfirm: true,
    issues: [],
    shipments: [
      {
        shipmentId: 'shipment-1',
        sequence: 1,
        currentShippingFee: '8.00',
        shippingFee: '19.50',
      },
    ],
    ...overrides,
  };
}

function mountForm(overrides: Partial<Props> = {}) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  flushSync(() => {
    root.render(
      <FulfillmentPricingReviewForm
        orderId="order-1"
        currentValue={false}
        isPricingPending
        shipments={shipments}
        {...overrides}
      />,
    );
  });
  return { host, root };
}

function unmount(root: Root, host: HTMLElement) {
  flushSync(() => root.unmount());
  host.remove();
}

async function settleEffects() {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

function buttonWithText(host: HTMLElement, text: string) {
  return [...host.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => button.textContent?.trim() === text,
  );
}

function setInputValue(element: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
    element,
    value,
  );
  element.dispatchEvent(new Event('input', { bubbles: true }));
}

function setSelectValue(element: HTMLSelectElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set?.call(
    element,
    value,
  );
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

async function waitForPreview(host: HTMLElement) {
  await vi.waitFor(() => {
    expect(buttonWithText(host, '确认物流费用')).not.toBeUndefined();
  });
}

async function confirmPreview(host: HTMLElement, doubleClick = false) {
  // This page already reviews per-shipment amounts and the total difference.
  // Submit directly from that review; no second generic confirmation layer.
  expect(host.textContent).toContain('更正前合计');
  expect(host.textContent).toContain('更正后合计');
  expect(host.textContent).toContain('本次差额');
  const confirmation = buttonWithText(host, '确认物流费用')!;
  confirmation.click();
  if (doubleClick) confirmation.click();
  await expect.element(page.getByRole('alertdialog')).not.toBeInTheDocument();
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('FulfillmentPricingReviewForm browser contract', () => {
  it('没有服务端预览时不能确认；未修改时仅待计价恢复态可预览当前值', () => {
    const regular = mountForm({ isPricingPending: false });
    try {
      const regularPreview = buttonWithText(regular.host, '预览费用差额');
      expect(regularPreview?.disabled).toBe(true);
      expect(buttonWithText(regular.host, '确认物流费用')).toBeUndefined();
      regularPreview?.click();
      expect(previewActionMock).not.toHaveBeenCalled();
      expect(finalizeActionMock).not.toHaveBeenCalled();
    } finally {
      unmount(regular.root, regular.host);
    }

    const recovery = mountForm({ isPricingPending: true });
    try {
      expect(buttonWithText(recovery.host, '预览费用差额')?.disabled).toBe(false);
      expect(buttonWithText(recovery.host, '确认物流费用')).toBeUndefined();
    } finally {
      unmount(recovery.root, recovery.host);
    }
  });

  it('已确认非到付工单仍能修改计费事实并重新预览，不必反复切换物流方式', async () => {
    previewActionMock.mockResolvedValue({ status: 'success', preview: pricingPreview() });
    const { host, root } = mountForm({ isPricingPending: false });
    try {
      expect(buttonWithText(host, '预览费用差额')?.disabled).toBe(true);
      setInputValue(host.querySelector<HTMLInputElement>('[name="sfShipmentWeightKg"]')!, '3');
      await vi.waitFor(() => expect(buttonWithText(host, '预览费用差额')?.disabled).toBe(false));
      buttonWithText(host, '预览费用差额')?.click();
      await waitForPreview(host);
      expect(previewActionMock).toHaveBeenCalledWith(null, expect.objectContaining({
        isSfCollect: false,
        shipments: [expect.objectContaining({ weightKg: '3' })],
      }));
    } finally {
      unmount(root, host);
    }
  });

  it('只展示物流输入和服务端返回的更正前、后与差额', async () => {
    previewActionMock.mockResolvedValue({
      status: 'success',
      preview: pricingPreview(),
    });
    const { host, root } = mountForm();

    try {
      setInputValue(
        host.querySelector<HTMLInputElement>('[name="sfShipmentShippingFee"]')!,
        '19.50',
      );
      setInputValue(
        host.querySelector<HTMLInputElement>(
          '[name="sfShipmentChargeOverrideReason"]',
        )!,
        '承运商实际账单',
      );
      buttonWithText(host, '预览费用差额')?.click();
      await waitForPreview(host);

      expect(previewActionMock).toHaveBeenCalledWith(null, {
        orderId: 'order-1',
        isSfCollect: false,
        shipments: [
          {
            shipmentId: 'shipment-1',
            destinationProvince: '浙江',
            weightKg: '2',
            shippingFee: '19.50',
            customerChargeOverrideReason: '承运商实际账单',
          },
        ],
      });
      expect(host.textContent).toContain('更正前合计');
      expect(host.textContent).toContain('¥ 155.00');
      expect(host.textContent).toContain('更正后合计');
      expect(host.textContent).toContain('¥ 166.50');
      expect(host.textContent).toContain('本次差额');
      expect(host.textContent).toContain('¥ 11.50');
      expect(host.textContent).toContain('快递费 ¥ 8.00 → ¥ 19.50');

      const names = new Set(
        [...host.querySelectorAll<HTMLElement>('[name]')].map((element) =>
          element.getAttribute('name'),
        ),
      );
      expect(names).toEqual(
        new Set([
          'sfShipmentId',
          'sfShipmentDestinationProvince',
          'sfShipmentWeightKg',
          'sfShipmentShippingFee',
          'sfShipmentChargeOverrideReason',
        ]),
      );
      for (const forbidden of ['unitPrice', 'fixedFee', 'processingAmount']) {
        expect(host.querySelector(`[name="${forbidden}"]`)).toBeNull();
      }
    } finally {
      unmount(root, host);
    }
  });

  it('修改物流金额或目标方式都会使已接受的预览失效', async () => {
    previewActionMock.mockResolvedValue({
      status: 'success',
      preview: pricingPreview(),
    });
    const { host, root } = mountForm();

    try {
      buttonWithText(host, '预览费用差额')?.click();
      await waitForPreview(host);

      setInputValue(
        host.querySelector<HTMLInputElement>('[name="sfShipmentShippingFee"]')!,
        '20.00',
      );
      await settleEffects();
      expect(buttonWithText(host, '确认物流费用')).toBeUndefined();
      expect(host.textContent).not.toContain('更正前合计');

      buttonWithText(host, '预览费用差额')?.click();
      await vi.waitFor(() => expect(previewActionMock).toHaveBeenCalledTimes(2));
      await waitForPreview(host);

      setSelectValue(host.querySelector<HTMLSelectElement>('select:not([name])')!, 'true');
      await settleEffects();
      expect(buttonWithText(host, '确认物流费用')).toBeUndefined();
      expect(host.textContent).not.toContain('更正前合计');
    } finally {
      unmount(root, host);
    }
  });

  it('输入变化后到达的旧预览响应不会重新解锁确认', async () => {
    const response = deferred<{
      status: 'success';
      preview: ReturnType<typeof pricingPreview>;
    }>();
    previewActionMock.mockReturnValue(response.promise);
    const { host, root } = mountForm();

    try {
      const previewButton = buttonWithText(host, '预览费用差额');
      previewButton?.click();
      previewButton?.click();
      setInputValue(
        host.querySelector<HTMLInputElement>('[name="sfShipmentShippingFee"]')!,
        '21.00',
      );
      response.resolve({ status: 'success', preview: pricingPreview() });
      await settleEffects();

      expect(previewActionMock).toHaveBeenCalledTimes(1);
      expect(buttonWithText(host, '确认物流费用')).toBeUndefined();
      expect(host.textContent).not.toContain('更正前合计');
    } finally {
      unmount(root, host);
    }
  });

  it('服务端声明不可确认时展示问题并禁用确认', async () => {
    previewActionMock.mockResolvedValue({
      status: 'success',
      preview: pricingPreview({
        canConfirm: false,
        issues: ['存在未处理的物流成本冲突'],
      }),
    });
    const { host, root } = mountForm();

    try {
      buttonWithText(host, '预览费用差额')?.click();
      await waitForPreview(host);

      const confirm = buttonWithText(host, '确认物流费用');
      expect(host.textContent).toContain('存在未处理的物流成本冲突');
      expect(confirm?.disabled).toBe(true);
      confirm?.click();
      expect(finalizeActionMock).not.toHaveBeenCalled();
    } finally {
      unmount(root, host);
    }
  });

  it('确认只提交已预览的原始物流快照、四版本、令牌和一个 UUID，且双击不重复', async () => {
    previewActionMock.mockResolvedValue({
      status: 'success',
      preview: pricingPreview(),
    });
    const completion = deferred<{
      status: 'success';
      result: Record<string, never>;
      orderId: string;
    }>();
    finalizeActionMock.mockReturnValue(completion.promise);
    const { host, root } = mountForm();

    try {
      setInputValue(
        host.querySelector<HTMLInputElement>('[name="sfShipmentShippingFee"]')!,
        '19.50',
      );
      setInputValue(
        host.querySelector<HTMLInputElement>(
          '[name="sfShipmentChargeOverrideReason"]',
        )!,
        '承运商实际账单',
      );
      buttonWithText(host, '预览费用差额')?.click();
      await waitForPreview(host);

      await confirmPreview(host, true);
      await vi.waitFor(() => expect(finalizeActionMock).toHaveBeenCalledTimes(1));

      expect(finalizeActionMock).toHaveBeenCalledWith(null, {
        orderId: 'order-1',
        isSfCollect: false,
        shipments: [
          {
            shipmentId: 'shipment-1',
            destinationProvince: '浙江',
            weightKg: '2',
            shippingFee: '19.50',
            customerChargeOverrideReason: '承运商实际账单',
          },
        ],
        expectedOrderRevision: 4,
        expectedEditVersion: 2,
        expectedWorkOrderVersion: 3,
        expectedPriceRevision: 5,
        previewToken,
        idempotencyKey: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
        ),
      });

      completion.resolve({ status: 'success', result: {}, orderId: 'order-1' });
      await vi.waitFor(() => {
        expect(host.textContent).toContain('物流费用已确认。');
        expect(refreshMock).toHaveBeenCalledTimes(1);
      });
    } finally {
      unmount(root, host);
    }
  });

  it('确认遇到网络异常后保留同一幂等键重试，成功后只刷新一次', async () => {
    previewActionMock.mockResolvedValue({
      status: 'success',
      preview: pricingPreview(),
    });
    finalizeActionMock
      .mockRejectedValueOnce(new Error('connection reset'))
      .mockResolvedValueOnce({ status: 'success', result: {}, orderId: 'order-1' });
    const { host, root } = mountForm();

    try {
      buttonWithText(host, '预览费用差额')?.click();
      await waitForPreview(host);
      await confirmPreview(host);

      await vi.waitFor(() => {
        expect(host.textContent).toContain('暂未收到确认结果，请重试');
        expect(finalizeActionMock).toHaveBeenCalledTimes(1);
      });
      const firstPayload = finalizeActionMock.mock.calls[0]![1];
      await confirmPreview(host);

      await vi.waitFor(() => {
        expect(finalizeActionMock).toHaveBeenCalledTimes(2);
        expect(refreshMock).toHaveBeenCalledTimes(1);
      });
      expect(finalizeActionMock.mock.calls[1]![1]).toEqual(firstPayload);
    } finally {
      unmount(root, host);
    }
  });

  it('375px 视口下完整物流输入和预览不会产生横向溢出', async () => {
    const previousViewport = { width: window.innerWidth, height: window.innerHeight };
    await page.viewport(375, 812);
    previewActionMock.mockResolvedValue({
      status: 'success',
      preview: pricingPreview(),
    });
    const { host, root } = mountForm({
      shipments: [
        ...shipments,
        {
          id: 'shipment-with-a-long-identity-2',
          sequence: 2,
          destinationProvince: '内蒙古',
          weightKg: '12.75',
        },
      ],
    });

    try {
      buttonWithText(host, '预览费用差额')?.click();
      await waitForPreview(host);
      await settleEffects();

      expect(window.innerWidth).toBe(375);
      expect(host.scrollWidth).toBeLessThanOrEqual(host.clientWidth + 1);
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
        document.documentElement.clientWidth + 1,
      );
    } finally {
      unmount(root, host);
      await page.viewport(previousViewport.width, previousViewport.height);
    }
  });
});
