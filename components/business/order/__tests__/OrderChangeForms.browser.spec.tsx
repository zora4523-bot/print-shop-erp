import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import type { ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import {
  OrderItemPricingRoute,
  OrderStatus,
} from '@/generated/prisma/enums';
import type { OrderChangePricingPreview } from '@/lib/order/change-request';
import type { AdminOrderWorkspaceRow } from '@/lib/order/admin-workspace';

const {
  cancelPreviewActionMock,
  createActionMock,
  previewActionMock,
  reviewActionMock,
  refreshMock,
} = vi.hoisted(() => ({
    cancelPreviewActionMock: vi.fn(),
    createActionMock: vi.fn(),
    previewActionMock: vi.fn(),
    reviewActionMock: vi.fn(),
    refreshMock: vi.fn(),
  }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('@/actions/order', () => ({
  createOrderChangeRequestAction: createActionMock,
  previewOrderChangeRequestPricingAction: previewActionMock,
  previewOrderCancellationSettlementAction: cancelPreviewActionMock,
  reviewOrderChangeRequestAction: reviewActionMock,
}));

vi.mock('@/actions/admin-order-workflow', () => ({
  confirmFactoryOrderAction: vi.fn(),
  holdFactoryOrderAction: vi.fn(),
  rejectFactoryOrderAction: vi.fn(),
  releaseFactoryOrderAction: vi.fn(),
  resumeFactoryOrderAction: vi.fn(),
  runAdminOrderBatchAction: vi.fn(),
  settleFactoryOrderAction: vi.fn(),
}));

vi.mock('@/components/ui-business', () => ({
  ConfirmActionDialog: ({
    confirmLabel,
    disabled,
    onConfirm,
  }: {
    confirmLabel: string;
    disabled?: boolean;
    onConfirm: () => void;
  }) => (
    <button
      type="button"
      data-native-button-reason="browser test confirmation harness"
      data-testid={confirmLabel.includes('批准') ? 'approve-change' : 'deny-change'}
      disabled={disabled}
      onClick={onConfirm}
    >
      {confirmLabel}
    </button>
  ),
}));

import { OrderChangeRequestForm } from '../OrderChangeRequestForm';
import { OrderChangeReviewForm } from '../OrderChangeReviewForm';
import { AdminOrderDecisionPanel } from '../AdminOrderDecisionPanel';

const requestItem = {
  id: 'item-1',
  sequence: 1,
  name: '珠光红包',
  quantity: 1_000,
  productId: 'product-1',
  pricingRoute: OrderItemPricingRoute.STOCK_BLANK,
  specification: '中号封',
  paperType: '160g珠光纸',
  paperWeightGsm: 160,
  frontFoilColors: ['哑金'],
  backFoilColors: [],
  foilColors: ['哑金'],
  isDoubleSided: false,
};

function pricingPreview(
  overrides: Partial<OrderChangePricingPreview> = {},
): OrderChangePricingPreview {
  return {
    requestId: 'request-1',
    orderId: 'order-1',
    baseRevision: 2,
    priceRevision: 5,
    quoteToken: `order-change-approval-v1:${'a'.repeat(64)}`,
    quotedAt: '2026-09-03T08:00:00.000Z',
    complete: true,
    requiresReviewRemark: false,
    totalExcludesPendingPlateFee: false,
    oldTotal: '1000.00',
    newTotal: '1200.00',
    delta: '200.00',
    items: [
      {
        changeIndex: 0,
        operation: 'UPDATE',
        sourceItemId: 'item-1',
        previousName: '珠光红包',
        name: '珠光红包',
        previousQuantity: 1_000,
        quantity: 1_200,
        previousSpecification: '中号封',
        specification: '大号封',
        previousFrontFoilColors: ['哑金'],
        frontFoilColors: ['亮金'],
        previousBackFoilColors: [],
        backFoilColors: ['红金'],
        priceImpact: 'QUOTED',
        oldSubtotal: '1000.00',
        newSubtotal: '1200.00',
        suggestedUnitPrice: '1.0000',
        suggestedFixedFee: '0.00',
        errors: [],
      },
    ],
    pendingCharges: [],
    ...overrides,
  };
}

function decisionOrder(): AdminOrderWorkspaceRow {
  return {
    id: 'order-1',
    orderNo: 'GD-260903-001',
    revision: 4,
    workOrderVersion: 2,
    customName: '裁决表单测试',
    customer: { id: 'party-1', name: '客户甲', filterValue: '客户甲' },
    submitter: { id: 'sales-1', name: '业务员甲' },
    status: OrderStatus.CONFIRMED,
    statusSummary: null,
    isUrgent: false,
    isStarred: false,
    createdAt: '2026-09-03T01:00:00.000Z',
    submittedAt: '2026-09-03T01:00:00.000Z',
    promisedDate: '2026-09-05',
    dueAlert: null,
    itemCount: 1,
    totalQuantity: 1_000,
    craftSummary: '局部烫金',
    thumbnail: null,
    items: [
      {
        id: 'item-1',
        sequence: 1,
        fig: 1,
        name: '图一',
        quantity: 1_000,
        specification: '中号封',
        paper: '珠光纸 160g',
        crafts: ['局部烫金'],
        thumbnail: null,
      },
    ],
    fee: { amount: '1000.00', source: 'CONFIRMED', estimated: false },
    feeStages: {
      quoted: '1000.00',
      confirmed: '1000.00',
      settled: null,
      active: 'CONFIRMED',
    },
    priceComparison: null,
    priceComparisonError: null,
    confirmationPreflight: { ok: false, issues: [] },
    capabilities: {
      confirm: false,
      reject: true,
      hold: true,
      resume: true,
      release: false,
      ship: false,
      settle: false,
      createPrint: false,
      markPrinted: false,
      reviewChange: true,
    },
    billing: null,
    pendingChangeRequest: {
      id: 'cancel-request-1',
      type: 'CANCEL',
      reason: '客户取消',
      createdAt: '2026-09-03T02:00:00.000Z',
    },
    printPending: false,
    pendingPrintJobId: null,
    trackingNo: null,
    progress: {
      orderTotal: '1000',
      foilingProgress: '0',
      packingProgress: '0',
      foilingOverLimit: false,
      packingOverLimit: false,
      packingAhead: false,
      stagnant: false,
      stagnationDays: 0,
      firstClaimedAt: null,
    },
    logs: [],
  };
}

async function settleEffects() {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

function setValue(
  element: HTMLInputElement | HTMLTextAreaElement,
  value: string,
) {
  const prototype =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
}

function buttonWithText(host: HTMLElement, text: string) {
  return [...host.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => button.textContent?.trim() === text,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

it('冲突后刷新成功会移除旧审批错误并恢复批准', async () => {
  previewActionMock.mockResolvedValue({
    status: 'success',
    preview: pricingPreview(),
  });
  reviewActionMock.mockResolvedValue({
    status: 'error',
    message: '价格版本已变化，请刷新后重试。',
  });
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);

  try {
    flushSync(() =>
      root.render(
        <OrderChangeReviewForm
          requestId="request-1"
          currentItems={[
            { id: 'item-1', sequence: 1, name: '珠光红包', quantity: 1_000 },
          ]}
        />,
      ),
    );

    await vi.waitFor(() => {
      expect(
        host.querySelector<HTMLButtonElement>('[data-testid="approve-change"]')
          ?.disabled,
      ).toBe(false);
    });
    host
      .querySelector<HTMLButtonElement>('[data-testid="approve-change"]')
      ?.click();
    await vi.waitFor(() => {
      expect(host.textContent).toContain('价格版本已变化');
    });

    const refresh = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent?.includes('刷新最新计价预览'),
    );
    expect(refresh).not.toBeUndefined();
    refresh?.click();

    await vi.waitFor(() => {
      expect(previewActionMock).toHaveBeenCalledTimes(2);
      expect(host.textContent).not.toContain('价格版本已变化');
      expect(
        host.querySelector<HTMLButtonElement>('[data-testid="approve-change"]')
          ?.disabled,
      ).toBe(false);
    });
  } finally {
    flushSync(() => root.unmount());
    host.remove();
  }
});

it('工单 revision 或款式事实更新后重建草稿，不混用旧输入', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const renderForm = (revision: number, quantity: number) => (
    <OrderChangeRequestForm
      orderId="order-1"
      expectedRevision={revision}
      expectedWorkOrderVersion={2}
      items={[{ ...requestItem, quantity }]}
      catalogProducts={[]}
    />
  );

  try {
    flushSync(() => root.render(renderForm(4, 1_000)));
    const checkbox = host.querySelector<HTMLElement>(
      '[role="checkbox"][aria-label^="选择款式 1"]',
    );
    checkbox?.click();
    await settleEffects();

    const quantity = host.querySelector<HTMLInputElement>('input[type="number"]');
    const reason = host.querySelector<HTMLTextAreaElement>('textarea');
    expect(quantity?.value).toBe('1000');
    setValue(quantity!, '2500');
    setValue(reason!, '客户改量');
    await settleEffects();
    expect(quantity?.value).toBe('2500');
    expect(reason?.value).toBe('客户改量');

    flushSync(() => root.render(renderForm(5, 3_000)));
    await settleEffects();

    const refreshedCheckbox = host.querySelector<HTMLElement>(
      '[role="checkbox"][aria-label^="选择款式 1"]',
    );
    expect(refreshedCheckbox?.getAttribute('aria-checked')).toBe('false');
    expect(host.querySelector('input[type="number"]')).toBeNull();
    expect(host.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('');

    refreshedCheckbox?.click();
    await settleEffects();
    expect(
      host.querySelector<HTMLInputElement>('input[type="number"]')?.value,
    ).toBe('3000');
  } finally {
    flushSync(() => root.unmount());
    host.remove();
  }
});

it('目录规格可用性刷新后重建草稿', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const catalogProduct = {
    id: 'product-1',
    category: 'BLANK_STOCK',
    specification: '中号封',
    paperType: '160g珠光纸',
    weight: 160,
    isActive: true,
    paperMaterialId: 'paper-1',
    linkedPaper: { isActive: true, outOfStock: false },
  };
  const renderForm = (outOfStock: boolean) => (
    <OrderChangeRequestForm
      orderId="order-1"
      expectedRevision={4}
      expectedWorkOrderVersion={2}
      items={[requestItem]}
      catalogProducts={[
        {
          ...catalogProduct,
          linkedPaper: { ...catalogProduct.linkedPaper, outOfStock },
        },
      ]}
    />
  );

  try {
    flushSync(() => root.render(renderForm(false)));
    host
      .querySelector<HTMLElement>(
        '[role="checkbox"][aria-label^="选择款式 1"]',
      )
      ?.click();
    await settleEffects();
    setValue(
      host.querySelector<HTMLInputElement>('input[type="number"]')!,
      '2500',
    );
    setValue(host.querySelector<HTMLTextAreaElement>('textarea')!, '客户改量');
    await settleEffects();

    flushSync(() => root.render(renderForm(true)));
    await settleEffects();

    expect(
      host
        .querySelector<HTMLElement>(
          '[role="checkbox"][aria-label^="选择款式 1"]',
        )
        ?.getAttribute('aria-checked'),
    ).toBe('false');
    expect(host.querySelector('input[type="number"]')).toBeNull();
    expect(host.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('');
  } finally {
    flushSync(() => root.unmount());
    host.remove();
  }
});

it('逐票运费必须以完整事实重新预览，任何编辑都会重新锁定批准', async () => {
  const unresolvedCharge = {
    businessKey: 'shipping:shipment-2',
    categoryCode: 'SHIPPING_FEE' as const,
    shipmentId: 'shipment-2',
    shipmentSequence: 2,
    destinationProvince: '广东省',
    projectedQuantity: 400,
    description: '多地址配送运费待核对',
    errors: ['未匹配到唯一物流规则'],
    amount: null,
    reason: null,
  };
  const initialPreview = pricingPreview({
    complete: false,
    newTotal: null,
    delta: null,
    pendingCharges: [unresolvedCharge],
  });
  const resolvedPreview = pricingPreview({
    pendingCharges: [
      {
        ...unresolvedCharge,
        amount: '88.50',
        reason: '物流商报价 Q-20260903',
      },
    ],
  });
  previewActionMock
    .mockResolvedValueOnce({ status: 'success', preview: initialPreview })
    .mockResolvedValueOnce({ status: 'success', preview: resolvedPreview });
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);

  try {
    flushSync(() =>
      root.render(<OrderChangeReviewForm requestId="request-1" />),
    );

    await vi.waitFor(() => {
      expect(
        host.querySelector<HTMLInputElement>(
          '[aria-label="第 2 票运费金额"]',
        ),
      ).not.toBeNull();
    });
    const approve = host.querySelector<HTMLButtonElement>(
      '[data-testid="approve-change"]',
    )!;
    expect(approve.disabled).toBe(true);

    const amount = host.querySelector<HTMLInputElement>(
      '[aria-label="第 2 票运费金额"]',
    )!;
    const reason = host.querySelector<HTMLTextAreaElement>(
      '[aria-label="第 2 票运费依据"]',
    )!;
    setValue(amount, '88.50');
    setValue(reason, '物流商报价 Q-20260903');
    await settleEffects();

    const repreview = buttonWithText(host, '按录入运费重新预览');
    expect(repreview?.disabled).toBe(false);
    repreview?.click();

    await vi.waitFor(() => {
      expect(previewActionMock).toHaveBeenNthCalledWith(2, null, {
        requestId: 'request-1',
        expectedPriceRevision: 5,
        pendingChargeResolutions: [
          {
            businessKey: 'shipping:shipment-2',
            shipmentId: 'shipment-2',
            expectedSequence: 2,
            expectedProjectedQuantity: 400,
            expectedDestinationProvince: '广东省',
            amount: '88.50',
            reason: '物流商报价 Q-20260903',
          },
        ],
      });
      expect(approve.disabled).toBe(false);
      expect(host.textContent).toContain(
        '该组逐票运费已通过服务端重新预览',
      );
    });

    setValue(amount, '89.00');
    await settleEffects();
    expect(approve.disabled).toBe(true);
    expect(host.textContent).toContain(
      '运费录入发生变化，须重新预览成功后才能批准',
    );
  } finally {
    flushSync(() => root.unmount());
    host.remove();
  }
});

it('切换或关闭裁决模式会清空上一模式的表单、预览和消息', async () => {
  cancelPreviewActionMock.mockResolvedValue({
    status: 'success',
    preview: {
      referenceSettleFee: '100.00',
      calculation: 'CURRENT_PUBLISHED_ENGINE_V1',
      components: {
        itemProcessing: '80.00',
        bagging: '10.00',
        carton: '10.00',
        preservedManualCharges: '0.00',
        shipping: '0.00',
      },
      allocation: [{ orderItemId: 'item-1', producedQty: 100 }],
      priceVersions: { processing: null, logistics: null },
    },
  });
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);

  try {
    flushSync(() => root.render(<AdminOrderDecisionPanel order={decisionOrder()} />));

    buttonWithText(host, '驳回')?.click();
    await settleEffects();
    const figs = host.querySelector<HTMLInputElement>(
      '[placeholder^="涉及款号"]',
    )!;
    const note = host.querySelector<HTMLTextAreaElement>(
      '[aria-label="裁决说明"]',
    )!;
    setValue(figs, '非法款号');
    setValue(note, '上一个驳回理由');
    await settleEffects();
    buttonWithText(host, '确认提交')?.click();
    await vi.waitFor(() => {
      expect(host.textContent).toContain('涉及款号只能填写正整数');
    });

    buttonWithText(host, '批准取消')?.click();
    await settleEffects();
    expect(host.textContent).not.toContain('涉及款号只能填写正整数');
    expect(
      host.querySelector<HTMLTextAreaElement>('[aria-label="裁决说明"]')?.value,
    ).toBe('');

    const producedQty = host.querySelector<HTMLInputElement>(
      '[aria-label="已产数量"]',
    )!;
    setValue(producedQty, '100');
    buttonWithText(host, '计算参考价')?.click();
    await vi.waitFor(() => {
      expect(
        host.querySelector<HTMLInputElement>('[aria-label="最终结算金额"]')
          ?.value,
      ).toBe('100.00');
      expect(host.textContent).toContain('引擎参考价');
    });
    setValue(
      host.querySelector<HTMLInputElement>('[aria-label="最终结算金额"]')!,
      '120.00',
    );
    setValue(
      host.querySelector<HTMLInputElement>('[aria-label="结算调整原因"]')!,
      '客户确认的人工调整',
    );
    setValue(
      host.querySelector<HTMLTextAreaElement>('[aria-label="裁决说明"]')!,
      '取消审核备注',
    );
    await settleEffects();

    buttonWithText(host, '取消')?.click();
    await settleEffects();
    expect(host.textContent).not.toContain('已按服务端当前发布价计算参考结算价');
    buttonWithText(host, '批准取消')?.click();
    await settleEffects();

    expect(
      host.querySelector<HTMLInputElement>('[aria-label="已产数量"]')?.value,
    ).toBe('');
    expect(
      host.querySelector<HTMLInputElement>('[aria-label="最终结算金额"]')?.value,
    ).toBe('');
    expect(
      host.querySelector<HTMLInputElement>('[aria-label="结算调整原因"]')?.value,
    ).toBe('');
    expect(
      host.querySelector<HTMLTextAreaElement>('[aria-label="裁决说明"]')?.value,
    ).toBe('');
    expect(host.textContent).not.toContain('引擎参考价 ¥100.00');

    buttonWithText(host, '驳回')?.click();
    await settleEffects();
    expect(
      host.querySelector<HTMLInputElement>('[placeholder^="涉及款号"]')?.value,
    ).toBe('');
  } finally {
    flushSync(() => root.unmount());
    host.remove();
  }
});
