type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function nonEmptyText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Shared trust boundary for persisted administrator pricing decisions.
 * Partial markers stay editable/fail closed instead of being trusted by only
 * one stage of the pricing workflow.
 */
export function isTrustedAdminPricingSnapshot(value: unknown): boolean {
  const snapshot = record(value);
  const actual = record(snapshot.actual);
  const confirmation = record(snapshot.confirmation);
  const confirmedAt = nonEmptyText(confirmation.confirmedAt);

  return (
    snapshot.source === 'ADMIN_SNAPSHOT_CONFIRMATION' &&
    snapshot.status === 'ADMIN_CONFIRMED' &&
    actual.provisional === false &&
    actual.requiresAdminConfirmation === false &&
    actual.automatic === false &&
    nonEmptyText(confirmation.actorId) !== null &&
    confirmedAt !== null &&
    Number.isFinite(Date.parse(confirmedAt))
  );
}
