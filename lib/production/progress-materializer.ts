export type ProgressMaterializationItemFact = {
  id: string;
  sequence: number;
  quantity: number;
  crafts: readonly string[];
};

export type ProgressMaterializationCraftFact = {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  isOutsource: boolean;
};

export type ProductionProgressStepSpec = {
  orderItemId: string;
  craftId: string;
  craftCode: string;
  craftName: string;
  plannedQty: string;
};

export type ProductionProgressMaterializationIssue = {
  code:
    | 'DUPLICATE_ITEM_CRAFT'
    | 'MISSING_CRAFT_DICTIONARY_ROW'
    | 'INACTIVE_CRAFT';
  path: string;
  message: string;
};

export type ProductionProgressPlan =
  | {
      ok: true;
      specs: ProductionProgressStepSpec[];
      issues: [];
    }
  | {
      ok: false;
      specs: [];
      issues: ProductionProgressMaterializationIssue[];
    };

/**
 * These codes are already represented by PARTIAL / FULL / PACKING in the
 * piecework ledger. Every other active in-house craft becomes a no-pay
 * progress step. Outsource crafts stay exclusively in OutsourceOrder.
 *
 * This is intentionally a code whitelist. It never reads worker defaults,
 * machines, capabilities, or assignments, and a newly added active in-house
 * craft automatically remains visible as progress instead of disappearing.
 */
export const PIECEWORK_CRAFT_CODE_WHITELIST = new Set([
  'FLAT_FOIL_PARTIAL',
  'FLAT_FOIL_SINGLE',
  'FLAT_FOIL_DOUBLE',
  'FLAT_FOIL_TRIPLE',
  'PACKING',
]);

export function deriveProductionProgressPlan(input: {
  items: readonly ProgressMaterializationItemFact[];
  crafts: readonly ProgressMaterializationCraftFact[];
}): ProductionProgressPlan {
  const craftById = new Map(input.crafts.map((craft) => [craft.id, craft]));
  const issues: ProductionProgressMaterializationIssue[] = [];
  const specs: ProductionProgressStepSpec[] = [];

  for (const [itemIndex, item] of input.items.entries()) {
    const seenCraftIds = new Set<string>();
    for (const [craftIndex, craftId] of item.crafts.entries()) {
      const path = `items[${itemIndex}].crafts[${craftIndex}]`;
      if (seenCraftIds.has(craftId)) {
        issues.push({
          code: 'DUPLICATE_ITEM_CRAFT',
          path,
          message: `款式 #${item.sequence} 重复引用工艺 ${craftId}`,
        });
        continue;
      }
      seenCraftIds.add(craftId);

      const craft = craftById.get(craftId);
      if (!craft) {
        issues.push({
          code: 'MISSING_CRAFT_DICTIONARY_ROW',
          path,
          message: `款式 #${item.sequence} 引用的工艺 ${craftId} 不存在`,
        });
        continue;
      }
      if (!craft.isActive) {
        issues.push({
          code: 'INACTIVE_CRAFT',
          path,
          message: `款式 #${item.sequence} 引用的历史工艺 ${craft.code} 已停用，拒绝自动投产`,
        });
        continue;
      }
      if (
        craft.isOutsource ||
        PIECEWORK_CRAFT_CODE_WHITELIST.has(craft.code)
      ) {
        continue;
      }

      specs.push({
        orderItemId: item.id,
        craftId: craft.id,
        craftCode: craft.code,
        craftName: craft.name,
        plannedQty: String(item.quantity),
      });
    }
  }

  if (issues.length > 0) return { ok: false, specs: [], issues };
  return {
    ok: true,
    specs: specs.sort((left, right) =>
      [left.orderItemId, left.craftCode, left.craftId]
        .join(':')
        .localeCompare(
          [right.orderItemId, right.craftCode, right.craftId].join(':'),
        ),
    ),
    issues: [],
  };
}
