import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  FinalizeOrderPricingMutationResult,
  PreviewOrderPricingReviewResult,
} from '@/actions/order.types';
import { OrderPackagingMode } from '@/generated/prisma/enums';
import type { OrderPricingReviewPreview } from '@/lib/order/pricing-review';

const { harness } = vi.hoisted(() => ({
  harness: {
    hookIndex: 0,
    previewState: null as PreviewOrderPricingReviewResult | null,
    finalizeState: null as FinalizeOrderPricingMutationResult | null,
    previewAction: vi.fn(),
    finalizeAction: vi.fn(),
    onConfirm: null as (() => void) | null,
    confirmDisabled: null as boolean | null,
    refresh: vi.fn(),
  },
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useActionState: () => {
      const previewHook = harness.hookIndex++ % 2 === 0;
      return previewHook
        ? [harness.previewState, harness.previewAction]
        : [harness.finalizeState, harness.finalizeAction];
    },
    useTransition: () => [false, (callback: () => void) => callback()],
    useEffect: (callback: () => void) => callback(),
  };
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: harness.refresh }),
}));

vi.mock('@/actions/order', () => ({
  previewOrderPricingReviewAction: vi.fn(),
  finalizeOrderPricingAction: vi.fn(),
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({children, ...props}: React.ComponentProps<'button'> & {'data-slot'?: string}) => {
    if (props['data-slot'] === 'pricing-submit') {
      harness.onConfirm = props.onClick as (() => void) | null;
      harness.confirmDisabled = props.disabled ?? false;
    }
    return <button data-native-button-reason="captures pricing submit control in unit test" {...props}>{children}</button>;
  },
}));

import { OrderPricingReviewForm } from '../OrderPricingReviewForm';

function preview(): OrderPricingReviewPreview {
  return {
    orderId: 'order-1',
    orderNo: 'GD-260826-001',
    orderRevision: 8,
    priceRevision: 3,
    currentProcessingAmount: '130.00',
    currentPackagingAmount: '20.00',
    currentTotalAmount: '165.00',
    processingPriceBook: {
      id: 'processing-v3',
      code: 'PROCESSING_EXTERNAL',
      name: '外销加工费',
      version: 3,
      sourceName: '加工费.xlsx',
      sourceSha256: 'a'.repeat(64),
    },
    logisticsPriceBook: {
      id: 'logistics-v2',
      code: 'LOGISTICS_EXTERNAL',
      name: '外销物流费',
      version: 2,
      sourceName: '物流费.xlsx',
      sourceSha256: 'b'.repeat(64),
    },
    items: [
      {
        itemId: 'item-manual',
        sequence: 1,
        name: '配置外纸张',
        quantity: 100,
        complete: false,
        errors: ['配置外纸张需人工核价'],
        manualQuoteReason: '客户自带纸，建单时转人工',
        currentUnitPrice: '0.2000',
        currentFixedFee: '5.00',
        currentSubtotal: '25.00',
        suggestedUnitPrice: null,
        suggestedFixedFee: null,
        suggestedSubtotal: null,
        currentReason: '工厂已核对纸张',
      },
    ],
    packagingGroups: [
      {
        packagingGroupId: 'packaging-auto',
        sequence: 1,
        name: '单款装',
        mode: OrderPackagingMode.SINGLE_STYLE,
        actualBagCount: 100,
        complete: true,
        errors: [],
        currentUnitPrice: '9.0000',
        currentSubtotal: '900.00',
        suggestedUnitPrice: '0.1000',
        suggestedSubtotal: '10.00',
        currentReason: '旧人工价',
      },
      {
        packagingGroupId: 'packaging-manual',
        sequence: 2,
        name: '混装',
        mode: OrderPackagingMode.MIXED_STYLE,
        actualBagCount: 50,
        complete: false,
        errors: ['当前规则未覆盖混装'],
        currentUnitPrice: '0.2000',
        currentSubtotal: '10.00',
        suggestedUnitPrice: null,
        suggestedSubtotal: null,
        currentReason: '管理员按混装工艺确认',
      },
    ],
    orderCharges: [
      {
        chargeId: 'plate-pending',
        businessKey: 'ORDER:PLATE_MAKING_FEE:PENDING',
        categoryCode: 'PLATE_MAKING_FEE',
        description: '制版费',
        complete: false,
        errors: ['制版费待工厂确认'],
        suggestedAmount: null,
        currentAmount: '30.00',
        currentReason: '工厂确认制版成本',
      },
    ],
    shipments: [],
  };
}

function render() {
  harness.hookIndex = 0;
  return renderToStaticMarkup(<OrderPricingReviewForm orderId="order-1" />);
}

beforeEach(() => {
  harness.hookIndex = 0;
  harness.previewState = { status: 'success', preview: preview() };
  harness.finalizeState = null;
  harness.previewAction.mockReset();
  harness.finalizeAction.mockReset();
  harness.onConfirm = null;
  harness.confirmDisabled = null;
  harness.refresh.mockReset();
});

describe('OrderPricingReviewForm snapshot confirmation contract', () => {
  it('submits immutable packaging facts while keeping the stored automatic amount', () => {
    render();

    expect(harness.onConfirm).not.toBeNull();
    harness.onConfirm?.();

    expect(harness.finalizeAction).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 'order-1',
        expectedOrderRevision: 8,
        expectedPriceRevision: 3,
        packagingGroups: [
          {
            packagingGroupId: 'packaging-auto',
            expectedMode: OrderPackagingMode.SINGLE_STYLE,
            expectedActualBagCount: 100,
            unitPrice: '9.0000',
            reason: '旧人工价',
          },
          {
            packagingGroupId: 'packaging-manual',
            expectedMode: OrderPackagingMode.MIXED_STYLE,
            expectedActualBagCount: 50,
            unitPrice: '0.2000',
            reason: '管理员按混装工艺确认',
          },
        ],
        orderCharges: [
          {
            chargeId: 'plate-pending',
            expectedBusinessKey: 'ORDER:PLATE_MAKING_FEE:PENDING',
            amount: '30.00',
            reason: '工厂确认制版成本',
          },
        ],
      }),
    );
  });

  it('生产资料不就绪只提示，不禁用已经填齐费用的确认按钮', () => {
    const value = preview();
    value.items = []; value.packagingGroups = []; value.orderCharges = []; value.shipments = [];
    value.productionReadiness = { ready: false, issues: ['工单没有包装组'] };
    harness.previewState = { status: 'success', preview: value };
    const html = renderToStaticMarkup(<OrderPricingReviewForm orderId="order-1" />);
    expect(html).toContain('确认费用后，工单仍需补录以下资料');
    expect(harness.confirmDisabled).toBe(false);
  });

  it('终价保存成功但不 ready 时保留提示，不刷新或触发成功跳转', () => {
    harness.finalizeState = { status: 'success', orderId: 'order-1', priceRevision: 4, packagingAmount: '20.00', processingAmount: '130.00', totalAmount: '165.00', confirmedFee: '165.00', productionReadiness: { ready: false, issues: ['工单没有包装组'] } };
    const onSuccess = vi.fn();
    const html = renderToStaticMarkup(<OrderPricingReviewForm orderId="order-1" onSuccess={onSuccess} />);
    expect(html).toContain('费用已确认，工单仍需补录以下资料');
    expect(harness.refresh).not.toHaveBeenCalled(); expect(onSuccess).not.toHaveBeenCalled();
  });

  it('describes snapshot confirmation without promising a latest-rule reprice', () => {
    const html = render();

    expect(html).toContain('工厂核价确认');
    expect(html).toContain('请补录待核价项。');
    expect(html).toContain('已报价');
    expect(html).toContain('建单转人工原因：客户自带纸，建单时转人工');
    expect(html).toContain('订单级待核价费用');
    expect(html).toContain('制版费待工厂确认');
    expect(html).toContain('待管理员补录');
    expect(html).toContain('href="#pricing-review-item-item-manual"');
    expect(html).toContain('href="#pricing-review-charge-plate-pending"');
    expect(html).not.toContain('按最新价格');
    expect(html).not.toContain('最新规则自动价');
  });

  it('待人工款式和包装的兼容占位金额保持空白', () => {
    const data = preview();
    data.items[0] = {
      ...data.items[0]!,
      currentUnitPrice: '',
      currentFixedFee: '',
      currentSubtotal: '',
    };
    data.packagingGroups[1] = {
      ...data.packagingGroups[1]!,
      currentUnitPrice: '',
      currentSubtotal: '',
    };
    harness.previewState = { status: 'success', preview: data };

    const html = render();

    expect(html).toContain('还需完成 3 个必填项');
    expect(html).toContain('款式 #1 客户单价');
    expect(html).toContain('款式 #1 每款一次性费用');
    expect(html).toContain('包装组 #2 每袋包装费');
    expect(harness.confirmDisabled).toBe(true);

    harness.onConfirm?.();
    expect(harness.finalizeAction).toHaveBeenCalledWith(
      expect.objectContaining({
        items: [
          expect.objectContaining({
            itemId: 'item-manual',
            unitPrice: '',
            fixedFee: '',
          }),
        ],
        packagingGroups: expect.arrayContaining([
          expect.objectContaining({
            packagingGroupId: 'packaging-manual',
            unitPrice: '',
          }),
        ]),
      }),
    );
  });

  it('未知物流金额保持空白，并明确列出阻塞确认的必填项', () => {
    const data = preview();
    data.shipments = [
      {
        shipmentId: 'shipment-manual',
        sequence: 1,
        destinationProvince: '广东',
        billableWeightKg: null,
        itemQuantity: 100,
        shipping: {
          complete: false,
          waived: false,
          advisory: true,
          suggestedAmount: null,
          errors: ['快递费待人工确认'],
          currentAmount: null,
        },
        packaging: {
          complete: false,
          waived: false,
          advisory: true,
          suggestedAmount: null,
          errors: ['耗材费待人工确认'],
          currentAmount: null,
        },
        currentReason: null,
      },
    ];
    harness.previewState = { status: 'success', preview: data };

    const html = render();

    expect(html).not.toContain('value="0.00"');
    expect(html).toContain('还需完成 3 个必填项');
    expect(html).toContain('地址 1 快递费');
    expect(html).toContain('地址 1 打包耗材费');
    expect(html).toContain('地址 1 收费确认说明');
    expect(harness.confirmDisabled).toBe(true);

    harness.onConfirm?.();
    expect(harness.finalizeAction).toHaveBeenCalledWith(
      expect.objectContaining({
        shipments: [
          expect.objectContaining({
            shipmentId: 'shipment-manual',
            shippingFee: '',
            packingMaterialFee: '',
          }),
        ],
      }),
    );
  });

  it('制烫金版费没有建议值时保持空白，并要求金额和依据', () => {
    const data = preview();
    data.orderCharges[0] = {
      ...data.orderCharges[0]!,
      suggestedAmount: null,
      currentAmount: null,
      currentReason: null,
    };
    harness.previewState = { status: 'success', preview: data };

    const html = render();

    expect(html).not.toContain('value="0.00"');
    expect(html).toContain('还需完成 2 个必填项');
    expect(html).toContain('制版费 确认金额');
    expect(html).toContain('制版费 定价依据');
    expect(harness.confirmDisabled).toBe(true);

    harness.onConfirm?.();
    expect(harness.finalizeAction).toHaveBeenCalledWith(
      expect.objectContaining({
        orderCharges: [
          expect.objectContaining({
            chargeId: 'plate-pending',
            amount: '',
            reason: '',
          }),
        ],
      }),
    );
  });

  it('全自动物流快照不提供无效的说明编辑框', () => {
    const data = preview();
    data.shipments = [
      {
        shipmentId: 'shipment-auto',
        sequence: 1,
        destinationProvince: '广东',
        billableWeightKg: '2.000',
        itemQuantity: 100,
        shipping: {
          complete: true,
          waived: false,
          advisory: false,
          suggestedAmount: '8.00',
          errors: [],
          currentAmount: '8.00',
        },
        packaging: {
          complete: true,
          waived: false,
          advisory: false,
          suggestedAmount: '4.00',
          errors: [],
          currentAmount: '4.00',
        },
        currentReason: '旧版自动报价说明',
      },
    ];
    harness.previewState = { status: 'success', preview: data };

    const html = render();

    expect(html).not.toContain('收费确认说明');
    expect(html).not.toContain('地址 1 快递/耗材费');
    expect(harness.confirmDisabled).toBe(false);
  });

  it('shows the finalized packaging total returned by the server action', () => {
    harness.finalizeState = {
      status: 'success',
      orderId: 'order-1',
      priceRevision: 4,
      packagingAmount: '20.00',
      processingAmount: '150.00',
      totalAmount: '185.00',
      confirmedFee: '185.00',
    };

    const html = render();

    expect(html).toContain('费用已确认：包装费 20.00');
    expect(html).toContain('加工费合计 150.00');
    expect(html).toContain('工单总额 185.00');
    expect(html).toContain('费用已确认，正在刷新工单状态');
    expect(harness.confirmDisabled).toBe(true);
    expect(harness.previewAction).toHaveBeenCalledTimes(1);
    // finalizeOrderPricingAction revalidates; its response re-renders the page (DECISIONS 2026-08-27).
    expect(harness.refresh).not.toHaveBeenCalled();
  });
});
