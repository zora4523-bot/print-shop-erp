import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ProductCategory } from '@/generated/prisma/enums';

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useActionState: () => [null, vi.fn(), false],
  };
});

import { ProductCategoryForm } from '../ProductCategoryForm';

describe('ProductCategoryForm retired options', () => {
  it('does not offer retired categories when creating a category', () => {
    const html = renderToStaticMarkup(
      <ProductCategoryForm
        mode="create"
        action={vi.fn()}
        parentOptions={[]}
      />,
    );

    expect(html).not.toContain(`value="${ProductCategory.GENERIC_STOCK}"`);
    expect(html).not.toContain(`value="${ProductCategory.STOCK_FOIL_ADD}"`);
    expect(html).not.toContain(`value="${ProductCategory.BYO_MATERIAL}"`);
    expect(html).toContain(`value="${ProductCategory.BLANK_STOCK}"`);
  });

  it('keeps the current retired value visible on a history edit page', () => {
    const html = renderToStaticMarkup(
      <ProductCategoryForm
        mode="edit"
        action={vi.fn()}
        initial={{
          name: '历史现货分类',
          legacyCategory: ProductCategory.GENERIC_STOCK,
          sortOrder: 10,
        }}
      />,
    );

    expect(html).toContain(`value="${ProductCategory.GENERIC_STOCK}"`);
    expect(html).not.toContain(`value="${ProductCategory.STOCK_FOIL_ADD}"`);
    expect(html).not.toContain(`value="${ProductCategory.BYO_MATERIAL}"`);
  });
});
