import Decimal from 'decimal.js';

/**
 * 寄样首重默认（DECISIONS 2026-09-30）。提交时把收件省份的中通首重写成计费重量，
 * 收费快照记 `weightBasis: SAMPLE_FIRST_WEIGHT_DEFAULT` 与当时的 `defaultWeightKg`。
 *
 * 之后每个重写寄样快递费快照的入口（履约费用确认、销售切换到付、变更申请 / 工厂确认
 * 重算物流、发货定稿）都只按上一版快照的状态和本次登记的重量推进，状态只有三种：
 * - 标记：寄付，登记重量等于默认首重；
 * - 暂存（`suspendedSampleDefaultWeightKg`）：到付不按重量收快递费，登记重量仍是默认
 *   首重或未登记；恢复寄付且重量未改时回到「标记」；
 * - 无：登记过不同的重量即作废，之后不再恢复——不能从更早的快照把它认回来。
 * 判断依据是登记重量的值，不是请求里有没有重量：发货登记会把已存的默认重量原样回填。
 */
export const SAMPLE_FIRST_WEIGHT_DEFAULT = 'SAMPLE_FIRST_WEIGHT_DEFAULT';

type SnapshotObject = Record<string, unknown>;

function asObject(value: unknown): SnapshotObject | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as SnapshotObject)
    : null;
}

function asDecimal(value: unknown): Decimal | null {
  if (value === null || value === undefined || value === '') return null;
  try {
    const parsed = new Decimal(String(value));
    return parsed.isFinite() ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * 快照仍有效的默认首重（标记或到付暂存）；已作废或从未有过时为 null。早于
 * `defaultWeightKg` 的标记快照（未上线的开发数据）只认同一快照里报价行的证据：
 * 计费重量等于首重。
 */
export function sampleDefaultWeightKg(snapshot: unknown): Decimal | null {
  const object = asObject(snapshot);
  if (object?.suspendedSampleDefaultWeightKg !== undefined) {
    return asDecimal(object.suspendedSampleDefaultWeightKg);
  }
  if (object?.weightBasis !== SAMPLE_FIRST_WEIGHT_DEFAULT) return null;
  if (object.defaultWeightKg !== undefined) return asDecimal(object.defaultWeightKg);
  const basis = asObject(asObject(object.line)?.basis);
  const billable = asDecimal(basis?.billableWeightKg);
  const firstWeight = asDecimal(basis?.firstWeightKg);
  return billable && firstWeight?.equals(billable) ? billable : null;
}

/** 提交时写入快照的默认标记。 */
export function sampleFirstWeightDefaultMarker(weightKg: Decimal.Value) {
  return {
    weightBasis: SAMPLE_FIRST_WEIGHT_DEFAULT,
    defaultWeightKg: new Decimal(weightKg).toString(),
  } as const;
}

/**
 * 按上一版快照 `previous` 的状态与本次登记重量，重写 `next` 上的首重默认字段。
 * `next` 自带的这些字段一律丢弃（例如恢复的原寄付快照），只由 `previous` 推进。
 */
export function reconcileSampleWeightBasis<T extends SnapshotObject>(
  previous: unknown,
  next: T,
  recorded: { weightKg: Decimal.Value | null | undefined; sfCollect: boolean },
): T {
  const { weightBasis, defaultWeightKg, suspendedSampleDefaultWeightKg, ...rest } = next;
  void weightBasis;
  void defaultWeightKg;
  void suspendedSampleDefaultWeightKg;
  const defaultWeight = sampleDefaultWeightKg(previous);
  if (!defaultWeight) return rest as T;
  const weight = asDecimal(recorded.weightKg);
  if (weight !== null && !weight.equals(defaultWeight)) return rest as T;
  if (recorded.sfCollect || weight === null) {
    return { ...rest, suspendedSampleDefaultWeightKg: defaultWeight.toString() } as unknown as T;
  }
  return { ...rest, ...sampleFirstWeightDefaultMarker(defaultWeight) } as unknown as T;
}
