import { beforeEach, describe, expect, it, vi } from 'vitest';

const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    businessCodeSequence: {
      upsert: vi.fn(),
    },
    warehouse: {
      findMany: vi.fn(),
      create: vi.fn(),
      findUnique: vi.fn(),
    },
    warehouseLocation: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
  },
}));

vi.mock('@/lib/db', () => ({ db: dbMock }));

import {
  createWarehouse,
  createWarehouseLocation,
  listActiveWarehouseLocationOptions,
  WarehouseInvariantError,
} from '../warehouse';

beforeEach(() => {
  dbMock.businessCodeSequence.upsert.mockReset();
  for (const fn of Object.values(dbMock.warehouse)) fn.mockReset();
  for (const fn of Object.values(dbMock.warehouseLocation)) fn.mockReset();
});

describe('listActiveWarehouseLocationOptions', () => {
  it('lists active locations and only marks the default warehouse/default location pair as default', async () => {
    dbMock.warehouseLocation.findMany.mockResolvedValue([
      {
        id: 'loc-default',
        warehouseId: 'wh-default',
        code: 'DEFAULT',
        name: '默认库位',
        isDefault: true,
        warehouse: {
          code: 'DEFAULT',
          name: '默认仓库',
          isDefault: true,
        },
      },
      {
        id: 'loc-secondary',
        warehouseId: 'wh-secondary',
        code: 'A01',
        name: 'A01',
        isDefault: true,
        warehouse: {
          code: 'WH2',
          name: '二号仓',
          isDefault: false,
        },
      },
    ]);

    const rows = await listActiveWarehouseLocationOptions();

    expect(dbMock.warehouseLocation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          isActive: true,
          warehouse: { isActive: true },
        },
      }),
    );
    expect(rows).toEqual([
      expect.objectContaining({ id: 'loc-default', isDefault: true }),
      expect.objectContaining({ id: 'loc-secondary', isDefault: false }),
    ]);
  });
});

describe('createWarehouse', () => {
  it('generates a warehouse code when omitted', async () => {
    dbMock.businessCodeSequence.upsert.mockResolvedValueOnce({ value: 3 });
    dbMock.warehouse.create.mockResolvedValue({ id: 'wh1' });

    await createWarehouse({ code: null, name: '三号仓' });

    expect(dbMock.warehouse.create.mock.calls[0][0].data.code).toBe('WH-000003');
  });

  it('creates non-default active warehouses', async () => {
    dbMock.warehouse.create.mockResolvedValue({ id: 'wh1' });

    await createWarehouse({ code: 'WH1', name: '一号仓' });

    expect(dbMock.warehouse.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          code: 'WH1',
          name: '一号仓',
          isDefault: false,
          isActive: true,
        },
      }),
    );
  });
});

describe('createWarehouseLocation', () => {
  it('generates a location code after validating the warehouse', async () => {
    dbMock.warehouse.findUnique.mockResolvedValue({ id: 'wh1', isActive: true });
    dbMock.businessCodeSequence.upsert.mockResolvedValueOnce({ value: 9 });
    dbMock.warehouseLocation.create.mockResolvedValue({ id: 'loc1' });

    await createWarehouseLocation({
      warehouseId: 'wh1',
      code: null,
      name: '九号库位',
    });

    expect(dbMock.warehouseLocation.create.mock.calls[0][0].data.code).toBe(
      'LOC-000009',
    );
  });

  it('rejects locations under inactive warehouses', async () => {
    dbMock.warehouse.findUnique.mockResolvedValue({ id: 'wh1', isActive: false });

    await expect(
      createWarehouseLocation({
        warehouseId: 'wh1',
        code: 'A01',
        name: 'A01',
      }),
    ).rejects.toBeInstanceOf(WarehouseInvariantError);
    expect(dbMock.warehouseLocation.create).not.toHaveBeenCalled();
  });

  it('creates non-default active locations under active warehouses', async () => {
    dbMock.warehouse.findUnique.mockResolvedValue({ id: 'wh1', isActive: true });
    dbMock.warehouseLocation.create.mockResolvedValue({ id: 'loc1' });

    await createWarehouseLocation({
      warehouseId: 'wh1',
      code: 'A01',
      name: 'A01',
    });

    expect(dbMock.warehouseLocation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          warehouseId: 'wh1',
          code: 'A01',
          name: 'A01',
          isDefault: false,
          isActive: true,
        },
      }),
    );
  });
});
