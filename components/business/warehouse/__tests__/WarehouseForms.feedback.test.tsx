import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WarehouseMutationResult } from '@/actions/owner-warehouses.types';

const {
  createWarehouseActionMock,
  createWarehouseLocationActionMock,
  warehouseState,
  locationState,
} = vi.hoisted(() => ({
  createWarehouseActionMock: vi.fn(),
  createWarehouseLocationActionMock: vi.fn(),
  warehouseState: {
    current: null as WarehouseMutationResult | null,
    pending: false,
  },
  locationState: {
    current: null as WarehouseMutationResult | null,
    pending: false,
  },
}));

vi.mock('@/actions/owner-warehouses', () => ({
  createWarehouseAction: createWarehouseActionMock,
  createWarehouseLocationAction: createWarehouseLocationActionMock,
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useActionState: (action: unknown) => {
      const state =
        action === createWarehouseActionMock ? warehouseState : locationState;
      return [state.current, vi.fn(), state.pending];
    },
  };
});

import { WarehouseForms } from '../WarehouseForms';

const activeWarehouse = {
  id: 'warehouse-1',
  code: 'WH-000001',
  name: '主仓',
  isActive: true,
};

function render(withWarehouse = true) {
  return renderToStaticMarkup(
    <WarehouseForms warehouses={withWarehouse ? [activeWarehouse] : []} />,
  );
}

beforeEach(() => {
  warehouseState.current = null;
  warehouseState.pending = false;
  locationState.current = null;
  locationState.pending = false;
});

describe('WarehouseForms structured feedback contract', () => {
  it('uses unique DOM ids while preserving both Server Action field names', () => {
    warehouseState.current = {
      status: 'invalid',
      fieldErrors: { name: ['请填写仓库名称'] },
    };
    locationState.current = {
      status: 'invalid',
      fieldErrors: { code: ['库位编码格式非法'] },
    };

    const html = render();

    expect(html).toMatch(/id="warehouse-name"[^>]*name="name"/);
    expect(html).toMatch(/id="location-name"[^>]*name="name"/);
    expect(html).toMatch(/id="warehouse-code"[^>]*name="code"/);
    expect(html).toMatch(/id="location-code"[^>]*name="code"/);
    expect(html).not.toContain('id="name"');
    expect(html).not.toContain('id="code"');
    expect(html).toContain('href="#warehouse-name"');
    expect(html).toContain('href="#location-code"');
    expect(html).toContain('aria-errormessage="warehouse-name-message"');
    expect(html).toContain('aria-errormessage="location-code-message"');
  });

  it('tracks pending independently and removes only that form previous result', () => {
    warehouseState.current = {
      status: 'error',
      message: '仓库编码已被占用',
    };
    warehouseState.pending = true;
    locationState.current = { status: 'success', message: '库位已创建' };

    const html = render();

    expect(html).toMatch(
      /<form[^>]*id="warehouse-create-form"[^>]*aria-busy="true"/,
    );
    expect(html).toMatch(
      /<form[^>]*id="location-create-form"[^>]*aria-busy="false"/,
    );
    expect(html).toContain('正在创建仓库…');
    expect(html).not.toContain('仓库编码已被占用');
    expect(html).toContain('库位已创建');
  });

  it('makes the missing-warehouse disabled reason visible', () => {
    const html = render(false);

    expect(html).toContain('data-tone="warning"');
    expect(html).toContain('缺少启用仓库');
    expect(html).toContain('请先在左侧创建仓库');
    expect(html).toMatch(/正在创建库位…|创建库位/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>创建库位<\/button>/);
  });

  it('keeps warehouse success and location error receipts distinct', () => {
    warehouseState.current = { status: 'success', message: '仓库已创建' };
    locationState.current = { status: 'error', message: '所属仓库已停用' };

    const html = render();

    expect(html).toContain('data-tone="success"');
    expect(html).toContain('仓库已创建');
    expect(html).toContain('data-tone="error"');
    expect(html).toContain('库位创建失败');
    expect(html).toContain('所属仓库已停用');
  });
});
