import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  path.join(
    process.cwd(),
    'prisma/migrations/20260830160000_order_edit_version/migration.sql',
  ),
  'utf8',
);

describe('order edit version migration', () => {
  it('installs the column, function, and trigger atomically', () => {
    expect(migration).toMatch(/^--[\s\S]+\nBEGIN;/u);
    expect(migration.trimEnd()).toMatch(/COMMIT;$/u);
    expect(migration.match(/\bBEGIN;/gu)).toHaveLength(1);
    expect(migration.match(/\bCOMMIT;/gu)).toHaveLength(1);
  });

  it('uses a database-owned trigger for monotonic edit versions', () => {
    expect(migration).toContain(
      'ADD COLUMN "editVersion" INTEGER NOT NULL DEFAULT 0',
    );
    expect(migration).toContain('NEW."editVersion" := OLD."editVersion" + 1');
    expect(migration).toContain('CREATE TRIGGER order_edit_version_bump');
    expect(migration).toContain('BEFORE UPDATE ON "Order"');
  });
});
