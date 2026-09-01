import Decimal from 'decimal.js';
import { assertExecutionFence, type ExecutionFence } from '../execution-fence';
import type { dispatchNotification } from './dispatch';

export type WorkOrderProgressOperation = 'FOILING' | 'PACKING';

/**
 * Append-only fact contract for the future ProductionWorkOrderProgress model.
 * PAYROLL quantities such as PACKING/PER_BAG must never be adapted into this
 * shape; completedQty is the work-order quantity governed by the order total.
 */
export type ProductionWorkOrderProgressFact = {
  id: string;
  orderId: string;
  orderNo: string;
  operationType: WorkOrderProgressOperation;
  completedQty: Decimal.Value;
  reportedAt: Date;
};

/** Append-only first-scan evidence from the future ProductionScanClaim model. */
export type ProductionScanClaimFact = {
  id: string;
  orderId: string;
  reporterId: string;
  idempotencyKey: string;
  claimedAt: Date;
};

/**
 * One release generation of a work order. releaseKey must change when the same
 * order is released again so a genuinely new stagnation episode can alert.
 */
export type ProductionReleasedOrderFact = {
  orderId: string;
  orderNo: string;
  releaseKey: string;
  releasedAt: Date;
};

export type ProductionProgressAnomalyCandidate = {
  orderId: string;
  orderNo: string;
  triggerProgressId: string;
  foilingProgress: string;
  packingProgress: string;
};

export type ProductionStagnationCandidate = {
  orderId: string;
  orderNo: string;
  releaseKey: string;
  releasedAt: Date;
};

export type ProductionAlertFactCursor = {
  scheduledAt: Date;
  orderId: string;
};

function compareFacts(
  left: ProductionWorkOrderProgressFact,
  right: ProductionWorkOrderProgressFact,
): number {
  const byTime = left.reportedAt.getTime() - right.reportedAt.getTime();
  return byTime || left.id.localeCompare(right.id);
}

function progressQuantity(fact: ProductionWorkOrderProgressFact): Decimal {
  const value = new Decimal(fact.completedQty);
  if (!value.isFinite() || value.isNegative()) {
    throw new TypeError(`invalid work-order progress fact: ${fact.id}`);
  }
  if (!Number.isFinite(fact.reportedAt.getTime())) {
    throw new TypeError(`invalid work-order progress timestamp: ${fact.id}`);
  }
  return value;
}

/**
 * Replays the append-only progress ledger and emits only false→true anomaly
 * edges. A stable trigger fact id makes retries idempotent, while a later
 * FOILING catch-up followed by another PACKING lead produces a new edge.
 */
export function deriveProductionProgressAnomalies(
  facts: readonly ProductionWorkOrderProgressFact[],
): ProductionProgressAnomalyCandidate[] {
  const byOrder = new Map<string, ProductionWorkOrderProgressFact[]>();
  for (const fact of facts) {
    const rows = byOrder.get(fact.orderId) ?? [];
    rows.push(fact);
    byOrder.set(fact.orderId, rows);
  }

  const candidates: ProductionProgressAnomalyCandidate[] = [];
  for (const rows of byOrder.values()) {
    rows.sort(compareFacts);
    let orderNo: string | null = null;
    let foiling = new Decimal(0);
    let packing = new Decimal(0);

    for (const fact of rows) {
      if (orderNo !== null && orderNo !== fact.orderNo) {
        throw new TypeError(`inconsistent order number for progress order: ${fact.orderId}`);
      }
      orderNo = fact.orderNo;
      const before = packing.gt(foiling);
      const increment = progressQuantity(fact);
      if (fact.operationType === 'FOILING') {
        foiling = foiling.plus(increment);
      } else {
        packing = packing.plus(increment);
      }
      const after = packing.gt(foiling);
      if (!before && after) {
        candidates.push({
          orderId: fact.orderId,
          orderNo: fact.orderNo,
          triggerProgressId: fact.id,
          foilingProgress: foiling.toString(),
          packingProgress: packing.toString(),
        });
      }
    }
  }

  return candidates.sort((left, right) =>
    left.triggerProgressId.localeCompare(right.triggerProgressId),
  );
}

/**
 * Derives "released for N days and still no valid scan claim" without writing
 * a mutable stagnant flag. Claims before a later release do not satisfy that
 * release generation.
 */
export function deriveProductionStagnationCandidates(input: {
  releasedOrders: readonly ProductionReleasedOrderFact[];
  claims: readonly ProductionScanClaimFact[];
  now: Date;
  thresholdDays: number;
}): ProductionStagnationCandidate[] {
  if (!Number.isInteger(input.thresholdDays) || input.thresholdDays < 1) {
    throw new TypeError('production stagnation threshold must be a positive integer');
  }
  if (!Number.isFinite(input.now.getTime())) {
    throw new TypeError('production stagnation scan time is invalid');
  }

  const claimsByOrder = new Map<string, ProductionScanClaimFact[]>();
  for (const claim of input.claims) {
    if (!Number.isFinite(claim.claimedAt.getTime())) {
      throw new TypeError(`invalid production scan claim timestamp: ${claim.id}`);
    }
    const rows = claimsByOrder.get(claim.orderId) ?? [];
    rows.push(claim);
    claimsByOrder.set(claim.orderId, rows);
  }

  const thresholdMs = input.thresholdDays * 24 * 60 * 60 * 1000;
  return input.releasedOrders
    .filter((release) => {
      if (!Number.isFinite(release.releasedAt.getTime())) {
        throw new TypeError(`invalid production release timestamp: ${release.releaseKey}`);
      }
      if (input.now.getTime() - release.releasedAt.getTime() < thresholdMs) {
        return false;
      }
      return !(claimsByOrder.get(release.orderId) ?? []).some(
        (claim) => claim.claimedAt.getTime() >= release.releasedAt.getTime(),
      );
    })
    .map((release) => ({ ...release }))
    .sort((left, right) => {
      const byRelease = left.releasedAt.getTime() - right.releasedAt.getTime();
      return byRelease || left.releaseKey.localeCompare(right.releaseKey);
    });
}

export type ProductionAlertFactSource = {
  /**
   * Load complete append-only facts for one keyset page of active orders.
   * The adapter must use ProductionWorkOrderProgress and ProductionScanClaim;
   * it must not read ProductionTask or PACKING/PER_BAG payroll quantities.
   */
  load(input: {
    orderLimit: number;
    cursor?: ProductionAlertFactCursor;
  }): Promise<{
    progress: ProductionWorkOrderProgressFact[];
    releasedOrders: ProductionReleasedOrderFact[];
    claims: ProductionScanClaimFact[];
    nextCursor?: ProductionAlertFactCursor | null;
  }>;
};

type ProductionAlertConfiguration = {
  anomalyEnabled: boolean;
  stagnationEnabled: boolean;
  stagnationDays: number;
  scanBatchSize: number;
};

type ProductionAlertTaskDependencies = {
  configuration(): Promise<ProductionAlertConfiguration>;
  now(): Date | Promise<Date>;
  dispatch: typeof dispatchNotification;
};

const defaultTaskDependencies: ProductionAlertTaskDependencies = {
  configuration: async () => {
    const { getSetting } = await import('../settings');
    const [anomaly, stagnation, threshold, batch] = await Promise.all([
      getSetting('notify_production_anomaly_enabled'),
      getSetting('notify_production_stagnation_enabled'),
      getSetting('production_stagnation_days'),
      getSetting('production_alert_scan_batch_size'),
    ]);
    return {
      anomalyEnabled: anomaly.enabled,
      stagnationEnabled: stagnation.enabled,
      stagnationDays: threshold.days,
      scanBatchSize: batch.count,
    };
  },
  now: async () => {
    const { databaseClockNow } = await import('../background-jobs/clock');
    return databaseClockNow();
  },
  dispatch: async (...args) => {
    const notification = await import('./dispatch');
    return notification.dispatchNotification(...args);
  },
};

/**
 * Default cron adapter for the two W2 append-only ledgers. Tests and offline
 * replay tools can still inject a source without making legacy task/payroll
 * data part of the production truth.
 */
export const productionAlertFactSource: ProductionAlertFactSource = {
  load: async (input) => {
    const { loadProductionAlertFacts } = await import(
      '../production/work-order-progress-query'
    );
    return loadProductionAlertFacts(input);
  },
};

export async function runProductionAlertNotificationTask(
  runDate: string,
  source: ProductionAlertFactSource = productionAlertFactSource,
  fence?: ExecutionFence,
  dependencies: ProductionAlertTaskDependencies = defaultTaskDependencies,
) {
  const configuration = await dependencies.configuration();
  if (!configuration.anomalyEnabled && !configuration.stagnationEnabled) {
    return {
      status: 'ok' as const,
      runDate,
      anomalyCount: 0,
      stagnationCount: 0,
    };
  }

  await assertExecutionFence(fence);
  const scanNow = configuration.stagnationEnabled
    ? await dependencies.now()
    : null;
  let cursor: ProductionAlertFactCursor | undefined;
  let anomalyCount = 0;
  let stagnationCount = 0;
  let spreadIndex = 0;
  do {
    await assertExecutionFence(fence);
    const facts = await source.load({
      orderLimit: configuration.scanBatchSize,
      ...(cursor ? { cursor } : {}),
    });
    const anomalies = configuration.anomalyEnabled
      ? deriveProductionProgressAnomalies(facts.progress)
      : [];
    const stagnations =
      configuration.stagnationEnabled && scanNow
        ? deriveProductionStagnationCandidates({
            releasedOrders: facts.releasedOrders,
            claims: facts.claims,
            now: scanNow,
            thresholdDays: configuration.stagnationDays,
          })
        : [];

    for (const candidate of anomalies) {
      await assertExecutionFence(fence);
      await dependencies.dispatch(
        'PRODUCTION_PROGRESS_ANOMALY',
        {
          orderId: candidate.orderId,
          orderNo: candidate.orderNo,
          summary: `打包进度 ${candidate.packingProgress}，烫金进度 ${candidate.foilingProgress}，请核对漏报`,
          deepLink: `/orders#wo=${encodeURIComponent(candidate.orderNo)}`,
        },
        {
          dedupeKey: `notification:PRODUCTION_PROGRESS_ANOMALY:${candidate.orderId}:${candidate.triggerProgressId}`,
          spreadIndex,
        },
      );
      spreadIndex += 1;
    }

    for (const candidate of stagnations) {
      await assertExecutionFence(fence);
      await dependencies.dispatch(
        'PRODUCTION_STAGNANT',
        {
          orderId: candidate.orderId,
          orderNo: candidate.orderNo,
          summary: `下发后已满 ${configuration.stagnationDays} 天仍无有效扫码认领`,
          deepLink: `/orders#wo=${encodeURIComponent(candidate.orderNo)}`,
        },
        {
          dedupeKey: `notification:PRODUCTION_STAGNANT:${candidate.orderId}:${candidate.releaseKey}`,
          spreadIndex,
        },
      );
      spreadIndex += 1;
    }

    anomalyCount += anomalies.length;
    stagnationCount += stagnations.length;
    const nextCursor = facts.nextCursor ?? null;
    if (nextCursor && cursor) {
      const byTime =
        nextCursor.scheduledAt.getTime() - cursor.scheduledAt.getTime();
      if (byTime < 0 || (byTime === 0 && nextCursor.orderId <= cursor.orderId)) {
        throw new TypeError('production alert fact cursor did not advance');
      }
    }
    cursor = nextCursor ?? undefined;
  } while (cursor);

  return {
    status: 'ok' as const,
    runDate,
    anomalyCount,
    stagnationCount,
  };
}
