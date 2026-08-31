import { readFileSync } from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MaterialMutationResult } from '@/actions/owner-materials.types';

const { actionState } = vi.hoisted(() => ({
  actionState: {
    current: null as MaterialMutationResult | null,
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

vi.mock('@/actions/owner-materials', () => ({
  setMaterialActiveAction: vi.fn(),
}));

import {
  StockTransactionForm,
  stockTransactionImpactItems,
} from '../StockTransactionForm';
import { ToggleMaterialActiveButton } from '../ToggleMaterialActiveButton';

function renderTransaction() {
  return renderToStaticMarkup(
    <StockTransactionForm action={vi.fn()} unit="张" locationOptions={[]} />,
  );
}

beforeEach(() => {
  actionState.current = null;
  actionState.pending = false;
});

describe('material action forms structured feedback', () => {
  it('builds an exact L2 stock movement preview from current form data', () => {
    expect(
      stockTransactionImpactItems({
        direction: 'OUT',
        locationLabel: '主仓 / 成品区',
        quantity: '12.50',
        unit: '张',
        unitCost: '0.1200',
        reasonLabel: '生产领用',
      }),
    ).toEqual([
      '方向：出库',
      '物料：当前详情页物料',
      '库位：主仓 / 成品区',
      '数量：12.50 张',
      '单位成本：0.1200',
      '原因：生产领用',
      '系统会写入一条库存流水，并同步更新该库位与物料汇总库存；提交时会再次校验库位和库存。',
    ]);
  });

  it('routes Enter and ordinary stock submits through one-shot L2 confirmation', () => {
    const source = readFileSync(
      path.join(
        process.cwd(),
        'components',
        'business',
        'material',
        'StockTransactionForm.tsx',
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

    const html = renderTransaction();
    expect(html).toContain('data-risk-level="L2"');
    expect(html).toContain('核对并提交出入库');
    expect(html).toMatch(/id="quantity"[^>]*required=""/);
  });

  it('summarizes stock validation and links controls to stable messages', () => {
    actionState.current = {
      status: 'invalid',
      fieldErrors: {
        quantity: ['数量必须大于 0'],
        remark: ['备注过长'],
      },
    };

    const html = renderTransaction();

    expect(html).toContain('href="#quantity"');
    expect(html).toContain('href="#remark"');
    expect(html).toMatch(
      /id="quantity"[^>]*aria-errormessage="quantity-message"/,
    );
    expect(html).toMatch(
      /id="remark"[^>]*aria-errormessage="remark-message"/,
    );
    expect(html).toContain('id="quantity-message"');
    expect(html).toContain('id="remark-message"');
  });

  it('removes stale transaction feedback during pending and emits success after', () => {
    actionState.current = { status: 'error', message: '库存不足，不能出库' };
    actionState.pending = true;
    const pendingHtml = renderTransaction();
    expect(pendingHtml).toMatch(/<form[^>]*aria-busy="true"/);
    expect(pendingHtml).toContain('正在更新库存…');
    expect(pendingHtml).not.toContain('库存不足，不能出库');

    actionState.pending = false;
    actionState.current = { status: 'success', message: '库存已更新' };
    const successHtml = renderTransaction();
    expect(successHtml).toContain('data-tone="success"');
    expect(successHtml).toContain('库存已更新');
  });

  it('uses explicit material toggle success, error and progress labels', () => {
    actionState.current = { status: 'success' };
    const successHtml = renderToStaticMarkup(
      <ToggleMaterialActiveButton materialId="material-1" currentlyActive />,
    );
    expect(successHtml).toContain('物料已停用');
    expect(successHtml).toContain('data-tone="success"');

    actionState.current = { status: 'error', message: '该物料仍被未完成工单引用' };
    const errorHtml = renderToStaticMarkup(
      <ToggleMaterialActiveButton materialId="material-1" currentlyActive />,
    );
    expect(errorHtml).toContain('data-tone="error"');
    expect(errorHtml).toContain('该物料仍被未完成工单引用');

    actionState.pending = true;
    const pendingHtml = renderToStaticMarkup(
      <ToggleMaterialActiveButton materialId="material-1" currentlyActive />,
    );
    expect(pendingHtml).toContain('正在停用物料…');
    expect(pendingHtml).not.toContain('该物料仍被未完成工单引用');
  });
});
