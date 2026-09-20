import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

export function assertBlankMigrationTestsRan(report) {
  for (const file of [
    'lib/price/__tests__/blank-price-rules-migration.postgres.test.ts',
    'lib/bom/__tests__/blank-target-migration.postgres.test.ts',
  ]) {
    const suite = report.testResults?.find((result) => result.name?.replaceAll('\\', '/').endsWith(`/${file}`));
    if (!suite?.assertionResults?.length || suite.assertionResults.some((test) => test.status !== 'passed')) {
      throw new Error(`Migration safety suite did not fully execute: ${file}`);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  assertBlankMigrationTestsRan(JSON.parse(readFileSync('.review/unit-tests.json', 'utf8')));
  console.log('Blank price and BOM migration suites executed without skips.');
}
