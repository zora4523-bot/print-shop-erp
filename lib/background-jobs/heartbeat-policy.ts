export const WORKER_HEARTBEAT_DEFAULT_INTERVAL_MS = 15_000;
export const WORKER_HEARTBEAT_MIN_INTERVAL_MS = 5_000;
export const WORKER_HEARTBEAT_MAX_INTERVAL_MS = 60_000;

/**
 * A worker remains active for three full intervals at the largest supported
 * cadence. Health checks therefore tolerate the same number of missed beats
 * for every accepted WORKER_HEARTBEAT_MS value.
 */
export const WORKER_HEARTBEAT_ACTIVE_WINDOW_MS =
  WORKER_HEARTBEAT_MAX_INTERVAL_MS * 3;

export function normalizeWorkerHeartbeatIntervalMs(
  value: number | undefined,
): number {
  if (value === undefined || !Number.isFinite(value)) {
    return WORKER_HEARTBEAT_DEFAULT_INTERVAL_MS;
  }
  return Math.min(
    WORKER_HEARTBEAT_MAX_INTERVAL_MS,
    Math.max(WORKER_HEARTBEAT_MIN_INTERVAL_MS, value),
  );
}
