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

/** 提交时写入的默认首重；快照不带默认标记（或标记缺少重量）时为 null。 */
export function sampleDefaultWeightKg(snapshot: unknown): Decimal | null {
  const object = asObject(snapshot);
  if (object?.weightBasis !== SAMPLE_FIRST_WEIGHT_DEFAULT) return null;
  return asDecimal(object.defaultWeightKg);
}

/** 提交时写入快照的默认标记。 */
export function sampleFirstWeightDefaultMarker(weightKg: Decimal.Value) {
  return {
    weightBasis: SAMPLE_FIRST_WEIGHT_DEFAULT,
    defaultWeightKg: new Decimal(weightKg).toString(),
  } as const;
}

/**
 * 以 `previous` 的默认标记为准，重写 `next` 上的标记：最终重量等于默认首重则保留，
 * 否则去掉。`previous` 不带标记时只清掉 `next` 上可能被复制过来的残留标记。
 */
export function reconcileSampleWeightBasis<T extends SnapshotObject>(
  previous: unknown,
  next: T,
  finalWeightKg: Decimal.Value | null | undefined,
): T {
  const { weightBasis, defaultWeightKg, ...rest } = next;
  void weightBasis;
  void defaultWeightKg;
  const defaultWeight = sampleDefaultWeightKg(previous);
  const finalWeight = asDecimal(finalWeightKg);
  if (defaultWeight && finalWeight?.equals(defaultWeight)) {
    return { ...rest, ...sampleFirstWeightDefaultMarker(defaultWeight) } as unknown as T;
  }
  return rest as T;
}
