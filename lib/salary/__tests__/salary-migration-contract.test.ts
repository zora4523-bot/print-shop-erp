import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  path.join(
    process.cwd(),
    'prisma/migrations/20260830190000_salary_decimal_and_employment_guards/migration.sql',
  ),
  'utf8',
);

describe('salary decimal and employment guard migration', () => {
  it('applies the widening and employment guard atomically', () => {
    expect(migration).toMatch(/^--[\s\S]+\nBEGIN;/u);
    expect(migration.trimEnd()).toMatch(/COMMIT;$/u);
    expect(migration.match(/\bBEGIN;/gu)).toHaveLength(1);
    expect(migration.match(/\bCOMMIT;/gu)).toHaveLength(1);
  });

  it('widens every salary output column to the schema precision', () => {
    for (const column of [
      'baseSalary',
      'otSalary',
      'spareSalary',
      'totalSalary',
    ]) {
      expect(migration).toContain(
        `ALTER COLUMN "${column}" TYPE DECIMAL(11, 2)`,
      );
    }
    expect(migration).toContain(
      'ALTER COLUMN "monthlyBaseTotal" TYPE DECIMAL(12, 2)',
    );
    expect(migration).toContain(
      'ALTER COLUMN "totalIncome" TYPE DECIMAL(13, 2)',
    );
  });

  it('installs and validates the direct-SQL employment date guard', () => {
    expect(migration).toContain(
      'ADD CONSTRAINT "User_employment_dates_order_check"',
    );
    expect(migration).toMatch(
      /"employmentStartDate"\s*<=\s*"employmentEndDate"/u,
    );
    expect(migration).toContain(') NOT VALID;');
    expect(migration).toContain(
      'VALIDATE CONSTRAINT "User_employment_dates_order_check"',
    );
  });
});
