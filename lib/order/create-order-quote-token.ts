import { createHash } from 'node:crypto';

/**
 * Preview rows use browser-local keys while submit-time rows use database ids.
 * Those identifiers prove row identity inside one request, but they are not a
 * pricing fact and therefore must not make an otherwise identical quote look
 * different after the draft has been persisted.
 */
const VOLATILE_EVIDENCE_KEYS = new Set([
  'factsKey',
  'groupKey',
  'itemKey',
  'quotedAt',
  'shipmentKey',
]);

export type ExternalCreateOrderQuoteTokenEvidence = {
  items: readonly unknown[];
  packagingGroups: readonly unknown[];
  logistics: {
    isSfCollect: boolean;
    shipments: readonly unknown[];
  };
  priceVersion: unknown;
  result: {
    items: readonly unknown[];
    packaging: unknown;
    logistics: unknown;
  };
};

function stableEvidence(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(stableEvidence);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([key, entry]) =>
            entry !== undefined && !VOLATILE_EVIDENCE_KEYS.has(key),
        )
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stableEvidence(entry)]),
    );
  }
  return value;
}

/**
 * A server-verifiable quote handshake. The token binds canonical order facts,
 * both price-book versions and every calculated line while deliberately
 * ignoring request timestamps and preview/persistence row identifiers.
 */
export function createExternalOrderQuoteToken(
  evidence: ExternalCreateOrderQuoteTokenEvidence,
): string {
  const digest = createHash('sha256')
    .update(JSON.stringify(stableEvidence(evidence)))
    .digest('hex');
  return `create-order-quote-v2:${digest}`;
}

