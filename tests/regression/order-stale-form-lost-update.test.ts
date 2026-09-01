import { describe, expect, it, vi } from 'vitest';
import { OrderStatus, Role } from '../../generated/prisma/enums';

type PersistedOrder = {
  id: string;
  status: (typeof OrderStatus)[keyof typeof OrderStatus];
  submitterId: string;
  customName: string | null;
  customerRef: string | null;
  receiverName: string | null;
  receiverPhone: string | null;
  receiverAddress: string | null;
  expressCode: string | null;
  packageRequirement: string | null;
  remark: string | null;
  promisedDate: Date | null;
  isUrgent: boolean;
  isSfCollect: boolean;
  editVersion: number;
  updatedAt: Date;
};

const { dbMock, persisted } = vi.hoisted(() => {
  const persisted: { current: PersistedOrder | null } = { current: null };

  const txMock = {
    $executeRaw: vi.fn().mockResolvedValue(undefined),
    order: {
      findFirst: vi.fn(async () =>
        persisted.current ? { ...persisted.current } : null,
      ),
      update: vi.fn(
        async ({ data }: { data: Partial<PersistedOrder> }) => {
          if (!persisted.current) throw new Error('missing mocked order');
          persisted.current = { ...persisted.current, ...data };
          return {
            id: persisted.current.id,
            status: persisted.current.status,
          };
        },
      ),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string; editVersion: number };
          data: Partial<PersistedOrder>;
        }) => {
          if (
            !persisted.current ||
            persisted.current.id !== where.id ||
            persisted.current.editVersion !== where.editVersion
          ) {
            return { count: 0 };
          }
          persisted.current = {
            ...persisted.current,
            ...data,
            // Reproduce two writes inside one TIMESTAMP(3) tick: updatedAt is
            // unchanged, while the database-owned token remains monotonic.
            editVersion: persisted.current.editVersion + 1,
          };
          return { count: 1 };
        },
      ),
    },
    orderShipment: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    orderLog: {
      create: vi.fn().mockResolvedValue({ id: 'log-1' }),
    },
  };

  return {
    persisted,
    dbMock: {
      ...txMock,
      $transaction: vi.fn(
        async (callback: (tx: typeof txMock) => Promise<unknown>) =>
          callback(txMock),
      ),
    },
  };
});

vi.mock('@/lib/db', () => ({ db: dbMock }));
vi.mock('@/lib/auth/schemas', () => ({ parseStrictYmd: vi.fn() }));
vi.mock('@/lib/notification/dispatch', () => ({
  dispatchNotification: vi.fn(),
}));

import { updateOrderFields } from '../../lib/order';

describe('P0 regression: stale order edit form', () => {
  it('rejects the second stale full-form submission without overwriting or side effects', async () => {
    const initialUpdatedAt = new Date('2026-08-30T00:00:00.000Z');
    persisted.current = {
      id: 'order-1',
      status: OrderStatus.DRAFT,
      submitterId: 'sales-1',
      customName: null,
      customerRef: '初始客户简称',
      receiverName: '张三',
      receiverPhone: '13800000000',
      receiverAddress: '佛山市禅城区旧地址',
      expressCode: null,
      packageRequirement: null,
      remark: null,
      promisedDate: null,
      isUrgent: false,
      isSfCollect: false,
      editVersion: 0,
      updatedAt: initialUpdatedAt,
    };

    // Two browser tabs opened from this same snapshot. A changes only remark;
    // B changes only customerRef, but both forms submit their complete snapshot.
    const initialForm = {
      expectedEditVersion: 0,
      customName: null,
      customerRef: '初始客户简称',
      receiverName: '张三',
      receiverPhone: '13800000000',
      receiverAddress: '佛山市禅城区旧地址',
      expressCode: null,
      packageRequirement: null,
      remark: null,
      promisedDate: null,
      isUrgent: false,
    };
    const editorAForm = { ...initialForm, remark: '编辑器 A 新增的备注' };
    const editorBStaleForm = {
      ...initialForm,
      customerRef: '编辑器 B 修改的客户简称',
    };
    const actor = { id: 'sales-1', role: Role.SALES };

    await updateOrderFields('order-1', editorAForm, actor);

    await expect(
      updateOrderFields('order-1', editorBStaleForm, actor),
    ).rejects.toThrow(
      '工单已被其他人修改，请刷新页面后再编辑',
    );

    expect(persisted.current).toMatchObject({
      customerRef: '初始客户简称',
      remark: '编辑器 A 新增的备注',
    });
    expect(dbMock.orderShipment.updateMany).not.toHaveBeenCalled();
    expect(dbMock.orderLog.create).toHaveBeenCalledTimes(1);
  });
});
