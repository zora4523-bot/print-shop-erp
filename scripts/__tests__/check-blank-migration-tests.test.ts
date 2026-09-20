import { describe, expect, it } from 'vitest';
import { assertBlankMigrationTestsRan } from '../check-blank-migration-tests.mjs';

const report = () => ({ testResults: [
  { name: '/repo/lib/price/__tests__/blank-price-rules-migration.postgres.test.ts', assertionResults: [{ status: 'passed' }] },
  { name: '/repo/lib/bom/__tests__/blank-target-migration.postgres.test.ts', assertionResults: [{ status: 'passed' }] },
] });
describe('migration CI execution gate', () => {
  it('accepts actual execution of both suites', () => expect(() => assertBlankMigrationTestsRan(report())).not.toThrow());
  it.each(['pending', 'skipped', 'failed'])('rejects %s instead of accepting green totals', (status) => {
    const input = report(); input.testResults[1].assertionResults[0].status = status;
    expect(() => assertBlankMigrationTestsRan(input)).toThrow('did not fully execute');
  });
  it('rejects missing or uncollected suites', () => {
    expect(() => assertBlankMigrationTestsRan({ testResults: [] })).toThrow();
    const input = report(); input.testResults[0].assertionResults = [];
    expect(() => assertBlankMigrationTestsRan(input)).toThrow();
  });
});
