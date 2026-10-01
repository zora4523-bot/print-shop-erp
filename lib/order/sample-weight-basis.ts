import Decimal from 'decimal.js';

/**
 * 寄样首重默认（DECISIONS 2026-09-30）。提交时把收件省份的中通首重写成计费重量，
 * 收费快照记 `weightBasis: SAMPLE_FIRST_WEIGHT_DEFAULT` 与当时的 `defaultWeightKg`。
 *
 * 之后每次重写快照（履约费用确认、发货定稿）都按同一条规则维护标记：最终计费重量
 * 仍等于提交时的默认首重才保留，否则说明重量已按实际更正，去掉标记。不能按
 * 「请求里有没有重量」判断——发货登记会把已存的默认重量原样回填。
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
 * 提交时写入的默认首重；快照不带默认标记时为 null。早于 `defaultWeightKg` 的
 * 标记快照（未上线的开发数据）只认同一快照里报价行的证据：计费重量等于首重。
 */
export function sampleDefaultWeightKg(snapshot: unknown): Decimal | null {
  const object = asObject(snapshot);
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
 * 重写 `next` 上的标记：最终重量等于默认首重则保留，否则去掉。默认首重先取
 * `previous`；`previous` 没有时取 `next` 自带的——寄付切到付再恢复寄付时，恢复的
 * 是原寄付快照，到付那一版已没有标记。到付（最终重量 null）一律去掉。
 */
export function reconcileSampleWeightBasis<T extends SnapshotObject>(
  previous: unknown,
  next: T,
  finalWeightKg: Decimal.Value | null | undefined,
): T {
  const { weightBasis, defaultWeightKg, ...rest } = next;
  void weightBasis;
  void defaultWeightKg;
  const defaultWeight = sampleDefaultWeightKg(previous) ?? sampleDefaultWeightKg(next);
  const finalWeight = asDecimal(finalWeightKg);
  if (defaultWeight && finalWeight?.equals(defaultWeight)) {
    return { ...rest, ...sampleFirstWeightDefaultMarker(defaultWeight) } as unknown as T;
  }
  return rest as T;
}
