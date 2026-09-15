import { packagingBoxType } from '../order/packaging-mode';
import { calculatePackagingBagCount } from '../order/packaging-bag-count';
import {
  OrderCraft,
  OrderPackagingMode,
  PieceworkOperationType,
  PieceworkRateUnit,
  ProductionOperationSourceType,
} from '../../generated/prisma/enums';

export type CanonicalProductionItemFact = {
  id: string;
  sequence: number;
  craft: OrderCraft | null;
  quantity: number;
  frontFoilColors: readonly string[];
  backFoilColors: readonly string[];
  hasLocalFoil: boolean | null;
};

export type CanonicalPackagingGroupFact = {
  mode?: OrderPackagingMode;
  id: string;
  sequence: number;
  actualBagCount: number;
  lines: readonly {
    orderItemId: string;
    unitsPerBag: number;
  }[];
};

export type CanonicalProductionOrderFacts = {
  orderId: string;
  shipments?: readonly {lines: readonly {orderItemId: string; quantity: number}[]}[];
  items: readonly CanonicalProductionItemFact[];
  packagingGroups: readonly CanonicalPackagingGroupFact[];
};

export type ProductionOperationSourceSpec = {
  sourceType: ProductionOperationSourceType;
  orderItemId: string | null;
  packagingGroupId: string | null;
  /** Quantity persisted in the operation's canonical rate unit. */
  sourceQty: string;
  /** Trace evidence; PARTIAL reports are entered in completed pieces. */
  completedPieceQty: string;
  /** Trace evidence; only PARTIAL can be greater than one. */
  passCount: number;
};

export type ProductionOperationSpec = {
  /** Stable only within the materialization plan; never used as a database id. */
  key: string;
  operationType: PieceworkOperationType;
  unit: PieceworkRateUnit;
  /** Quantity in `unit`: PARTIAL therefore stores pieces x passCount. */
  plannedQty: string;
  /** A PARTIAL operation is split by pass count, so report math is unambiguous. */
  passCount: number;
  sources: ProductionOperationSourceSpec[];
};

export type ProductionMaterializationIssueCode =
  | 'NO_ITEMS'
  | 'DUPLICATE_ITEM'
  | 'INVALID_ITEM_QUANTITY'
  | 'OPERATION_QUANTITY_OVERFLOW'
  | 'UNKNOWN_CRAFT'
  | 'MISSING_PARTIAL_PASS_FACTS'
  | 'AMBIGUOUS_PRINT_FOIL_MODE'
  | 'NO_PACKAGING_GROUPS'
  | 'DUPLICATE_PACKAGING_GROUP'
  | 'INVALID_PACKAGING_QUANTITY'
  | 'EMPTY_PACKAGING_GROUP'
  | 'UNKNOWN_PACKAGING_ITEM'
  | 'DUPLICATE_PACKAGING_LINE'
  | 'INVALID_UNITS_PER_BAG'
  | 'PACKAGING_QUANTITY_MISMATCH';

export type ProductionMaterializationIssue = {
  code: ProductionMaterializationIssueCode;
  path: string;
  message: string;
};

export type ProductionOperationPlan =
  | { ok: true; specs: ProductionOperationSpec[]; issues: [] }
  | { ok: false; specs: []; issues: ProductionMaterializationIssue[] };

const MAX_QUANTITY = 99_999_999_999.999;

function isPositiveWhole(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0 && value <= MAX_QUANTITY;
}

function issue(
  issues: ProductionMaterializationIssue[],
  code: ProductionMaterializationIssueCode,
  path: string,
  message: string,
) {
  issues.push({ code, path, message });
}

function normalizedQty(value: number): string {
  return String(value);
}

function packingOperationSpec(
  group: CanonicalPackagingGroupFact,
  mode: OrderPackagingMode,
): ProductionOperationSpec {
  return {
    key: `PACKING:group=${group.id}`,
    operationType: PieceworkOperationType.PACKING,
    unit: packagingBoxType(mode) ? PieceworkRateUnit.PER_BOX : PieceworkRateUnit.PER_BAG,
    plannedQty: normalizedQty(group.actualBagCount),
    passCount: 1,
    sources: [
      {
        sourceType: ProductionOperationSourceType.PACKAGING_GROUP,
        orderItemId: null,
        packagingGroupId: group.id,
        sourceQty: normalizedQty(group.actualBagCount),
        completedPieceQty: normalizedQty(group.actualBagCount),
        passCount: 1,
      },
    ],
  };
}

function hasMatchingBoxCount(
  facts: CanonicalProductionOrderFacts,
  group: CanonicalPackagingGroupFact,
  mode: OrderPackagingMode,
): boolean {
  const result = calculatePackagingBagCount({
    mode,
    itemQuantities: facts.items.map((item) => item.quantity),
    itemUnitsPerBag: facts.items.map(
      (item) => group.lines.find((line) => line.orderItemId === item.id)?.unitsPerBag ?? 0,
    ),
    shipmentQuantities: facts.shipments?.map((shipment) =>
      facts.items.map(
        (item) => shipment.lines.find((line) => line.orderItemId === item.id)?.quantity ?? 0,
      ),
    ),
  });
  return result.complete && result.bagCount === group.actualBagCount;
}

/**
 * Derive the new production ledger from persisted canonical order facts.
 *
 * No personnel, machine, Craft dictionary, price table, or network/database
 * state is consulted here. PARTIAL operations are grouped by pass count rather
 * than blindly merged, because `ProductionReport.reportedCompletedQty` is a
 * piece count while its rate unit is PER_PASS. Splitting preserves the exact
 * multiplier needed for deterministic reporting and over-report guards.
 */
export function deriveProductionOperationPlan(
  facts: CanonicalProductionOrderFacts,
): ProductionOperationPlan {
  const issues: ProductionMaterializationIssue[] = [];
  if (facts.items.length === 0) {
    issue(issues, 'NO_ITEMS', 'items', '工单没有款式，无法生成生产工序');
  }

  const itemIds = new Set<string>();
  const itemQuantityById = new Map<string, number>();
  const partialByPassCount = new Map<number, ProductionOperationSourceSpec[]>();
  const fullSources: ProductionOperationSourceSpec[] = [];

  for (const [index, item] of facts.items.entries()) {
    const path = `items[${index}]`;
    if (itemIds.has(item.id)) {
      issue(issues, 'DUPLICATE_ITEM', `${path}.id`, `款式 ${item.id} 重复`);
      continue;
    }
    itemIds.add(item.id);
    if (!isPositiveWhole(item.quantity)) {
      issue(
        issues,
        'INVALID_ITEM_QUANTITY',
        `${path}.quantity`,
        `款式 #${item.sequence} 数量必须是正整数`,
      );
      continue;
    }
    itemQuantityById.set(item.id, item.quantity);

    let operationType: PieceworkOperationType | null = null;
    let passCount = 1;
    const directPassCount =
      item.frontFoilColors.length + item.backFoilColors.length;

    switch (item.craft) {
      case OrderCraft.PARTIAL:
        operationType = PieceworkOperationType.PARTIAL;
        if (directPassCount <= 0) {
          issue(
            issues,
            'MISSING_PARTIAL_PASS_FACTS',
            `${path}.frontFoilColors`,
            `款式 #${item.sequence} 局部烫金缺少正反面颜色次数`,
          );
          continue;
        }
        passCount = directPassCount;
        break;
      case OrderCraft.FULL:
        operationType = PieceworkOperationType.FULL;
        break;
      case OrderCraft.PRINT:
        // No foil colors means pure colour print. `hasLocalFoil=false` is also
        // the canonical no-foil value, so colour presence must be checked first.
        if (directPassCount === 0) break;
        if (item.hasLocalFoil === null) {
          issue(
            issues,
            'AMBIGUOUS_PRINT_FOIL_MODE',
            `${path}.hasLocalFoil`,
            `款式 #${item.sequence} 彩印叠加烫金未标明局部或专版`,
          );
          continue;
        }
        operationType = item.hasLocalFoil
          ? PieceworkOperationType.PARTIAL
          : PieceworkOperationType.FULL;
        passCount = item.hasLocalFoil ? directPassCount : 1;
        break;
      case null:
      default:
        issue(
          issues,
          'UNKNOWN_CRAFT',
          `${path}.craft`,
          `款式 #${item.sequence} 缺少可唯一映射的 canonical 工艺`,
        );
        continue;
    }

    if (operationType === null) continue;
    const chargeableQuantity = item.quantity * passCount;
    if (
      !Number.isSafeInteger(chargeableQuantity) ||
      chargeableQuantity > MAX_QUANTITY
    ) {
      issue(
        issues,
        'OPERATION_QUANTITY_OVERFLOW',
        `${path}.quantity`,
        `款式 #${item.sequence} 的计件数超出可存储范围`,
      );
      continue;
    }
    const source: ProductionOperationSourceSpec = {
      sourceType: ProductionOperationSourceType.ORDER_ITEM,
      orderItemId: item.id,
      packagingGroupId: null,
      sourceQty: normalizedQty(chargeableQuantity),
      completedPieceQty: normalizedQty(item.quantity),
      passCount,
    };
    if (operationType === PieceworkOperationType.PARTIAL) {
      const existing = partialByPassCount.get(passCount) ?? [];
      existing.push(source);
      partialByPassCount.set(passCount, existing);
    } else {
      fullSources.push(source);
    }
  }

  if (facts.packagingGroups.length === 0) {
    issue(
      issues,
      'NO_PACKAGING_GROUPS',
      'packagingGroups',
      '工单没有包装组，无法确定打包计件数',
    );
  }

  const packagingIds = new Set<string>();
  const packagingMembershipCountByItem = new Map<string, number>();
  const packingSpecs: ProductionOperationSpec[] = [];
  for (const [index, group] of facts.packagingGroups.entries()) {
    const path = `packagingGroups[${index}]`;
    if (packagingIds.has(group.id)) {
      issue(
        issues,
        'DUPLICATE_PACKAGING_GROUP',
        `${path}.id`,
        `包装组 ${group.id} 重复`,
      );
      continue;
    }
    packagingIds.add(group.id);
    const mode = group.mode ?? (group.lines.length > 1 ? OrderPackagingMode.MIXED_STYLE : OrderPackagingMode.SINGLE_STYLE);
    if (mode === OrderPackagingMode.UNPACKED ? group.actualBagCount !== 0 : !isPositiveWhole(group.actualBagCount)) {
      issue(
        issues,
        'INVALID_PACKAGING_QUANTITY',
        `${path}.actualBagCount`,
        `包装组 #${group.sequence} 实际袋数必须是正整数`,
      );
      continue;
    }
    if (group.lines.length === 0) {
      issue(
        issues,
        'EMPTY_PACKAGING_GROUP',
        `${path}.lines`,
        `包装组 #${group.sequence} 没有款式明细`,
      );
      continue;
    }

    const groupItemIds = new Set<string>();
    for (const [lineIndex, line] of group.lines.entries()) {
      const linePath = `${path}.lines[${lineIndex}]`;
      if (!itemIds.has(line.orderItemId)) {
        issue(
          issues,
          'UNKNOWN_PACKAGING_ITEM',
          `${linePath}.orderItemId`,
          `包装组 #${group.sequence} 引用了不属于本单的款式`,
        );
        continue;
      }
      if (groupItemIds.has(line.orderItemId)) {
        issue(
          issues,
          'DUPLICATE_PACKAGING_LINE',
          `${linePath}.orderItemId`,
          `包装组 #${group.sequence} 内款式 ${line.orderItemId} 重复`,
        );
        continue;
      }
      groupItemIds.add(line.orderItemId);
      if (!isPositiveWhole(line.unitsPerBag)) {
        issue(
          issues,
          'INVALID_UNITS_PER_BAG',
          `${linePath}.unitsPerBag`,
          `包装组 #${group.sequence} 每袋数必须是正整数`,
        );
        continue;
      }
      packagingMembershipCountByItem.set(
        line.orderItemId,
        (packagingMembershipCountByItem.get(line.orderItemId) ?? 0) + 1,
      );
      const itemQuantity = itemQuantityById.get(line.orderItemId);
      if (
        mode !== OrderPackagingMode.UNPACKED && !packagingBoxType(mode) &&
        itemQuantity !== undefined &&
        Math.ceil(itemQuantity / line.unitsPerBag) !== group.actualBagCount
      ) {
        issue(
          issues,
          'PACKAGING_QUANTITY_MISMATCH',
          `${linePath}.unitsPerBag`,
          `款式 ${line.orderItemId} 按每袋 ${line.unitsPerBag} 个应为 ${Math.ceil(itemQuantity / line.unitsPerBag)} 袋，与包装组 #${group.sequence} 的 ${group.actualBagCount} 袋不一致`,
        );
      }
    }

    if (mode === OrderPackagingMode.UNPACKED) continue;
    if (packagingBoxType(mode) && !hasMatchingBoxCount(facts, group, mode)) {
      issue(issues, 'PACKAGING_QUANTITY_MISMATCH', path, '实际盒数与包装、发货组成不一致');
    }
    packingSpecs.push(packingOperationSpec(group, mode));
  }

  for (const item of facts.items) {
    const expected = itemQuantityById.get(item.id);
    if (expected === undefined) continue;
    const membershipCount = packagingMembershipCountByItem.get(item.id) ?? 0;
    if (membershipCount !== 1) {
      issue(
        issues,
        'PACKAGING_QUANTITY_MISMATCH',
        `items[${item.sequence}].packaging`,
        membershipCount === 0
          ? `款式 #${item.sequence} 未加入任一包装组`
          : `款式 #${item.sequence} 同时加入 ${membershipCount} 个包装组，只允许唯一归属`,
      );
    }
  }

  for (const [passCount, sources] of partialByPassCount) {
    const total = sources.reduce(
      (sum, source) => sum + Number(source.sourceQty),
      0,
    );
    if (!Number.isSafeInteger(total) || total > MAX_QUANTITY) {
      issue(
        issues,
        'OPERATION_QUANTITY_OVERFLOW',
        `operations.PARTIAL.${passCount}`,
        `PARTIAL 过版数 ${passCount} 的汇总计件数超出可存储范围`,
      );
    }
  }
  const fullTotal = fullSources.reduce(
    (sum, source) => sum + Number(source.sourceQty),
    0,
  );
  if (!Number.isSafeInteger(fullTotal) || fullTotal > MAX_QUANTITY) {
    issue(
      issues,
      'OPERATION_QUANTITY_OVERFLOW',
      'operations.FULL',
      'FULL 汇总计件数超出可存储范围',
    );
  }

  if (issues.length > 0) return { ok: false, specs: [], issues };

  const specs: ProductionOperationSpec[] = [];
  for (const [passCount, sources] of [...partialByPassCount.entries()].sort(
    ([left], [right]) => left - right,
  )) {
    sources.sort((left, right) => left.orderItemId!.localeCompare(right.orderItemId!));
    specs.push({
      key: `PARTIAL:passes=${passCount}:items=${sources
        .map((source) => source.orderItemId)
        .join(',')}`,
      operationType: PieceworkOperationType.PARTIAL,
      unit: PieceworkRateUnit.PER_PASS,
      plannedQty: normalizedQty(
        sources.reduce((total, source) => total + Number(source.sourceQty), 0),
      ),
      passCount,
      sources,
    });
  }
  if (fullSources.length > 0) {
    fullSources.sort((left, right) => left.orderItemId!.localeCompare(right.orderItemId!));
    specs.push({
      key: `FULL:items=${fullSources
        .map((source) => source.orderItemId)
        .join(',')}`,
      operationType: PieceworkOperationType.FULL,
      unit: PieceworkRateUnit.PER_PIECE,
      plannedQty: normalizedQty(
        fullSources.reduce((total, source) => total + Number(source.sourceQty), 0),
      ),
      passCount: 1,
      sources: fullSources,
    });
  }
  specs.push(...packingSpecs.sort((left, right) => left.key.localeCompare(right.key)));

  return { ok: true, specs, issues: [] };
}
