export function retryDelayMs(attempt: number): number {
  const safeAttempt = Number.isFinite(attempt)
    ? Math.max(1, Math.floor(attempt))
    : 1;
  return Math.min(30 * 60_000, 30_000 * 2 ** (safeAttempt - 1));
}

export function backgroundJobErrorCode(error: unknown): string {
  const raw = error instanceof Error ? error.name : 'UnknownError';
  const normalized = raw.replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 80);
  return normalized || 'UnknownError';
}
