import { describe, expect, it, vi } from 'vitest';
import { MaterialCategory } from '../../generated/prisma/enums';

const { dbMock } = vi.hoisted(() => {
  const material = {
    findUnique: vi.fn(),
    update: vi.fn(),
  };
  const tx = { material, $executeRaw: vi.fn() };
  return {
    dbMock: {
      material,
      $transaction: vi.fn(
        (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
      ),
    },
  };
});

vi.mock('@/lib/db', () => ({ db: dbMock }));
vi.mock('@/lib/notification/dispatch', () => ({
  dispatchNotification: vi.fn(),
}));
vi.mock('@/lib/notification/transactional-outbox', () => ({
  enqueueNotificationInTransaction: vi.fn(),
}));

import { MaterialUnitChangeError, updateMaterial } from '../../lib/material';

describe('material unit history invariant', () => {
  it('rejects kg-to-roll changes immediately after creation, before any quantity fact exists', async () => {
    const existingMaterial = {
      id: 'new-material',
      code: 'INK-001',
      name: '专色油墨',
      category: MaterialCategory.OTHER,
      specification: null,
      unit: 'kg',
      searchPinyin: null,
      searchPinyinInitials: null,
      currentStock: '0.00',
      safetyStock: null,
      averageCost: null,
      isActive: true,
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
      updatedAt: new Date('2026-08-30T00:00:00.000Z'),
    };
    dbMock.material.findUnique.mockResolvedValue(existingMaterial);

    await expect(
      updateMaterial(existingMaterial.id, {
        code: existingMaterial.code,
        name: existingMaterial.name,
        category: existingMaterial.category,
        specification: existingMaterial.specification,
        unit: '卷',
        safetyStock: null,
        averageCost: null,
      }),
    ).rejects.toMatchObject({
      name: MaterialUnitChangeError.name,
      message: expect.stringContaining('请新建物料'),
    });

    expect(dbMock.material.update).not.toHaveBeenCalled();
  });
});
