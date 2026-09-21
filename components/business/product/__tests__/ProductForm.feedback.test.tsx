import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProductMutationResult } from '@/actions/owner-products.types';

const { actionState } = vi.hoisted(() => ({
  actionState: {
    current: null as ProductMutationResult | null,
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

import { ProductForm } from '../ProductForm';

const categoryNodes = [
  {
    id: 'category-1',
    path: 'root.category-1',
    name: '纸制品',
    legacyCategory: 'BOX',
    sortOrder: 10,
    isActive: true,
  },
] as never;

function render(categories = categoryNodes) {
  return renderToStaticMarkup(
    <ProductForm mode="create" action={vi.fn()} categoryNodes={categories} />,
  );
}

beforeEach(() => {
  actionState.current = null;
  actionState.pending = false;
});

describe('ProductForm structured feedback contract', () => {
  it('编辑时只展示业务文案，未修改前保留原始精确匹配值', () => {
    const html = renderToStaticMarkup(
      <ProductForm
        mode="edit"
        action={vi.fn()}
        categoryNodes={categoryNodes}
        initial={{
          code: 'PRD-1',
          categoryNodeId: 'category-1',
          name: '大号触感纸（价格表!B6）',
          specification: '160g（价格表!B7）',
          paperType: '触感纸（烫金!B13）',
        }}
      />,
    );

    const nameInput = html.match(/<input[^>]*id="name"[^>]*>/)?.[0];
    const specificationInput = html.match(
      /<input[^>]*id="specification"[^>]*>/,
    )?.[0];
    const paperInput = html.match(/<input[^>]*id="paperType"[^>]*>/)?.[0];

    expect(nameInput).toContain('value="大号触感纸"');
    expect(specificationInput).toContain('value="160g"');
    expect(paperInput).toContain('value="触感纸"');
    expect(nameInput).not.toContain('价格表!B6');
    expect(specificationInput).not.toContain('价格表!B7');
    expect(paperInput).not.toContain('烫金!B13');
    expect(nameInput).not.toMatch(/\sname=/);
    expect(paperInput).not.toMatch(/\sname=/);
    expect(html.match(/name="name"/g)).toHaveLength(1);
    expect(html.match(/name="paperType"/g)).toHaveLength(1);
    expect(html).toMatch(
      /<input type="hidden" name="name" value="大号触感纸（价格表!B6）"/,
    );
    expect(html).toMatch(
      /<input type="hidden" name="paperType" value="触感纸（烫金!B13）"/,
    );
  });

  it('清洗后无业务文本时显示明确占位而不改写原值', () => {
    const html = renderToStaticMarkup(
      <ProductForm
        mode="edit"
        action={vi.fn()}
        categoryNodes={categoryNodes}
        initial={{
          code: 'PRD-2',
          categoryNodeId: 'category-1',
          name: '（价格表!B6）',
          specification: '（价格表!B7）',
          paperType: '（烫金!B13）',
        }}
      />,
    );

    expect(html.match(/<input[^>]*id="name"[^>]*>/)?.[0]).toContain(
      'value="未命名产品"',
    );
    expect(
      html.match(/<input[^>]*id="specification"[^>]*>/)?.[0],
    ).toContain('value="未标注规格"');
    expect(html.match(/<input[^>]*id="paperType"[^>]*>/)?.[0]).toContain(
      'value="未标注纸张"',
    );
    expect(html).toContain('name="name" value="（价格表!B6）"');
  });

  it('规则中心表单没有旧内部直单价字段', () => {
    const html = renderToStaticMarkup(
      <ProductForm
        mode="edit"
        action={vi.fn()}
        categoryNodes={categoryNodes}
        initial={{
          code: 'PRD-3',
          categoryNodeId: 'category-1',
          name: '大号现货',
          specification: '大号',
          paperType: '160g 艳闪',
        }}
      />,
    );

    expect(html).not.toContain('内部销售/工厂直单基础单价');
    expect(html).not.toContain('name="baseUnitPrice"');
    expect(html).not.toContain('name="minOrderQty"');
    expect(html).not.toContain('最小起订量');
  });

  it('links the summary and select to a stable error message', () => {
    actionState.current = {
      status: 'invalid',
      fieldErrors: {
        categoryNodeId: ['请选择产品分类'],
      },
    };

    const html = render();

    expect(html).toContain('href="#categoryNodeId"');
    expect(html).toMatch(
      /id="categoryNodeId"[^>]*aria-errormessage="categoryNodeId-message"/,
    );
  });

  it('does not expose an unknown error field name', () => {
    actionState.current = {
      status: 'invalid',
      fieldErrors: { internalProductField: ['内容无法保存'] },
    };

    const html = render();

    expect(html).toContain('表单内容：内容无法保存');
    expect(html).not.toContain('>internalProductField：');
  });

  it('explains the disabled prerequisite with a structured warning', () => {
    const html = render([] as never);

    expect(html).toContain('data-tone="warning"');
    expect(html).toContain('缺少可用产品分类');
    expect(html).toContain('请先创建并启用分类');
    expect(html).toMatch(/<button[^>]*disabled=""/);
  });

  it('reports pending and technical failure states without stale overlap', () => {
    actionState.current = { status: 'error', message: '产品编码已被其他记录占用' };
    const errorHtml = render();
    expect(errorHtml).toContain('data-tone="error"');
    expect(errorHtml).toContain('产品编码已被其他记录占用');

    actionState.pending = true;
    const pendingHtml = render();
    expect(pendingHtml).toMatch(/<form[^>]*aria-busy="true"/);
    expect(pendingHtml).toContain('正在保存产品…');
    expect(pendingHtml).not.toContain('产品编码已被其他记录占用');
  });
});

it('受保护产品身份只显示原值，隐藏提交值保留长编码，名称仍可编辑', () => {
  const code = `BLANK-${'a'.repeat(20)}-west-large`;
  const html = renderToStaticMarkup(<ProductForm mode="edit" action={vi.fn()} categoryNodes={categoryNodes} identityReadOnly
    initial={{ code, categoryNodeId: 'category-1', name: '产品', specification: '西封大号85×165', paperType: '160g红卡' }} />);
  for (const field of ['code', 'categoryNodeId', 'specification', 'paperType']) {
    expect(html).toContain(`type="hidden" name="${field}"`);
    expect(html).not.toContain(`id="${field}"`);
  }
  expect(html).toContain(code);
  expect(html).toContain('id="name"');
  expect(html).not.toContain('到纸张页管理空白封适用规格');
});
