import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MachineType } from '../../generated/prisma/client';

const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    craft: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));
vi.mock('@/lib/db', () => ({ db: dbMock }));

import {
  listCrafts,
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
  defaultMachineType: MachineType | null;
  sortOrder: number;
  isActive: boolean;
}> = {}) => ({
  id: 'craft-1',
  name: '现货加烫',
  code: 'STOCK_FOIL',
  isOutsource: false,
  defaultMachineType: MachineType.HAND_PRESS,
  sortOrder: 10,
  isActive: true,
  createdAt: new Date('2026-04-23T00:00:00Z'),
  updatedAt: new Date('2026-04-23T00:00:00Z'),
  ...over,
});

beforeEach(() => {
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

describe('createCraft', () => {
  it('inserts with isActive=true regardless of input', async () => {
    dbMock.craft.create.mockResolvedValue(makeCraft());
    await createCraft({
      name: '专版单色平烫',
      code: 'FLAT_FOIL_SINGLE',
      isOutsource: false,
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
      defaultMachineType: null,
      sortOrder: 60,
    });
    expect(dbMock.craft.create.mock.calls[0][0].data.defaultMachineType).toBeNull();
  });

  it('allows hybrid outsource + defaultMachineType (SPEC §6.1 COLOR_PRINT_FOIL)', async () => {
    dbMock.craft.create.mockResolvedValue(makeCraft());
    await createCraft({
      name: '冰白彩印（印刷+烫金）',
      code: 'COLOR_PRINT_FOIL',
      isOutsource: true,
      defaultMachineType: MachineType.WINDMILL,
      sortOrder: 71,
    });
    const data = dbMock.craft.create.mock.calls[0][0].data;
    expect(data.isOutsource).toBe(true);
    expect(data.defaultMachineType).toBe(MachineType.WINDMILL);
  });
});

describe('updateCraft', () => {
  it('throws when the target does not exist', async () => {
    dbMock.craft.findUnique.mockResolvedValue(null);
    await expect(
      updateCraft('nope', {
        name: 'X',
        code: 'X',
        isOutsource: false,
        defaultMachineType: null,
        sortOrder: 0,
        isActive: true,
      }),
    ).rejects.toBeInstanceOf(CraftInvariantError);
    expect(dbMock.craft.update).not.toHaveBeenCalled();
  });

  it('updates all fields including isActive', async () => {
    dbMock.craft.findUnique.mockResolvedValue(makeCraft());
    dbMock.craft.update.mockResolvedValue(makeCraft({ isActive: false }));
    await updateCraft('craft-1', {
      name: '现货加烫(改名)',
      code: 'STOCK_FOIL',
      isOutsource: false,
      defaultMachineType: MachineType.HAND_PRESS,
      sortOrder: 10,
      isActive: false,
    });
    const data = dbMock.craft.update.mock.calls[0][0].data;
    expect(data.name).toBe('现货加烫(改名)');
    expect(data.isActive).toBe(false);
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
