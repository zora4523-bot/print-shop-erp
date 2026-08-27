import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  join(
    process.cwd(),
    'prisma/migrations/20260826175000_active_paper_name_uniqueness/migration.sql',
  ),
  'utf8',
);

describe('active paper-name uniqueness migration', () => {
  it('fails on existing ambiguity and constrains only active paper rows', () => {
    expect(migration).toContain('HAVING COUNT(*) > 1');
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "Material_active_paper_name_unique"',
    );
    expect(migration).toContain(
      '"category" = \'PAPER\'::"MaterialCategory"',
    );
    expect(migration).toContain('"isActive" = TRUE');
    expect(migration).not.toMatch(/DELETE\s+FROM\s+"Material"/i);
  });
});
