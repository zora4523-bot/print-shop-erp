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

import {
  PurchaseReceiptForm,
  purchaseReceiptImpactItems,
} from '../PurchaseReceiptForm';

const locations = [
  {
    id: 'location-1',
    warehouseId: 'warehouse-1',
    warehouseCode: 'WH01',
    warehouseName: '主仓',
    code: 'A01',
    name: '原料区',
    isDefault: true,
  },
];

function renderReceipt() {
  return renderToStaticMarkup(
    <PurchaseReceiptForm
      action={vi.fn()}
      purchaseOrderItemId="line-1"
      unit="张"
      defaultUnitCost="0.1200"
      remainingQuantity="20.00"
      locationOptions={locations}
      initialIdempotencyKey="00000000-0000-4000-8000-000000000001"
    />,
  );
}

beforeEach(() => {
  actionState.current = null;
  actionState.pending = false;
});

describe('PurchaseReceiptForm L2 confirmation', () => {
  it('builds an exact receipt preview from existing purchase data', () => {
    expect(
      purchaseReceiptImpactItems(
        {
          locationLabel: '主仓 / 原料区（默认）',
          quantity: '8.00',
          unit: '张',
          unitCost: '0.1200',
        },
        '20.00',
      ),
    ).toEqual([
      '方向：入库（采购收货过账）',
      '物料：当前采购明细物料',
      '库位：主仓 / 原料区（默认）',
      '本次数量：8.00 张',
      '单位成本：0.1200',
      '提交前剩余：20.00 张',
      '系统会创建采购收货记录和库存流水，并同步更新采购明细的已收数量；提交时会再次校验剩余数量。',
    ]);
  });

  it('uses native constraints before exposing the L2 confirmation', () => {
    const html = renderReceipt();

    expect(html).toContain('data-risk-level="L2"');
    expect(html).toContain('核对并确认收货过账');
    expect(html).toMatch(
      /id="receipt-quantity-line-1"[^>]*required=""/,
    );
    expect(html).toMatch(
      /id="receipt-quantity-line-1"[^>]*pattern="\\d\{1,10\}/,
    );
  });

  it('routes Enter and ordinary submits through a one-shot armed submit', () => {
    const source = readFileSync(
      path.join(
        process.cwd(),
        'components',
        'business',
        'purchase',
        'PurchaseReceiptForm.tsx',
      ),
      'utf8',
    );

    expect(source).toContain('onSubmit={handleSubmit}');
    expect(source).toContain('event.preventDefault()');
    expect(source).toContain('form.reportValidity()');
    expect(source).toContain('onInvalidCapture={() =>');
    expect(source).toContain('confirmedRef.current = true');
    expect(source).toContain('confirmedRef.current = false');
    expect(source).toContain('<ConfirmActionDialog');
    expect(source).toContain('level="L2"');
    expect(source).not.toContain('level="L3"');
  });

  it('hides stale receipt feedback while the confirmed action is pending', () => {
    actionState.current = { status: 'error', message: '剩余数量已经变化' };
    actionState.pending = true;

    const html = renderReceipt();
    expect(html).toMatch(/<form[^>]*aria-busy="true"/);
    expect(html).toContain('提交中…');
    expect(html).not.toContain('剩余数量已经变化');
  });
});
