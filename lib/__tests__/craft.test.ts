import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MachineType, WorkerType } from '../../generated/prisma/client';

const { dbMock } = vi.hoisted(() => ({
  dbMock: {
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
  name: '现货加烫',
  code: 'STOCK_FOIL',
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
  it('selects only active fields required by the order form', async () => {
    dbMock.craft.findMany.mockResolvedValue([
      { id: 'craft-1', name: '现货加烫', isOutsource: false },
    ]);

    await listActiveCraftOrderOptions();

    expect(dbMock.craft.findMany).toHaveBeenCalledWith({
      where: { isActive: true },
      select: { id: true, name: true, isOutsource: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }],
    });
  });
});

describe('createCraft', () => {
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
        code: 'XX',
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
      code: 'STOCK_FOIL',
      isOutsource: false,
      defaultWorkerType: WorkerType.MACHINE,
      defaultMachineType: MachineType.HAND_PRESS,
      sortOrder: 10,
    });
    const data = dbMock.craft.update.mock.calls[0][0].data;
    expect(data.name).toBe('现货加烫(改名)');
  });

  it('never writes isActive through the update path', async () => {
    dbMock.craft.findUnique.mockResolvedValue(makeCraft());
    dbMock.craft.update.mockResolvedValue(makeCraft());
    await updateCraft('craft-1', {
      name: 'x',
      code: 'XX',
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
  });

  it('throws when the target is missing', async () => {
    dbMock.craft.findUnique.mockResolvedValue(null);
    await expect(setCraftActive('nope', false)).rejects.toBeInstanceOf(CraftInvariantError);
  });
});

describe('getCraftSummary', () => {
  it('returns null when absent', async () => {
    dbMock.craft.findUnique.mockResolvedValue(null);
    const r = await getCraftSummary('nope');
    expect(r).toBeNull();
  });
});
