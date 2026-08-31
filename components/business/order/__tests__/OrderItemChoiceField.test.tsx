import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  OrderItemChoiceField,
  resolveOrderItemChoicePresentation,
} from '../OrderItemChoiceField';

const options = [
  { value: '大号', label: '大号' },
  { value: '中号', label: '中号' },
] as const;

function presentation(
  value: string | null,
  nextOptions: readonly { value: string; label: string }[] = options,
  isEditingCustom = false,
  customDraft = '',
) {
  return resolveOrderItemChoicePresentation({
    value,
    options: nextOptions,
    isEditingCustom,
    customDraft,
  });
}

describe('OrderItemChoiceField', () => {
  it('受控值从预设规格变为 SKU 的非标规格时，自动展开并展示该值', () => {
    expect(presentation('大号')).toMatchObject({
      controlledCustomSelected: false,
      customSelected: false,
    });

    expect(presentation('230 × 110 mm')).toEqual({
      controlledCustomSelected: true,
      customSelected: true,
      customInputValue: '230 × 110 mm',
    });
  });

  it('选项集变化时重新判定受控值是否为自定义值', () => {
    expect(presentation('大号')).toMatchObject({
      customSelected: false,
    });
    expect(presentation('大号', [{ value: '中号', label: '中号' }])).toEqual({
      controlledCustomSelected: true,
      customSelected: true,
      customInputValue: '大号',
    });
    expect(presentation('大号', options)).toMatchObject({
      customSelected: false,
    });
  });

  it('用户正在编辑自定义规格时，外部值或选项刷新不覆盖本地输入', () => {
    expect(
      presentation(
        '230 × 110 mm',
        [{ value: '230 × 110 mm', label: '230 × 110 mm' }],
        true,
        '235 × 115 mm',
      ),
    ).toEqual({
      controlledCustomSelected: false,
      customSelected: true,
      customInputValue: '235 × 115 mm',
    });
  });

  it('首次收到非预设受控值时，实际标记中包含可编辑的自定义输入框', () => {
    const html = renderToStaticMarkup(
      <OrderItemChoiceField
        id="specification"
        label="规格"
        value="230 × 110 mm"
        options={options}
        customLabel="非标定制"
        customInputLabel="自定义规格"
        customPlaceholder="输入规格"
        maxLength={64}
        onChange={vi.fn()}
        onBlur={vi.fn()}
      />,
    );

    expect(html).toContain('id="specification-custom"');
    expect(html).toContain('value="230 × 110 mm"');
    expect(html).toContain('aria-pressed="true"');
  });
});
