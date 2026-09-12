import type { Client } from 'pg';
import type { PieceworkPriceBookV1Manifest } from '../../lib/salary/piecework-price-book-admin';

export const E2E_PIECEWORK_SOURCE = 'E2E ONLY — disposable database rates, never production prices';
export const E2E_PIECEWORK_RULES = [
  { operationType: 'PARTIAL', unit: 'PER_PASS', amount: '0.2000' },
  { operationType: 'FULL', unit: 'PER_PIECE', amount: '0.0500' },
  { operationType: 'PACKING', unit: 'PER_BAG', amount: '0.1000' },
] as const;

export function e2ePieceworkManifest(effectiveFrom: Date): PieceworkPriceBookV1Manifest {
  return {
    schemaVersion: 1, priceBookVersion: 1,
    effectiveFrom: effectiveFrom.toISOString(),
    sourceName: E2E_PIECEWORK_SOURCE,
    publishNote: 'Disposable E2E fixture only; synthetic rates are not approved production prices.',
    rules: E2E_PIECEWORK_RULES.map((rule) => ({ ...rule })),
  };
}

export async function assertReleasePieceworkPrerequisite(client: Pick<Client, 'query'>): Promise<void> {
  const result = await client.query<{
    bookId: string; sourceName: string | null; ruleSetSha256: string | null;
    operationType: string; unit: string; amount: string | null;
  }>(`SELECT book.id AS "bookId", book."sourceName", book."ruleSetSha256",
      rule."operationType"::text AS "operationType", rule.unit::text AS unit, rule.amount::text AS amount
    FROM "PieceworkPriceBook" book
    LEFT JOIN "PieceworkPriceRule" rule ON rule."priceBookId" = book.id
    WHERE book.status = 'PUBLISHED'::"PieceworkPriceBookStatus"
      AND book."effectiveFrom" <= CURRENT_TIMESTAMP
      AND (book."effectiveTo" IS NULL OR book."effectiveTo" > CURRENT_TIMESTAMP)`);
  const rows = result.rows;
  if (rows.length !== 3 || new Set(rows.map((row) => row.bookId)).size !== 1 ||
      rows.some((row) => row.sourceName !== E2E_PIECEWORK_SOURCE || !/^[a-f0-9]{64}$/.test(row.ruleSetSha256 ?? '')) ||
      !E2E_PIECEWORK_RULES.every((rule) => rows.some((row) =>
        row.operationType === rule.operationType && row.unit === rule.unit && row.amount === rule.amount))) {
    throw new Error('Release E2E requires one effective published E2E-only price book with all three fixture rates; run prepare-e2e-piecework after isolated migration/seed.');
  }
}
