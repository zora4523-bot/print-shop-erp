export const OUTSOURCE_SNAPSHOT_INVALID_MESSAGE =
  '外协单数量快照异常，请先对账修复';
export const OUTSOURCE_TOTAL_SNAPSHOT_MISMATCH_MESSAGE =
  '外协单总数量与逐款快照不一致，请先对账修复';
export const OUTSOURCE_FROZEN_TOTAL_MISSING_MESSAGE =
  '历史外协单缺少创建时数量证据，无法安全重放，请先对账修复';

export type FrozenOutsourceTotalEvidence = {
  orderItemIds: readonly string[];
  totalQty: number | null;
  itemSnapshots: readonly {
    orderItemId: string;
    quantity: number;
  }[];
};

export type FrozenOutsourceTotalResult =
  | { ok: true; totalQty: number }
  | { ok: false; errorMessage: string };

function sameStringArray(
  actual: readonly string[],
  expected: readonly string[],
): boolean {
  return (
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}

/**
 * Reads the immutable quantity evidence for one previously-created outsource
 * order. Snapshot rows take precedence over the legacy aggregate; both are
 * checked when present so a replay cannot silently accept inconsistent data.
 */
export function readFrozenOutsourceTotal(
  evidence: FrozenOutsourceTotalEvidence,
): FrozenOutsourceTotalResult {
  if (evidence.itemSnapshots.length > 0) {
    const snapshotItemIds = evidence.itemSnapshots
      .map((snapshot) => snapshot.orderItemId)
      .sort();
    const orderItemIds = [...evidence.orderItemIds].sort();
    if (
      !sameStringArray(snapshotItemIds, orderItemIds) ||
      evidence.itemSnapshots.some(
        (snapshot) =>
          !Number.isSafeInteger(snapshot.quantity) || snapshot.quantity <= 0,
      )
    ) {
      return { ok: false, errorMessage: OUTSOURCE_SNAPSHOT_INVALID_MESSAGE };
    }

    const totalQty = evidence.itemSnapshots.reduce(
      (sum, snapshot) => sum + snapshot.quantity,
      0,
    );
    if (!Number.isSafeInteger(totalQty)) {
      return { ok: false, errorMessage: OUTSOURCE_SNAPSHOT_INVALID_MESSAGE };
    }
    if (evidence.totalQty !== null && evidence.totalQty !== totalQty) {
      return {
        ok: false,
        errorMessage: OUTSOURCE_TOTAL_SNAPSHOT_MISMATCH_MESSAGE,
      };
    }
    return { ok: true, totalQty };
  }

  if (
    evidence.totalQty !== null &&
    Number.isSafeInteger(evidence.totalQty) &&
    evidence.totalQty > 0
  ) {
    return { ok: true, totalQty: evidence.totalQty };
  }

  return {
    ok: false,
    errorMessage: OUTSOURCE_FROZEN_TOTAL_MISSING_MESSAGE,
  };
}
