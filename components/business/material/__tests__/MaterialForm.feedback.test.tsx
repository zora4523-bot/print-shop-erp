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
});
