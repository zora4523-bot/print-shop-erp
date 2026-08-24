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
  it('links the summary, select and price input to stable error messages', () => {
    actionState.current = {
      status: 'invalid',
      fieldErrors: {
        categoryNodeId: ['请选择产品分类'],
        baseUnitPrice: ['价格格式错误'],
      },
    };

    const html = render();

    expect(html).toContain('href="#categoryNodeId"');
    expect(html).toContain('href="#baseUnitPrice"');
    expect(html).toMatch(
      /id="categoryNodeId"[^>]*aria-errormessage="categoryNodeId-message"/,
    );
    expect(html).toMatch(
      /id="baseUnitPrice"[^>]*aria-errormessage="baseUnitPrice-message"/,
    );
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
