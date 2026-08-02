type MutationStatus = { status: 'success' | 'invalid' | 'error' };

export function nextOutsourceIdempotencyKey(
  currentKey: string,
  result: MutationStatus,
  createKey: () => string,
): string {
  return result.status === 'success' ? createKey() : currentKey;
}
