import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  path.join(
    process.cwd(),
    'prisma',
    'migrations',
    '20260828103000_create_order_foil_catalog_guard',
    'migration.sql',
  ),
  'utf8',
);

const foilCatalog = [
  ['mat_foil_matte_gold', 'FOIL-MATTE-GOLD', '亚金', 10],
  ['mat_foil_light_gold', 'FOIL-LIGHT-GOLD', '浅色', 20],
  ['mat_foil_red', 'FOIL-RED', '红色', 30],
  ['mat_foil_black', 'FOIL-BLACK', '黑色', 40],
  ['mat_foil_silver', 'FOIL-SILVER', '银色', 50],
  ['mat_foil_blue', 'FOIL-BLUE', '蓝色', 60],
  ['mat_foil_clear', 'FOIL-CLEAR', '透明色', 70],
  ['mat_foil_green', 'FOIL-GREEN', '绿色', 80],
] as const;

describe('create-order foil catalog migration contract', () => {
  it('upserts the eight canonical FOIL options with stable identities and order', () => {
    expect(migration.trimStart()).toMatch(/^BEGIN;/u);
    expect(migration.trimEnd()).toMatch(/COMMIT;$/u);
    expect(migration).toContain('INSERT INTO "Material"');
    expect(migration).toContain("'FOIL'::\"MaterialCategory\"");
    expect(migration).toContain('ON CONFLICT ("code") DO UPDATE SET');

    for (const [id, code, name, sortOrder] of foilCatalog) {
      expect(migration).toContain(`'${id}'`);
      expect(migration).toContain(`'${code}'::CITEXT`);
      expect(migration).toContain(`'${name}'`);
      expect(migration).toMatch(
        new RegExp(
          `'${id}'[\\s\\S]*?'${code}'::CITEXT[\\s\\S]*?'${name}'[\\s\\S]*?${sortOrder},[\\s\\S]*?TRUE`,
          'u',
        ),
      );
    }

    expect(migration.match(/'FOIL'::"MaterialCategory"/gu)).toHaveLength(8);
    expect(migration.match(/linear-gradient\(140deg,/gu)).toHaveLength(8);
  });

  it('does not overwrite stock, safety stock, average cost, or row identity', () => {
    const conflictUpdate = migration.slice(
      migration.indexOf('ON CONFLICT ("code") DO UPDATE SET'),
      migration.indexOf('-- An E2E search fixture'),
    );

    expect(conflictUpdate).not.toContain('"id" =');
    expect(conflictUpdate).not.toContain('"currentStock"');
    expect(conflictUpdate).not.toContain('"safetyStock"');
    expect(conflictUpdate).not.toContain('"averageCost"');
    expect(conflictUpdate).toContain('"displayColor" = EXCLUDED."displayColor"');
    expect(conflictUpdate).toContain('"sortOrder" = EXCLUDED."sortOrder"');
  });

  it('deactivates only the exact leaked E2E product without deleting it', () => {
    expect(migration).toMatch(
      /UPDATE "Product"[\s\S]*?SET[\s\S]*?"isActive" = FALSE[\s\S]*?WHERE "code" = 'CODX-E2E-PROD-001'::CITEXT/u,
    );
    expect(migration).not.toMatch(/DELETE\s+FROM\s+"Product"/iu);
    expect(migration).not.toMatch(/TRUNCATE\s+(?:TABLE\s+)?"Product"/iu);
  });
});
