import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PriceMutationResult } from '@/actions/owner-prices.types';
import { AdjustmentType } from '@/generated/prisma/enums';

const { actionState } = vi.hoisted(() => ({
  actionState: {
    current: null as PriceMutationResult | null,
  },
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useActionState: () => [actionState.current, vi.fn(), false],
  };
});

import {
  normalizePriceAdjustmentStringList,
  PriceAdjustmentForm,
} from '../PriceAdjustmentForm';

beforeEach(() => {
  actionState.current = null;
});

describe('PriceAdjustmentForm', () => {
  it('在输入时即时规范化多项条件，直接提交也不丢值', () => {
    expect(
      normalizePriceAdjustmentStringList('大号, 中号，大号\n方形'),
    ).toEqual(['大号', '中号', '方形']);
    expect(normalizePriceAdjustmentStringList('  ')).toBeUndefined();
  });

  it('uses structured business fields without exposing the stored condition format', () => {
    const action = vi.fn(async () => ({ status: 'success' as const }));
    const html = renderToStaticMarkup(
      <PriceAdjustmentForm
        mode="create"
        action={action}
        products={[{ id: 'product-1', label: '大号红包' }]}
        crafts={[{ id: 'craft-1', label: '平烫' }]}
      />,
    );

    expect(html).toContain('收费项目名称');
    expect(html).toContain('适用产品');
    expect(html).toContain('适用工艺');
    expect(html).toContain('多工艺匹配方式');
    expect(html).toContain('不指定');
    expect(html).toContain('命中任一工艺');
    expect(html).toContain('name="triggerCondition"');
    expect(html).toContain('type="hidden"');
    expect(html).not.toContain('JSON');
    expect(html).not.toContain('Decimal(10,4)');
    expect(html).not.toContain('>ANY<');
    expect(html).not.toContain('>ALL<');
  });

  it('does not render technical details from legacy condition errors', () => {
    actionState.current = {
      status: 'invalid',
      fieldErrors: {
        triggerCondition: [
          '触发条件必须是 JSON object',
          '包含未知字段：futureField',
          'craftMode 只能是 ANY 或 ALL',
          'unitsPerSheet必须是正整数',
        ],
      },
    };

    const html = renderToStaticMarkup(
      <PriceAdjustmentForm
        mode="create"
        action={vi.fn()}
        products={[]}
        crafts={[]}
      />,
    );
    const visibleText = html.replace(/<[^>]*>/g, ' ');

    expect(visibleText).toContain(
      '适用条件设置无效，请按页面选项重新设置。',
    );
    expect(visibleText).not.toMatch(
      /unitsPerSheet|JSON|unknown\s+keys?|未知字段|settlementTypes|craftMode|\bANY\b|\bALL\b|minQty|maxQty|futureField/i,
    );
  });

  it('条件输入显示业务文本但保留未编辑的原值', () => {
    const html = renderToStaticMarkup(
      <PriceAdjustmentForm
        mode="edit"
        action={vi.fn()}
        initial={{
          name: '纸张加价',
          adjustmentType: AdjustmentType.PER_ORDER,
          amount: '0.1',
          triggerCondition: JSON.stringify({
            paperTypes: ['纸张未标（烫金!B13）'],
          }),
        }}
        products={[]}
        crafts={[]}
      />,
    );
    const paperInput = html.match(
      /<input[^>]*id="condition-paperTypes"[^>]*>/,
    )?.[0];

    expect(paperInput).toContain('value="纸张未标"');
    expect(paperInput).not.toContain('烫金!B13');
    expect(html).toContain('name="triggerCondition"');
    expect(html).toContain('烫金!B13');
  });
});
