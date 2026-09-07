// Plain ESM keeps the same policy usable by Next/TypeScript and the standalone
// deployment CLI without loading the database, generated client, or TS runtime.
export const WORKER_HEARTBEAT_DEFAULT_INTERVAL_MS = 15_000;
export const WORKER_HEARTBEAT_MIN_INTERVAL_MS = 5_000;
export const WORKER_HEARTBEAT_MAX_INTERVAL_MS = 60_000;

// Tolerate three missed beats even at the largest supported cadence.
export const WORKER_HEARTBEAT_ACTIVE_WINDOW_MS =
  WORKER_HEARTBEAT_MAX_INTERVAL_MS * 3;
