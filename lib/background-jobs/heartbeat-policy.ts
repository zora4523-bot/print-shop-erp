import {
  WORKER_HEARTBEAT_DEFAULT_INTERVAL_MS,
  WORKER_HEARTBEAT_MIN_INTERVAL_MS,
  WORKER_HEARTBEAT_MAX_INTERVAL_MS,
} from './heartbeat-timing.mjs';

export {
  WORKER_HEARTBEAT_DEFAULT_INTERVAL_MS,
  WORKER_HEARTBEAT_MIN_INTERVAL_MS,
  WORKER_HEARTBEAT_MAX_INTERVAL_MS,
  WORKER_HEARTBEAT_ACTIVE_WINDOW_MS,
} from './heartbeat-timing.mjs';

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
