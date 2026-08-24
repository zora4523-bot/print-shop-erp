/**
 * Cooperative fence for durable batch work.
 *
 * Each assertion renews/proves the caller's lease immediately before the next
 * independently committed write.  The AbortSignal closes the window after a
 * heartbeat failure so a stale worker stops between write units.
 */
export type ExecutionFence = {
  signal?: AbortSignal;
  assertLease?: () => Promise<void>;
};

export async function assertExecutionFence(
  fence?: ExecutionFence,
): Promise<void> {
  fence?.signal?.throwIfAborted();
  await fence?.assertLease?.();
  fence?.signal?.throwIfAborted();
}
