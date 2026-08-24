import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UnauthorizedError } from '../../lib/auth/errors';

const {
  permissionsMock,
  postingMock,
  revalidatePathMock,
  MockInventoryCountInvariantError,
  MockInventoryCountStaleSnapshotError,
} = vi.hoisted(() => {
  class MockInventoryCountInvariantError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'InventoryCountInvariantError';
    }
  }
  class MockInventoryCountStaleSnapshotError extends MockInventoryCountInvariantError {
    readonly staleKeys: string[];
    constructor(message: string, staleKeys: string[]) {
      super(message);
      this.name = 'InventoryCountStaleSnapshotError';
      this.staleKeys = staleKeys;
    }
  }
  return {
    permissionsMock: { requirePermission: vi.fn() },
    postingMock: { postInventoryCount: vi.fn() },
    revalidatePathMock: vi.fn(),
    MockInventoryCountInvariantError,
    MockInventoryCountStaleSnapshotError,
  };
});

vi.mock('@/lib/auth/permissions', () => ({
  requirePermission: permissionsMock.requirePermission,
}));
vi.mock('@/lib/inventory-count-posting', () => ({
  postInventoryCount: postingMock.postInventoryCount,
  InventoryCountInvariantError: MockInventoryCountInvariantError,
  InventoryCountStaleSnapshotError: MockInventoryCountStaleSnapshotError,
}));
vi.mock('@/lib/stock-transfer', () => ({
  createStockTransfer: vi.fn(),
  StockTransferInvariantError: class extends Error {},
}));
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }));

import { postInventoryCountAction } from '../owner-inventory';

const ownerActor = {
  id: 'actor-owner',
  username: 'admin',
  displayName: '管理员',
  role: 'ADMIN',
  workerType: null,
  machineType: null,
};

const validItems = [
  {
    materialId: 'mat1',
    locationId: 'loc1',
    bookQuantity: '5.00',
    countedQuantity: '8.00',
  },
];

function fd(items: unknown, extra: Record<string, string> = {}): FormData {
  const form = new FormData();
  form.set('idempotencyKey', '00000000-0000-4000-8000-000000000001');
  form.set('items', JSON.stringify(items));
  form.set('remark', '月末例行盘点');
  for (const [key, value] of Object.entries(extra)) form.set(key, value);
  return form;
}

beforeEach(() => {
  permissionsMock.requirePermission.mockReset().mockResolvedValue(ownerActor);
  postingMock.postInventoryCount.mockReset();
  revalidatePathMock.mockReset();
});

describe('postInventoryCountAction', () => {
  it('checks the permission before touching the payload', async () => {
    permissionsMock.requirePermission.mockRejectedValue(
      new UnauthorizedError('无权访问'),
    );

    await expect(postInventoryCountAction(null, fd(validItems))).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
    expect(postingMock.postInventoryCount).not.toHaveBeenCalled();
  });

  it('转发逐行账面数给业务层', async () => {
    postingMock.postInventoryCount.mockResolvedValue({
      count: { countNo: 'IC20260821-0001', items: [{ id: 'item1' }] },
      staleKeys: [],
      staleMessage: null,
    });

    const result = await postInventoryCountAction(null, fd(validItems));

    expect(result).toEqual({
      status: 'success',
      message: '盘点单 IC20260821-0001 已过账',
    });
    expect(postingMock.postInventoryCount.mock.calls[0]![0].items).toEqual(validItems);
    expect(postingMock.postInventoryCount.mock.calls[0]![0].remark).toBe(
      '月末例行盘点',
    );
  });

  it('缺少盘点原因时在业务写入前失败', async () => {
    const result = await postInventoryCountAction(
      null,
      fd(validItems, { remark: '   ' }),
    );

    expect(result).toEqual({
      status: 'invalid',
      fieldErrors: { remark: ['请填写盘点过账原因'] },
    });
    expect(postingMock.postInventoryCount).not.toHaveBeenCalled();
  });

  it('部分过账时把未过账的行点名带回页面', async () => {
    postingMock.postInventoryCount.mockResolvedValue({
      count: { countNo: 'IC20260821-0002', items: [{ id: 'item1' }, { id: 'item2' }] },
      staleKeys: ['mat9:loc9'],
      staleMessage: '物料9(M-009) 默认仓库/9号货架 账面数已从 5.00 变为 2.00',
    });

    const result = await postInventoryCountAction(null, fd(validItems));

    expect(result.status).toBe('success');
    expect(result).toMatchObject({ staleKeys: ['mat9:loc9'] });
    expect(result.status === 'success' ? result.message : '').toContain('已过账 2 条');
    expect(result.status === 'success' ? result.message : '').toContain(
      '账面数已从 5.00 变为 2.00',
    );
  });

  it('全量失效时把 staleKeys 挂在 error 上（先判子类，别被通用分支吃掉）', async () => {
    postingMock.postInventoryCount.mockRejectedValue(
      new MockInventoryCountStaleSnapshotError('开始盘点后库存已变动', [
        'mat1:loc1',
      ]),
    );

    const result = await postInventoryCountAction(null, fd(validItems));

    expect(result).toEqual({
      status: 'error',
      message: '开始盘点后库存已变动',
      staleKeys: ['mat1:loc1'],
    });
  });

  it('普通业务错误照旧降级成 error，不带 staleKeys', async () => {
    postingMock.postInventoryCount.mockRejectedValue(
      new MockInventoryCountInvariantError('盘点物料已停用'),
    );

    await expect(postInventoryCountAction(null, fd(validItems))).resolves.toEqual({
      status: 'error',
      message: '盘点物料已停用',
    });
  });

  it('旧页面漏传 bookQuantity 时 fail closed，并且报中文', async () => {
    const result = await postInventoryCountAction(
      null,
      fd([{ materialId: 'mat1', locationId: 'loc1', countedQuantity: '8.00' }]),
    );

    expect(result.status).toBe('invalid');
    expect(
      result.status === 'invalid' ? result.fieldErrors.items : undefined,
    ).toEqual(['缺少账面数快照，请刷新页面后重新盘点']);
    expect(postingMock.postInventoryCount).not.toHaveBeenCalled();
  });

  it('账面数格式非法同样拦在业务层之前', async () => {
    const result = await postInventoryCountAction(
      null,
      fd([{ ...validItems[0]!, bookQuantity: 'abc' }]),
    );

    expect(result.status).toBe('invalid');
    expect(
      result.status === 'invalid' ? result.fieldErrors.items?.[0] : undefined,
    ).toBe('账面数快照格式非法，请刷新页面后重新盘点');
    expect(postingMock.postInventoryCount).not.toHaveBeenCalled();
  });

  it('items 不是合法 JSON 时直接判 invalid', async () => {
    const form = new FormData();
    form.set('idempotencyKey', '00000000-0000-4000-8000-000000000001');
    form.set('items', '{');

    const result = await postInventoryCountAction(null, form);

    expect(result).toEqual({
      status: 'invalid',
      fieldErrors: { items: ['盘点明细格式非法'] },
    });
  });
});
