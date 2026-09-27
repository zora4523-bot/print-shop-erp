import { describe, expect, it } from 'vitest';
import { deriveProductionProgressPlan } from '../progress-materializer';

const items = [
  {
    id: 'item-1',
    sequence: 1,
    quantity: 100,
    crafts: [
      'partial',
      'full',
      'packing',
      'gluing',
      'unknown-in-house',
      'outsource',
    ],
  },
];

function craft(
  id: string,
  code: string,
  overrides: Partial<{
    name: string;
    isActive: boolean;
    isOutsource: boolean;
  }> = {},
) {
  return {
    id,
    code,
    name: overrides.name ?? code,
    isActive: overrides.isActive ?? true,
    isOutsource: overrides.isOutsource ?? false,
  };
}

describe('deriveProductionProgressPlan', () => {
  it('仅把活跃内制非计件工艺物化为进度步骤', () => {
    const result = deriveProductionProgressPlan({
      items,
      crafts: [
        craft('partial', 'FLAT_FOIL_PARTIAL'),
        craft('full', 'FLAT_FOIL_SINGLE'),
        craft('packing', 'PACKING'),
        craft('gluing', 'GLUING', { name: '粘封' }),
        craft('unknown-in-house', 'NEW_IN_HOUSE', { name: '新内制工艺' }),
        craft('outsource', 'UV', { isOutsource: true }),
      ],
    });

    expect(result).toEqual({
      ok: true,
      specs: [
        expect.objectContaining({ craftCode: 'GLUING', plannedQty: '100' }),
        expect.objectContaining({ craftCode: 'NEW_IN_HOUSE', plannedQty: '100' }),
      ],
      issues: [],
    });
  });

  it('工艺缺失或停用时 fail closed', () => {
    const result = deriveProductionProgressPlan({
      items: [
        {
          id: 'item-1',
          sequence: 1,
          quantity: 100,
          crafts: ['missing', 'inactive'],
        },
      ],
      crafts: [craft('inactive', 'OLD', { isActive: false })],
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected materialization issues');
    expect(result.issues.map((issue) => issue.code)).toEqual([
      'MISSING_CRAFT_DICTIONARY_ROW',
      'INACTIVE_CRAFT',
    ]);
  });

  it('同款重复工艺不静默去重', () => {
    const result = deriveProductionProgressPlan({
      items: [
        {
          id: 'item-1',
          sequence: 1,
          quantity: 100,
          crafts: ['gluing', 'gluing'],
        },
      ],
      crafts: [craft('gluing', 'GLUING')],
    });

    expect(result).toMatchObject({
      ok: false,
      issues: [{ code: 'DUPLICATE_ITEM_CRAFT' }],
    });
  });
});
