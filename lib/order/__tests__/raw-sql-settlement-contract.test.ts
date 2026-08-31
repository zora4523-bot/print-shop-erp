import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const skippedDirectories = new Set([
  '.git',
  '.next',
  'coverage',
  'generated',
  'node_modules',
  'playwright-report',
  'test-results',
]);
const sourceExtensions = new Set([
  '.cjs',
  '.js',
  '.jsx',
  '.mjs',
  '.sh',
  '.sql',
  '.ts',
  '.tsx',
]);

type RawOrderInsert = {
  file: string;
  line: number;
  statement: string;
};

function sourceFiles(directory: string): string[] {
  const relative = path.relative(process.cwd(), directory);
  if (relative === path.join('prisma', 'migrations')) return [];

  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) {
      if (skippedDirectories.has(entry.name)) return [];
      return sourceFiles(path.join(directory, entry.name));
    }
    if (!entry.isFile() || !sourceExtensions.has(path.extname(entry.name))) {
      return [];
    }
    return [path.join(directory, entry.name)];
  });
}

function rawOrderInserts(): RawOrderInsert[] {
  const inserts: RawOrderInsert[] = [];
  const marker = /INSERT\s+INTO\s+"Order"\s*\(/giu;

  for (const absoluteFile of sourceFiles(process.cwd())) {
    const source = readFileSync(absoluteFile, 'utf8');
    for (const match of source.matchAll(marker)) {
      const start = match.index;
      const possibleEnds = [source.indexOf('`', start), source.indexOf(';', start)]
        .filter((index) => index > start)
        .sort((left, right) => left - right);
      const end = possibleEnds[0] ?? source.length;
      inserts.push({
        file: path.relative(process.cwd(), absoluteFile),
        line: source.slice(0, start).split('\n').length,
        statement: source.slice(start, end),
      });
    }
  }

  return inserts;
}

describe('raw Order INSERT settlement contract', () => {
  it('makes every non-migration raw insert declare a role-correct settlement direction', () => {
    const inserts = rawOrderInserts();
    // Keep a floor so a broken scanner cannot make the contract pass on an
    // empty/partial corpus. New fixtures and operational seed scripts may add
    // valid INSERTs; every discovered statement is validated below, so an
    // exact count would turn legitimate additions into unrelated failures.
    expect(inserts.length).toBeGreaterThanOrEqual(15);

    for (const insert of inserts) {
      const location = `${insert.file}:${insert.line}`;
      const columns = insert.statement.match(
        /INSERT\s+INTO\s+"Order"\s*\(([\s\S]*?)\)\s*(?:VALUES|SELECT)/iu,
      )?.[1];

      expect(columns, `${location} must have a parseable column list`).toBeDefined();
      expect(columns, `${location} must explicitly write settlementType`).toContain(
        '"settlementType"',
      );

      const isNoCharge = insert.statement.includes(
        `'NO_CHARGE'::"OrderBillingMode"`,
      );
      if (isNoCharge) {
        expect(insert.statement, `${location} NO_CHARGE settlement`).toContain(
          `'NO_CHARGE'::"OrderSettlementType"`,
        );
      } else {
        if (insert.statement.includes(`'SALES'::"Role"`)) {
          expect(insert.statement, `${location} SALES settlement`).toContain(
            `'EXTERNAL_SALES'::"OrderSettlementType"`,
          );
        }
        if (insert.statement.includes(`'CUSTOMER_SERVICE'::"Role"`)) {
          expect(
            insert.statement,
            `${location} CUSTOMER_SERVICE settlement`,
          ).toContain(`'INTERNAL_SALES'::"OrderSettlementType"`);
        }
        if (insert.statement.includes(`'ADMIN'::"Role"`)) {
          expect(insert.statement, `${location} ADMIN settlement`).toContain(
            `'FACTORY_DIRECT'::"OrderSettlementType"`,
          );
        }
      }
    }
  });
});
