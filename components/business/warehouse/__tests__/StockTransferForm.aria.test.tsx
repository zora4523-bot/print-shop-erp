import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// 这个文件的控件是通过 <Field>{children}</Field> 传进来的，Field 够不着
// 控件本身，所以 aria 靠 fieldA11y() 助手在调用点 spread 上去——与
// EditOrderForm 的「Field 内部收敛」是两条不同机制，各自都要钉住。
//
// 同样地，错误态只在提交失败后才存在，tests/visual 的 axe 门禁跑的是
// 加载态，看不到这条路径。
const { actionState } = vi.hoisted(() => ({
  actionState: {
    current: {
      status: 'invalid' as const,
      fieldErrors: { quantity: ['数量必须大于 0'] } as Record<string, string[]>,
    },
  },
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useActionState: () => [actionState.current, vi.fn(), false],
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
});
