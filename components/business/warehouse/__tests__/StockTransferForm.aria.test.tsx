import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MutationResult } from '@/lib/admin/action-helpers';

// 这个文件的控件是通过 <Field>{children}</Field> 传进来的，Field 够不着
// 控件本身，所以 aria 靠共享 formMessageA11yProps() 在调用点 spread
// 上去——与 EditOrderForm 的「Field 内部收敛」是两条不同机制，各自都要钉住。
//
// 同样地，错误态只在提交失败后才存在，tests/visual 的 axe 门禁跑的是
// 加载态，看不到这条路径。
const { actionState } = vi.hoisted(() => ({
  actionState: {
    current: {
      status: 'invalid' as const,
      fieldErrors: { quantity: ['数量必须大于 0'] } as Record<string, string[]>,
    } as MutationResult | null,
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

import { StockTransferForm } from '../StockTransferForm';

function render() {
  return renderToStaticMarkup(
    <StockTransferForm
      action={vi.fn()}
      materials={[{ id: 'm1', code: 'M-1', name: '铜版纸', unit: '张' }]}
      locations={[
        { id: 'l1', name: 'A-01', warehouseName: '主仓' },
        { id: 'l2', name: 'A-02', warehouseName: '主仓' },
      ] as never}
      locationStocks={[]}
      initialIdempotencyKey="k-1"
    />,
  );
}

beforeEach(() => {
  actionState.current = {
    status: 'invalid',
    fieldErrors: { quantity: ['数量必须大于 0'] },
  };
  actionState.pending = false;
});

describe('StockTransferForm 字段错误的 aria 连线', () => {
  it('出错字段标 aria-invalid，未出错字段不标', () => {
    const html = render();
    expect(html).toMatch(/id="transfer-quantity"[^>]*aria-invalid="true"/);
    expect(html).not.toMatch(/id="transfer-remark"[^>]*aria-invalid="true"/);
  });

  it('aria-describedby 指向的错误元素真实存在且承载文案', () => {
    const html = render();
    const m = html.match(
      /id="transfer-quantity"[^>]*aria-describedby="([^"]+)"/,
    );
    expect(m, 'transfer-quantity 应带 aria-describedby').not.toBeNull();
    const referenced = m![1]!;
    expect(html).toContain(`id="${referenced}"`);
    expect(html).toMatch(
      new RegExp(`id="${referenced}"[^>]*>[^<]*数量必须大于 0`),
    );
  });

  it('错误摘要使用业务字段名并跳转到真实控件', () => {
    const html = render();

    expect(html).toContain('data-slot="form-error-summary"');
    expect(html).toContain('href="#transfer-quantity"');
    expect(html).toContain('调拨数量：数量必须大于 0');
  });

  it('pending 时表单 busy、旧错误卸载且按钮给出明确进度', () => {
    actionState.pending = true;

    const html = render();

    expect(html).toMatch(/<form[^>]*aria-busy="true"/);
    expect(html).toContain('正在调拨…');
    expect(html).not.toContain('数量必须大于 0');
    expect(html).not.toContain('data-slot="form-error-summary"');
  });

  it('成功与失败使用互斥的结构化操作反馈', () => {
    actionState.current = {
      status: 'success',
      message: '调拨单 TR-000001 已完成',
    };
    const successHtml = render();
    expect(successHtml).toContain('data-tone="success"');
    expect(successHtml).toContain('调拨单 TR-000001 已完成');

    actionState.current = { status: 'error', message: '来源库位库存不足' };
    const errorHtml = render();
    expect(errorHtml).toContain('data-tone="error"');
    expect(errorHtml).toContain('来源库位库存不足');
    expect(errorHtml).not.toContain('TR-000001');
  });
});
