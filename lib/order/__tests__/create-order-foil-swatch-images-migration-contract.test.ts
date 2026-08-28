import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  path.join(
    process.cwd(),
    'prisma',
    'migrations',
    '20260828104000_create_order_foil_swatch_images',
    'migration.sql',
  ),
  'utf8',
);

const clearPatternMigration = readFileSync(
  path.join(
    process.cwd(),
    'prisma',
    'migrations',
    '20260828105000_create_order_clear_foil_swatch_pattern',
    'migration.sql',
  ),
  'utf8',
);

const foilSwatchImages = [
  ['FOIL-MATTE-GOLD', '/images/order/foil/matte-gold.png'],
  ['FOIL-LIGHT-GOLD', '/images/order/foil/light-gold.png'],
  ['FOIL-RED', '/images/order/foil/red.png'],
  ['FOIL-BLACK', '/images/order/foil/black.png'],
  ['FOIL-SILVER', '/images/order/foil/silver.png'],
  ['FOIL-BLUE', '/images/order/foil/blue.png'],
  ['FOIL-GREEN', '/images/order/foil/green.png'],
] as const;

describe('create-order foil swatch image migration contract', () => {
  it('adds a nullable Material image field and maps every supplied FOIL asset', () => {
    expect(migration.trimStart()).toMatch(/^BEGIN;/u);
    expect(migration.trimEnd()).toMatch(/COMMIT;$/u);
    expect(migration).toContain('ADD COLUMN "displayImage" TEXT;');

    for (const [code, imagePath] of foilSwatchImages) {
      expect(migration).toContain(`'${code}'::CITEXT`);
      expect(migration).toContain(`'${imagePath}'`);
      expect(
        statSync(path.join(process.cwd(), 'public', imagePath.slice(1))).size,
      ).toBeGreaterThan(0);
    }
  });

  it('keeps the transparent swatch image empty and does not alter color fallback metadata', () => {
    expect(migration).toMatch(
      /WHEN "code" = 'FOIL-CLEAR'::CITEXT\s+THEN NULL/u,
    );
    expect(migration).not.toContain('"displayColor" =');
    expect(migration).not.toContain('DELETE FROM "Material"');
  });

  it('replaces the retired clear gradient with an explicit transparency pattern', () => {
    expect(clearPatternMigration.trimStart()).toMatch(/^BEGIN;/u);
    expect(clearPatternMigration.trimEnd()).toMatch(/COMMIT;$/u);
    expect(clearPatternMigration).toContain("'FOIL-CLEAR'::CITEXT");
    expect(clearPatternMigration).toContain('conic-gradient(');
    expect(clearPatternMigration).not.toContain('DELETE FROM "Material"');
  });
});
