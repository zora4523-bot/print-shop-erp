import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MachineType, WorkerType } from '../../generated/prisma/enums';

const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    $executeRaw: vi.fn(),
    $transaction: vi.fn(),
    businessCodeSequence: {
      upsert: vi.fn(),
    },
    craft: {
      count: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));
vi.mock('@/lib/db', () => ({ db: dbMock }));

import {
  listActiveCraftOrderOptions,
  listCrafts,
  listCraftsPage,
  getCraftSummary,
  createCraft,
  updateCraft,
  setCraftActive,
  CraftInvariantError,
  isRetiredCraft,
} from '../craft';

const makeCraft = (over: Partial<{
  id: string;
  name: string;
  code: string;
  isOutsource: boolean;
  defaultWorkerType: WorkerType | null;
  defaultMachineType: MachineType | null;
  sortOrder: number;
  isActive: boolean;
}> = {}) => ({
  id: 'craft-1',
  name: '局部烫金',
  code: 'FLAT_FOIL_PARTIAL',
  isOutsource: false,
  defaultWorkerType: WorkerType.MACHINE,
  defaultMachineType: MachineType.HAND_PRESS,
  sortOrder: 10,
  isActive: true,
  createdAt: new Date('2026-04-23T00:00:00Z'),
  updatedAt: new Date('2026-04-23T00:00:00Z'),
  ...over,
});

beforeEach(() => {
  dbMock.$executeRaw.mockReset().mockResolvedValue(0);
  dbMock.$transaction
    .mockReset()
    .mockImplementation(async (callback: (tx: typeof dbMock) => unknown) =>
      callback(dbMock),
    );
  dbMock.businessCodeSequence.upsert.mockReset();
  for (const fn of Object.values(dbMock.craft)) fn.mockReset();
});

describe('listCrafts', () => {
  it('orders by active desc, sortOrder asc, name asc', async () => {
    dbMock.craft.findMany.mockResolvedValue([]);
    await listCrafts();
    expect(dbMock.craft.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ isActive: 'desc' }, { sortOrder: 'asc' }, { name: 'asc' }],
      }),
    );
  });
});

describe('listCraftsPage', () => {
  it('fetches only the requested page in the stable craft order', async () => {
    dbMock.craft.count.mockResolvedValue(21);
    dbMock.craft.findMany.mockResolvedValue([makeCraft({ id: 'craft-21' })]);

    const page = await listCraftsPage({ page: 2, pageSize: 20 });

    expect(page).toMatchObject({ total: 21, page: 2, pageCount: 2 });
    expect(dbMock.craft.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 20,
        take: 20,
        orderBy: [
          { isActive: 'desc' },
          { sortOrder: 'asc' },
          { name: 'asc' },
          { id: 'asc' },
        ],
      }),
    );
  });
});

describe('listActiveCraftOrderOptions', () => {
  it('只选择现行活跃工艺，并标记低频尾部', async () => {
    dbMock.craft.findMany.mockResolvedValue([
      {
        id: 'craft-1',
        code: 'FLAT_FOIL_PARTIAL',
        name: '局部烫金',
        isOutsource: false,
        sortOrder: 10,
      },
    ]);

    const result = await listActiveCraftOrderOptions();

    expect(dbMock.craft.findMany).toHaveBeenCalledWith({
      where: {
        isActive: true,
        code: { notIn: ['STOCK_FOIL'] },
      },
      select: {
        id: true,
        code: true,
        name: true,
        isOutsource: true,
        sortOrder: true,
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }],
    });
    expect(result).toEqual([
      {
        id: 'craft-1',
        code: 'FLAT_FOIL_PARTIAL',
        name: '局部烫金',
        isOutsource: false,
        isLowFrequency: false,
      },
    ]);
  });
});

describe('createCraft', () => {
  it('拒绝通过创建路径重建已退役工艺', async () => {
    await expect(
      createCraft({
        name: '现货加烫',
        code: 'STOCK_FOIL',
        isOutsource: false,
        defaultWorkerType: WorkerType.MACHINE,
        defaultMachineType: MachineType.HAND_PRESS,
        sortOrder: 900,
      }),
    ).rejects.toThrow(/历史工艺已退役.*不能新建/u);

    expect(dbMock.craft.create).not.toHaveBeenCalled();
  });

  it('generates a stable code when the create input leaves it blank', async () => {
    dbMock.businessCodeSequence.upsert.mockResolvedValueOnce({ value: 7 });
    dbMock.craft.create.mockResolvedValue(makeCraft({ code: 'CRF_000007' }));

    await createCraft({
      name: '新工艺',
      code: null,
      isOutsource: false,
      defaultWorkerType: WorkerType.PACKER,
      defaultMachineType: null,
      sortOrder: 80,
    });

    expect(dbMock.craft.create.mock.calls[0][0].data.code).toBe('CRF_000007');
  });

  it('inserts with isActive=true regardless of input', async () => {
    dbMock.craft.create.mockResolvedValue(makeCraft());
    await createCraft({
      name: '专版单色平烫',
      code: 'FLAT_FOIL_SINGLE',
      isOutsource: false,
      defaultWorkerType: WorkerType.MACHINE,
      defaultMachineType: MachineType.WINDMILL,
      sortOrder: 20,
    });
    expect(dbMock.craft.create.mock.calls[0][0].data.isActive).toBe(true);
    const sql = (
      dbMock.$executeRaw.mock.calls[0]?.[0] as TemplateStringsArray
    ).join('?');
    expect(sql).toContain('pg_advisory_xact_lock');
    expect(sql).not.toContain('pg_advisory_xact_lock_shared');
    expect(dbMock.craft.create.mock.invocationCallOrder[0]).toBeGreaterThan(
      dbMock.$executeRaw.mock.invocationCallOrder[0]!,
    );
  });

  it('persists defaultMachineType=null for an outsource craft when supplied', async () => {
    dbMock.craft.create.mockResolvedValue(makeCraft());
    await createCraft({
      name: 'UV',
      code: 'UV',
      isOutsource: true,
      defaultWorkerType: null,
      defaultMachineType: null,
      sortOrder: 60,
    });
    expect(dbMock.craft.create.mock.calls[0][0].data.defaultMachineType).toBeNull();
  });

  it('clears the internal worker type but preserves an outsource reference machine', async () => {
    dbMock.craft.create.mockResolvedValue(makeCraft());
    await createCraft({
      name: '冰白彩印（印刷+烫金）',
      code: 'COLOR_PRINT_FOIL',
      isOutsource: true,
      defaultWorkerType: WorkerType.MACHINE,
      defaultMachineType: MachineType.WINDMILL,
      sortOrder: 71,
    });
    const data = dbMock.craft.create.mock.calls[0][0].data;
    expect(data.isOutsource).toBe(true);
    expect(data.defaultWorkerType).toBeNull();
    expect(data.defaultMachineType).toBe(MachineType.WINDMILL);
  });
});

describe('updateCraft', () => {
  it('throws when the target does not exist', async () => {
    dbMock.craft.findUnique.mockResolvedValue(null);
    await expect(
      updateCraft('nope', {
        name: 'X',
        isOutsource: false,
        defaultWorkerType: WorkerType.PACKER,
        defaultMachineType: null,
        sortOrder: 10,
      }),
    ).rejects.toBeInstanceOf(CraftInvariantError);
    expect(dbMock.craft.update).not.toHaveBeenCalled();
  });

  it('updates the editable fields', async () => {
    dbMock.craft.findUnique.mockResolvedValue(makeCraft());
    dbMock.craft.update.mockResolvedValue(makeCraft({ name: '现货加烫(改名)' }));
    await updateCraft('craft-1', {
      name: '现货加烫(改名)',
      isOutsource: false,
      defaultWorkerType: WorkerType.MACHINE,
      defaultMachineType: MachineType.HAND_PRESS,
      sortOrder: 10,
    });
    const data = dbMock.craft.update.mock.calls[0][0].data;
    expect(data.name).toBe('现货加烫(改名)');
    expect(data).not.toHaveProperty('code');
    expect(dbMock.craft.findUnique.mock.invocationCallOrder[0]).toBeGreaterThan(
      dbMock.$executeRaw.mock.invocationCallOrder[0]!,
    );
  });

  it('never writes isActive through the update path', async () => {
    dbMock.craft.findUnique.mockResolvedValue(makeCraft());
    dbMock.craft.update.mockResolvedValue(makeCraft());
    await updateCraft('craft-1', {
      name: 'x',
      isOutsource: false,
      defaultWorkerType: WorkerType.PACKER,
      defaultMachineType: null,
      sortOrder: 10,
    });
    const data = dbMock.craft.update.mock.calls[0][0].data as Record<string, unknown>;
    expect('isActive' in data).toBe(false);
  });
});

describe('setCraftActive', () => {
  it('no-ops when already in the desired state', async () => {
    const active = makeCraft({ isActive: true });
    dbMock.craft.findUnique.mockResolvedValue(active);
    const r = await setCraftActive('craft-1', true);
    expect(r).toBe(active);
    expect(dbMock.craft.update).not.toHaveBeenCalled();
  });

  it('flips isActive when different', async () => {
    dbMock.craft.findUnique.mockResolvedValue(makeCraft({ isActive: true }));
    dbMock.craft.update.mockResolvedValue(makeCraft({ isActive: false }));
    await setCraftActive('craft-1', false);
    expect(dbMock.craft.update.mock.calls[0][0].data).toEqual({ isActive: false });
    expect(dbMock.craft.findUnique.mock.invocationCallOrder[0]).toBeGreaterThan(
      dbMock.$executeRaw.mock.invocationCallOrder[0]!,
    );
  });

  it('允许普通停用工艺重新启用', async () => {
    dbMock.craft.findUnique.mockResolvedValue(
      makeCraft({ isActive: false }),
    );
    dbMock.craft.update.mockResolvedValue(makeCraft({ isActive: true }));

    await setCraftActive('craft-1', true);

    expect(dbMock.craft.update.mock.calls[0][0].data).toEqual({
      isActive: true,
    });
  });

  it('拒绝从任何激活请求重新启用 STOCK_FOIL', async () => {
    dbMock.craft.findUnique.mockResolvedValue(
      makeCraft({ code: 'STOCK_FOIL', isActive: false }),
    );

    await expect(setCraftActive('craft-1', true)).rejects.toThrow(
      /历史工艺已退役.*不能重新启用/u,
    );
    expect(dbMock.craft.update).not.toHaveBeenCalled();
  });

  it('已退役工艺仍可从异常激活状态停用', async () => {
    dbMock.craft.findUnique.mockResolvedValue(
      makeCraft({ code: 'STOCK_FOIL', isActive: true }),
    );
    dbMock.craft.update.mockResolvedValue(
      makeCraft({ code: 'STOCK_FOIL', isActive: false }),
    );

    await setCraftActive('craft-1', false);

    expect(dbMock.craft.update.mock.calls[0][0].data).toEqual({
      isActive: false,
    });
  });

  it('throws when the target is missing', async () => {
    dbMock.craft.findUnique.mockResolvedValue(null);
    await expect(setCraftActive('nope', false)).rejects.toBeInstanceOf(CraftInvariantError);
  });
});

describe('isRetiredCraft', () => {
  it('只将 STOCK_FOIL 判定为历史退役工艺', () => {
    expect(isRetiredCraft({ code: 'STOCK_FOIL' })).toBe(true);
    expect(isRetiredCraft({ code: 'FLAT_FOIL_PARTIAL' })).toBe(false);
  });
});

describe('getCraftSummary', () => {
  it('returns null when absent', async () => {
    dbMock.craft.findUnique.mockResolvedValue(null);
    const r = await getCraftSummary('nope');
    expect(r).toBeNull();
  });
});
