import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MaterialMutationResult } from '@/actions/owner-materials.types';
import { MaterialCategory } from '@/generated/prisma/enums';

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

import { MaterialForm } from '../MaterialForm';

function render() {
  return renderToStaticMarkup(
    <MaterialForm mode="create" action={vi.fn()} routeBase="/owner/materials" />,
  );
}

beforeEach(() => {
  actionState.current = null;
  actionState.pending = false;
});

describe('MaterialForm structured feedback contract', () => {
  it('编辑时只展示纸张业务名称，未修改前保留导入原值', () => {
    const html = renderToStaticMarkup(
      <MaterialForm
        mode="edit"
        action={vi.fn()}
        routeBase="/owner/rules/papers"
        categoryScope={MaterialCategory.PAPER}
        initial={{
          code: 'MAT-1',
          name: '纸张未标（烫金!B13）',
          category: MaterialCategory.PAPER,
          specification: '160g（纸张表!A4:C4）',
          unit: '张',
          safetyStock: null,
          averageCost: null,
        }}
      />,
    );

    const nameInput = html.match(/<input[^>]*id="name"[^>]*>/)?.[0];
    const specificationInput = html.match(
      /<input[^>]*id="specification"[^>]*>/,
    )?.[0];

    expect(nameInput).toContain('value="纸张未标"');
    expect(specificationInput).toContain('value="160g"');
    expect(nameInput).not.toContain('烫金!B13');
    expect(specificationInput).not.toContain('纸张表!A4:C4');
    expect(nameInput).not.toMatch(/\sname=/);
    expect(specificationInput).not.toMatch(/\sname=/);
    expect(html.match(/name="name"/g)).toHaveLength(1);
    expect(html.match(/name="specification"/g)).toHaveLength(1);
    expect(html).toMatch(
      /<input type="hidden" name="name" value="纸张未标（烫金!B13）"/,
    );
    expect(html).toMatch(
      /<input type="hidden" name="specification" value="160g（纸张表!A4:C4）"/,
    );
  });

  it('纸张名清洗后为空时显示业务占位并保留原值', () => {
    const html = renderToStaticMarkup(
      <MaterialForm
        mode="edit"
        action={vi.fn()}
        routeBase="/owner/rules/papers"
        categoryScope={MaterialCategory.PAPER}
        initial={{
          code: 'MAT-2',
          name: '（烫金!B13）',
          category: MaterialCategory.PAPER,
          specification: null,
          unit: '张',
          safetyStock: null,
          averageCost: null,
        }}
      />,
    );

    expect(html.match(/<input[^>]*id="name"[^>]*>/)?.[0]).toContain(
      'value="未命名纸张"',
    );
    expect(
      html.match(/<input[^>]*id="specification"[^>]*>/)?.[0],
    ).toContain('value=""');
    expect(html).toContain('name="name" value="（烫金!B13）"');
  });

  it('summarizes validation failures and links category to its message', () => {
    actionState.current = {
      status: 'invalid',
      fieldErrors: {
        category: ['请选择有效分类'],
        safetyStock: ['数量格式错误'],
      },
    };

    const html = render();

    expect(html).toContain('href="#category"');
    expect(html).toContain('href="#safetyStock"');
    expect(html).toMatch(
      /id="category"[^>]*aria-errormessage="category-message"/,
    );
    expect(html).toContain('id="category-message"');
    expect(html).toContain('请选择有效分类');
  });

  it('does not expose an unknown error field name', () => {
    actionState.current = {
      status: 'invalid',
      fieldErrors: { internalMaterialField: ['内容无法保存'] },
    };

    const html = render();

    expect(html).toContain('表单内容：内容无法保存');
    expect(html).not.toContain('>internalMaterialField：');
  });

  it('uses an explicit busy state and removes stale errors during resubmit', () => {
    actionState.current = {
      status: 'invalid',
      fieldErrors: { name: ['请填写物料名称'] },
    };
    actionState.pending = true;

    const html = render();

    expect(html).toMatch(/<form[^>]*aria-busy="true"/);
    expect(html).toContain('正在保存物料…');
    expect(html).not.toContain('请填写物料名称');
  });

  it('renders the successful save as a polite action notice', () => {
    actionState.current = { status: 'success' };

    const html = render();

    expect(html).toContain('data-tone="success"');
    expect(html).toContain('role="status"');
    expect(html).toContain('物料已保存');
  });

  it('用业务后果说明库存阈值和参考成本', () => {
    const html = render();

    expect(html).toContain('低于该值时，库存看板会提醒。');
    expect(html).toContain('采购入库不会自动更新。');
    expect(html).not.toContain('Decimal(');
  });

  it('通用物料新建表单可排除已归入规则中心的纸张分类', () => {
    const html = renderToStaticMarkup(
      <MaterialForm
        mode="create"
        action={vi.fn()}
        routeBase="/owner/materials"
        excludedCategories={[MaterialCategory.PAPER]}
      />,
    );

    expect(html).not.toContain('<option value="PAPER"');
    expect(html).toContain('<option value="FOIL" selected="">');
  });
});
