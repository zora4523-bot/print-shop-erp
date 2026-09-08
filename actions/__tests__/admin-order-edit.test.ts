import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Role } from '@/generated/prisma/enums';

const mocks = vi.hoisted(() => ({
  permission: vi.fn(),
  edit: vi.fn(),
  revalidate: vi.fn(),
}));
vi.mock('@/lib/auth/permissions', () => ({
  requirePermission: mocks.permission,
}));
vi.mock('@/lib/order/admin-edit', () => ({ editAdminOrder: mocks.edit }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
vi.mock('@/lib/order', () => ({ OrderInvariantError: class extends Error {} }));
import { OrderInvariantError } from '@/lib/order';
import {
  previewAdminOrderEditAction,
  saveAdminOrderEditAction,
} from '../admin-order-edit';

const actor = { id: 'admin-1', role: Role.ADMIN };
const payload = {
  orderId: 'order-1',
  requestId: '00000000-0000-4000-8000-000000000001',
  expectedRevision: 1,
  expectedWorkOrderVersion: 1,
  fields: { expectedEditVersion: '0', remark: '新的备注' },
  items: [],
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.permission.mockResolvedValue(actor);
});

describe('administrator edit actions', () => {
  it('requires permission before parsing or invoking the domain command', async () => {
    mocks.permission.mockRejectedValueOnce(new Error('无权访问'));
    await expect(saveAdminOrderEditAction(payload)).rejects.toThrow('无权访问');
    expect(mocks.permission).toHaveBeenCalledWith('order:create');
    expect(mocks.edit).not.toHaveBeenCalled();
  });
  it('rejects malformed version data without writes or cache invalidation', async () => {
    expect(
      await saveAdminOrderEditAction({
        ...payload,
        fields: { expectedEditVersion: '1e3' },
      }),
    ).toMatchObject({ status: 'error' });
    expect(mocks.edit).not.toHaveBeenCalled();
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it('returns a preview without invalidating the live page', async () => {
    const preview = { oldTotal: '180.00', newTotal: '180.00', complete: true };
    mocks.edit.mockResolvedValueOnce(preview);
    expect(await previewAdminOrderEditAction(payload)).toEqual({
      status: 'preview',
      preview,
    });
    expect(mocks.edit).toHaveBeenCalledWith(
      expect.objectContaining({
        fields: { expectedEditVersion: 0, remark: '新的备注' },
        pendingChargeResolutions: [],
      }),
      actor,
      'preview',
    );
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it('invalidates list, details and editor only after a committed save', async () => {
    mocks.edit.mockResolvedValueOnce(null);
    expect(await saveAdminOrderEditAction(payload)).toEqual({
      status: 'saved',
    });
    expect(mocks.revalidate.mock.calls).toEqual([
      ['/orders'],
      ['/orders/order-1'],
      ['/orders/order-1/edit'],
    ]);
  });
  it('returns domain errors while preserving the current page', async () => {
    mocks.edit.mockRejectedValueOnce(
      new OrderInvariantError('只有管理员可以直接保存款式修改'),
    );
    expect(await saveAdminOrderEditAction(payload)).toEqual({
      status: 'error',
      message: '只有管理员可以直接保存款式修改',
    });
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
});
