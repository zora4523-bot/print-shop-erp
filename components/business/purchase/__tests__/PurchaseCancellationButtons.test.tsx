import { readFileSync } from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PurchaseMutationResult } from '@/actions/owner-purchases.types';

const { actionState } = vi.hoisted(() => ({
  actionState: {
    current: null as PurchaseMutationResult | null,
    pending: false,
  },
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useActionState: () => [actionState.current, vi.fn(), actionState.pending],
  };
});

vi.mock('@/actions/owner-purchases', () => ({
  cancelPurchaseOrderAction: vi.fn(),
  cancelPurchaseReceiptAction: vi.fn(),
}));

import {
  CancelPurchaseOrderButton,
  purchaseOrderCancelImpactItems,
} from '../CancelPurchaseOrderButton';
import {
  CancelPurchaseReceiptButton,
  purchaseReceiptCancelImpactItems,
} from '../CancelPurchaseReceiptButton';

const orderItems = [
  {
    materialCode: 'PAPER-250',
    materialName: '250g 白卡纸',
    quantity: '1200.00',
    unit: '张',
  },
];

const receiptItems = [
  {
    materialCode: 'INK-RED',
    materialName: '大红油墨',
    quantity: '3.50',
    unit: '千克',
  },
];

const orderSource = readFileSync(
  path.join(
    process.cwd(),
    'components',
    'business',
    'purchase',
    'CancelPurchaseOrderButton.tsx',
  ),
  'utf8',
);
const receiptSource = readFileSync(
  path.join(
    process.cwd(),
    'components',
    'business',
    'purchase',
    'CancelPurchaseReceiptButton.tsx',
  ),
  'utf8',
);

beforeEach(() => {
  actionState.current = null;
  actionState.pending = false;
});

describe('purchase cancellation confirmation contracts', () => {
  it('describes the exact purchase order and every stopped receipt item', () => {
    const impact = purchaseOrderCancelImpactItems({
      purchaseNo: 'PO20260824-0001',
      supplierName: '华南纸业',
      items: orderItems,
    }).join('\n');

    expect(impact).toContain('PO20260824-0001');
    expect(impact).toContain('华南纸业');
    expect(impact).toContain('250g 白卡纸（PAPER-250）1200.00 张');
    expect(impact).toContain('不会写入库存流水');
    expect(impact).toContain('已有收货明细时不可取消');
    expect(impact).toContain('需先取消收货过账');
  });

  it('describes the real receipt reversal, order rollback and stock alert', () => {
    const impact = purchaseReceiptCancelImpactItems({
      receiptNo: 'PR20260824-0002',
      purchaseNo: 'PO20260824-0001',
      items: receiptItems,
    }).join('\n');

    expect(impact).toContain('PR20260824-0002');
    expect(impact).toContain('PO20260824-0001');
    expect(impact).toContain('大红油墨（INK-RED）3.50 千克');
    expect(impact).toContain('反向库存流水');
    expect(impact).toContain('已收货数量会同步扣回');
    expect(impact).toContain('可能触发库存预警通知');
  });

  it('routes order cancellation through the shared L2 dialog and external form', () => {
    const html = renderToStaticMarkup(
      <CancelPurchaseOrderButton
        purchaseOrderId="po-1"
        purchaseNo="PO20260824-0001"
        supplierName="华南纸业"
        items={orderItems}
      />,
    );

    expect(orderSource).toContain('level="L2"');
    expect(orderSource).toContain('formId={formId}');
    expect(html).toContain('data-slot="alert-dialog-trigger"');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('min-h-11');
  });

  it('routes receipt cancellation through L3 and posts the required reason', () => {
    const html = renderToStaticMarkup(
      <CancelPurchaseReceiptButton
        receiptId="pr-1"
        receiptNo="PR20260824-0002"
        purchaseNo="PO20260824-0001"
        items={receiptItems}
      />,
    );

    expect(receiptSource).toContain('level="L3"');
    expect(receiptSource).toContain('reasonName="reason"');
    expect(receiptSource).toContain('formId={formId}');
    expect(html).toContain('data-slot="alert-dialog-trigger"');
    expect(html).toContain('aria-haspopup="dialog"');
  });

  it('hides stale feedback while pending and exposes structured failure feedback', () => {
    actionState.current = {
      status: 'invalid',
      fieldErrors: { reason: ['请填写取消原因'] },
    };
    const errorHtml = renderToStaticMarkup(
      <CancelPurchaseReceiptButton
        receiptId="pr-1"
        receiptNo="PR20260824-0002"
        purchaseNo="PO20260824-0001"
        items={receiptItems}
      />,
    );
    expect(errorHtml).toContain('data-tone="error"');
    expect(errorHtml).toContain('请填写取消原因');

    actionState.pending = true;
    const pendingHtml = renderToStaticMarkup(
      <CancelPurchaseReceiptButton
        receiptId="pr-1"
        receiptNo="PR20260824-0002"
        purchaseNo="PO20260824-0001"
        items={receiptItems}
      />,
    );
    expect(pendingHtml).toMatch(/<form[^>]*aria-busy="true"/);
    expect(pendingHtml).toContain('正在取消收货过账…');
    expect(pendingHtml).not.toContain('请填写取消原因');
  });
});
